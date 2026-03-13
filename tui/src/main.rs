//! SSS Admin TUI — Interactive terminal dashboard for the Solana Stablecoin Standard.
//!
//! Connects to a Solana RPC endpoint and displays live stablecoin data including
//! supply metrics, role assignments, minter quotas, and blacklist entries.
//!
//! # Usage
//!
//! ```bash
//! # Connect to local validator (default)
//! sss-admin-tui --mint <MINT_ADDRESS>
//!
//! # Connect to devnet
//! sss-admin-tui --rpc https://api.devnet.solana.com --mint <MINT_ADDRESS>
//!
//! # Custom program ID
//! sss-admin-tui --mint <MINT> --program-id <PROGRAM_ID>
//! ```

mod app;
mod data;
mod ui;

use std::io;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use clap::Parser;
use crossterm::event::{self, Event, KeyEventKind};
use crossterm::terminal::{
    disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen,
};
use crossterm::ExecutableCommand;
use ratatui::backend::CrosstermBackend;
use ratatui::Terminal;
use solana_client::rpc_client::RpcClient;

use app::{App, AppAction};
use data::{StablecoinData, DEFAULT_PROGRAM_ID, DEFAULT_RPC_URL};

/// Interactive terminal dashboard for the Solana Stablecoin Standard (SSS).
///
/// Displays live stablecoin metrics: supply, roles, minter quotas, and blacklist.
/// Data refreshes automatically every 5 seconds.
#[derive(Parser, Debug)]
#[command(name = "sss-admin-tui", version, about)]
struct Cli {
    /// Solana RPC URL.
    #[arg(long, default_value = DEFAULT_RPC_URL, env = "RPC_URL")]
    rpc: String,

    /// Token-2022 mint address of the stablecoin.
    #[arg(long, env = "SSS_MINT_ADDRESS")]
    mint: String,

    /// SSS program ID.
    #[arg(long, default_value = DEFAULT_PROGRAM_ID, env = "SSS_PROGRAM_ID")]
    program_id: String,

    /// Auto-refresh interval in seconds (0 to disable).
    #[arg(long, default_value = "5")]
    refresh_interval: u64,

    /// Optional backend URL for operator incident telemetry.
    #[arg(long, env = "SSS_BACKEND_URL")]
    backend_url: Option<String>,
}

/// Auto-refresh interval for data polling.
const EVENT_POLL_MS: u64 = 100;

fn main() -> Result<()> {
    let cli = Cli::parse();

    let mint = data::parse_pubkey(&cli.mint).context("Invalid --mint address")?;
    let program_id = data::parse_pubkey(&cli.program_id).context("Invalid --program-id")?;
    let refresh_interval = if cli.refresh_interval > 0 {
        Some(Duration::from_secs(cli.refresh_interval))
    } else {
        None
    };

    // Shared data between main thread and background fetcher
    let shared_data = Arc::new(Mutex::new(StablecoinData::default()));

    // Flag to stop the background thread on exit
    let running = Arc::new(std::sync::atomic::AtomicBool::new(true));
    let refresh_requested = Arc::new(std::sync::atomic::AtomicBool::new(false));

    // Spawn background data fetcher thread
    let fetcher_data = Arc::clone(&shared_data);
    let fetcher_running = Arc::clone(&running);
    let fetcher_refresh_requested = Arc::clone(&refresh_requested);
    let rpc_url = cli.rpc.clone();
    let backend_url = cli.backend_url.clone();
    let fetcher = thread::spawn(move || {
        let rpc = RpcClient::new_with_commitment(
            &rpc_url,
            solana_sdk::commitment_config::CommitmentConfig::confirmed(),
        );

        // Initial fetch immediately
        let result = data::fetch_all_data_with_backend(&rpc, &program_id, &mint, backend_url.as_deref());
        if let Ok(mut data) = fetcher_data.lock() {
            *data = result;
        }

        // Periodic refresh
        while fetcher_running.load(std::sync::atomic::Ordering::Relaxed) {
            let mut waited = Duration::ZERO;
            loop {
                if !fetcher_running.load(std::sync::atomic::Ordering::Relaxed) {
                    return;
                }

                if fetcher_refresh_requested.swap(false, std::sync::atomic::Ordering::Relaxed) {
                    break;
                }

                let Some(interval) = refresh_interval else {
                    thread::sleep(Duration::from_millis(200));
                    continue;
                };

                if waited >= interval {
                    break;
                }

                thread::sleep(Duration::from_millis(200));
                waited += Duration::from_millis(200);
            }

            let result = data::fetch_all_data_with_backend(&rpc, &program_id, &mint, backend_url.as_deref());
            if let Ok(mut data) = fetcher_data.lock() {
                *data = result;
            }
        }
    });

    // Setup terminal
    enable_raw_mode().context("Failed to enable raw mode")?;
    let mut stdout = io::stdout();
    stdout
        .execute(EnterAlternateScreen)
        .context("Failed to enter alternate screen")?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend).context("Failed to create terminal")?;
    terminal.clear()?;

    // Application state
    let mut app = App::new();

    // Main event loop
    let result = run_loop(&mut terminal, &mut app, &shared_data, &refresh_requested);

    // Cleanup: stop fetcher, restore terminal
    running.store(false, std::sync::atomic::Ordering::Relaxed);
    let _ = fetcher.join();

    disable_raw_mode().context("Failed to disable raw mode")?;
    terminal
        .backend_mut()
        .execute(LeaveAlternateScreen)
        .context("Failed to leave alternate screen")?;
    terminal.show_cursor()?;

    result
}

/// Main event loop: render + handle input.
fn run_loop(
    terminal: &mut Terminal<CrosstermBackend<io::Stdout>>,
    app: &mut App,
    shared_data: &Arc<Mutex<StablecoinData>>,
    refresh_requested: &Arc<std::sync::atomic::AtomicBool>,
) -> Result<()> {
    let mut last_status_clear = Instant::now();

    loop {
        // Read current data snapshot
        let current_data = shared_data.lock().map(|d| d.clone()).unwrap_or_default();

        // Clamp selected index based on current tab's data
        let max_items = match app.tab {
            app::Tab::Incidents => current_data.incidents.len(),
            app::Tab::Roles => current_data.roles.len(),
            app::Tab::Minters => current_data.minters.len(),
            app::Tab::Blacklist => current_data.blacklist.len(),
            _ => 0,
        };
        app.clamp_selected(max_items);

        // Render
        terminal.draw(|frame| ui::render(frame, app, &current_data))?;

        // Clear status message after 3 seconds
        if app.status_msg.is_some() && last_status_clear.elapsed() > Duration::from_secs(3) {
            app.status_msg = None;
        }

        // Poll for input events
        if event::poll(Duration::from_millis(EVENT_POLL_MS))? {
            if let Event::Key(key) = event::read()? {
                // Only handle key press events (not release/repeat)
                if key.kind == KeyEventKind::Press {
                    match app.handle_key(key) {
                        AppAction::Quit => break,
                        AppAction::Refresh => {
                            refresh_requested.store(true, std::sync::atomic::Ordering::Relaxed);
                            last_status_clear = Instant::now();
                        }
                        AppAction::None => {}
                    }
                }
            }
        }
    }

    Ok(())
}
