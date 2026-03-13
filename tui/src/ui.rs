//! TUI rendering for all dashboard tabs.
//!
//! Uses ratatui widgets to render the dashboard, roles, minters, blacklist,
//! and help tabs with consistent styling and layout.

use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Cell, Gauge, Paragraph, Row, Table, Tabs, Wrap};
use ratatui::Frame;

use crate::app::{App, Tab};
use crate::data::{role_name, FetchFreshness, StablecoinData};

// ── Color palette ───────────────────────────────────────────────────────────

const CLR_TITLE: Color = Color::Cyan;
const CLR_ACTIVE: Color = Color::Green;
const CLR_INACTIVE: Color = Color::DarkGray;
const CLR_WARN: Color = Color::Yellow;
const CLR_ERR: Color = Color::Red;
const CLR_ACCENT: Color = Color::Magenta;
const CLR_LABEL: Color = Color::White;
const CLR_VALUE: Color = Color::Gray;

// ── Main render entry point ─────────────────────────────────────────────────

/// Render the full TUI frame.
pub fn render(frame: &mut Frame, app: &App, data: &StablecoinData) {
    let area = frame.area();

    // Top-level layout: title bar (1) + tabs (3) + content + footer (3)
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3), // tabs
            Constraint::Min(10),   // content
            Constraint::Length(3), // footer
        ])
        .split(area);

    render_tabs(frame, app, chunks[0]);
    render_content(frame, app, data, chunks[1]);
    render_footer(frame, app, data, chunks[2]);
}

// ── Tab bar ─────────────────────────────────────────────────────────────────

fn render_tabs(frame: &mut Frame, app: &App, area: Rect) {
    let titles: Vec<Line> = Tab::ALL
        .iter()
        .enumerate()
        .map(|(i, tab)| {
            let num = format!("{}:", i + 1);
            Line::from(vec![
                Span::styled(num, Style::default().fg(CLR_INACTIVE)),
                Span::raw(tab.name()),
            ])
        })
        .collect();

    let tabs = Tabs::new(titles)
        .block(
            Block::default()
                .title(" SSS Admin Dashboard ")
                .title_style(Style::default().fg(CLR_TITLE).add_modifier(Modifier::BOLD))
                .borders(Borders::ALL)
                .border_style(Style::default().fg(CLR_INACTIVE)),
        )
        .select(app.tab.index())
        .highlight_style(Style::default().fg(CLR_TITLE).add_modifier(Modifier::BOLD))
        .divider(Span::styled(" │ ", Style::default().fg(CLR_INACTIVE)));

    frame.render_widget(tabs, area);
}

// ── Content router ──────────────────────────────────────────────────────────

fn render_content(frame: &mut Frame, app: &App, data: &StablecoinData, area: Rect) {
    match app.tab {
        Tab::Dashboard => render_dashboard(frame, data, area),
        Tab::Incidents => render_incidents(frame, app, data, area),
        Tab::Roles => render_roles(frame, app, data, area),
        Tab::Minters => render_minters(frame, app, data, area),
        Tab::Blacklist => render_blacklist(frame, app, data, area),
        Tab::Help => render_help(frame, area),
    }
}

// ── Footer ──────────────────────────────────────────────────────────────────

fn render_footer(frame: &mut Frame, app: &App, data: &StablecoinData, area: Rect) {
    let chunks = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(60), Constraint::Percentage(40)])
        .split(area);

    // Left: key hints
    let hints = Line::from(vec![
        Span::styled(
            " Tab",
            Style::default().fg(CLR_TITLE).add_modifier(Modifier::BOLD),
        ),
        Span::styled(" Switch  ", Style::default().fg(CLR_LABEL)),
        Span::styled(
            "↑↓/jk",
            Style::default().fg(CLR_TITLE).add_modifier(Modifier::BOLD),
        ),
        Span::styled(" Navigate  ", Style::default().fg(CLR_LABEL)),
        Span::styled(
            "1-6",
            Style::default().fg(CLR_TITLE).add_modifier(Modifier::BOLD),
        ),
        Span::styled(" Jump Tabs  ", Style::default().fg(CLR_LABEL)),
        Span::styled(
            "r",
            Style::default().fg(CLR_TITLE).add_modifier(Modifier::BOLD),
        ),
        Span::styled(" Refresh  ", Style::default().fg(CLR_LABEL)),
        Span::styled(
            "q",
            Style::default().fg(CLR_TITLE).add_modifier(Modifier::BOLD),
        ),
        Span::styled(" Quit", Style::default().fg(CLR_LABEL)),
    ]);
    let hints_widget = Paragraph::new(hints).block(
        Block::default()
            .borders(Borders::ALL)
            .border_style(Style::default().fg(CLR_INACTIVE)),
    );
    frame.render_widget(hints_widget, chunks[0]);

    // Right: status / last refresh
    let now = chrono::Local::now();
    let status_text = if let Some(msg) = &app.status_msg {
        Line::from(Span::styled(msg.as_str(), Style::default().fg(CLR_WARN)))
    } else {
        match data.freshness_at(now) {
            FetchFreshness::Error => Line::from(Span::styled(
                format!(
                    " Error: {}",
                    truncate_str(data.error.as_deref().unwrap_or("unknown"), 34)
                ),
                Style::default().fg(CLR_ERR),
            )),
            FetchFreshness::Stale => Line::from(Span::styled(
                format!(
                    " Data stale — last refresh {}",
                    data.age_label(now).unwrap_or_else(|| "unknown".to_string())
                ),
                Style::default().fg(CLR_WARN),
            )),
            FetchFreshness::Fresh => Line::from(Span::styled(
                format!(
                    " Live — last refresh {}",
                    data.age_label(now)
                        .unwrap_or_else(|| "just now".to_string())
                ),
                Style::default().fg(CLR_ACTIVE),
            )),
            FetchFreshness::Connecting => Line::from(Span::styled(
                " Connecting to Solana RPC...",
                Style::default().fg(CLR_WARN),
            )),
        }
    };

    let status_widget = Paragraph::new(status_text).block(
        Block::default()
            .borders(Borders::ALL)
            .border_style(Style::default().fg(CLR_INACTIVE)),
    );
    frame.render_widget(status_widget, chunks[1]);
}

// ── Dashboard tab ───────────────────────────────────────────────────────────

fn render_dashboard(frame: &mut Frame, data: &StablecoinData, area: Rect) {
    let config = match &data.config {
        Some(c) => c,
        None => {
            let msg = if data.error.is_some() {
                format!(
                    "Error loading stablecoin config:\n\n{}",
                    data.error.as_deref().unwrap_or("Unknown error")
                )
            } else {
                "Connecting to Solana RPC...".to_string()
            };
            let p = Paragraph::new(msg)
                .style(Style::default().fg(CLR_WARN))
                .block(
                    Block::default()
                        .title(" Dashboard ")
                        .borders(Borders::ALL)
                        .border_style(Style::default().fg(CLR_INACTIVE)),
                )
                .wrap(Wrap { trim: true });
            frame.render_widget(p, area);
            return;
        }
    };

    // Split into 3 rows
    let rows = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(7), // Identity + Supply
            Constraint::Length(7), // Authorities + Feature Flags
            Constraint::Min(5),    // Runtime State
        ])
        .split(area);

    // Row 1: Identity (left) + Supply (right)
    let row1 = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(40), Constraint::Percentage(60)])
        .split(rows[0]);

    render_identity(frame, config, row1[0]);
    render_supply(frame, config, data.live_supply, row1[1]);

    // Row 2: Authorities (left) + Feature Flags (right)
    let row2 = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(50), Constraint::Percentage(50)])
        .split(rows[1]);

    render_authorities(frame, config, &data.config_pda, &data.mint, row2[0]);
    render_feature_flags(frame, config, row2[1]);

    // Row 3: Runtime state summary
    render_runtime_state(frame, data, rows[2]);
}

fn render_incidents(frame: &mut Frame, app: &App, data: &StablecoinData, area: Rect) {
    if data.backend_url.is_none() {
        let widget = Paragraph::new(
            "Configure SSS_BACKEND_URL or --backend-url to load the correlated operator timeline."
        )
        .style(Style::default().fg(CLR_WARN))
        .block(
            Block::default()
                .title(" Incidents ")
                .borders(Borders::ALL)
                .border_style(Style::default().fg(CLR_INACTIVE)),
        )
        .wrap(Wrap { trim: true });
        frame.render_widget(widget, area);
        return;
    }

    let chunks = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(55), Constraint::Percentage(45)])
        .split(area);

    let rows: Vec<Row> = data
        .incidents
        .iter()
        .map(|incident| {
            let severity_color = match incident.severity.as_str() {
                "critical" => CLR_ERR,
                "warning" => CLR_WARN,
                "success" => CLR_ACTIVE,
                _ => CLR_VALUE,
            };
            Row::new(vec![
                Cell::from(incident.action.clone()),
                Cell::from(incident.status.clone()).style(Style::default().fg(severity_color)),
                Cell::from(incident.related_count.to_string()),
            ])
        })
        .collect();

    let table = Table::new(
        rows,
        [
            Constraint::Percentage(48),
            Constraint::Percentage(28),
            Constraint::Percentage(24),
        ],
    )
    .header(
        Row::new(vec!["Action", "Status", "Records"])
            .style(Style::default().fg(CLR_TITLE).add_modifier(Modifier::BOLD))
    )
    .block(
        Block::default()
            .title(" Incident Stream ")
            .borders(Borders::ALL)
            .border_style(Style::default().fg(CLR_INACTIVE)),
    )
    .row_highlight_style(Style::default().bg(Color::DarkGray))
    .highlight_symbol(">> ");
    let mut state = ratatui::widgets::TableState::default().with_selected(Some(app.selected));
    frame.render_stateful_widget(table, chunks[0], &mut state);

    let detail = data.incidents.get(app.selected).map(|incident| {
        vec![
            Line::from(vec![
                Span::styled("When: ", Style::default().fg(CLR_LABEL)),
                Span::styled(&incident.occurred_at, Style::default().fg(CLR_VALUE)),
            ]),
            Line::from(vec![
                Span::styled("Severity: ", Style::default().fg(CLR_LABEL)),
                Span::styled(&incident.severity, Style::default().fg(CLR_VALUE)),
            ]),
            Line::from(vec![
                Span::styled("Status: ", Style::default().fg(CLR_LABEL)),
                Span::styled(&incident.status, Style::default().fg(CLR_VALUE)),
            ]),
            Line::from(""),
            Line::from(incident.summary.clone()),
            Line::from(""),
            Line::from(format!("Correlation: {}", incident.id)),
        ]
    });

    let detail_widget = Paragraph::new(detail.unwrap_or_else(|| {
        vec![Line::from("No incidents loaded from the backend yet.")]
    }))
    .block(
        Block::default()
            .title(" Incident Detail ")
            .borders(Borders::ALL)
            .border_style(Style::default().fg(CLR_INACTIVE)),
    )
    .wrap(Wrap { trim: true });
    frame.render_widget(detail_widget, chunks[1]);
}

fn render_identity(frame: &mut Frame, config: &crate::data::ConfigAccount, area: Rect) {
    let preset = if config.enable_permanent_delegate && config.enable_transfer_hook {
        Span::styled(
            "SSS-2",
            Style::default().fg(CLR_ACCENT).add_modifier(Modifier::BOLD),
        )
    } else if !config.enable_permanent_delegate && !config.enable_transfer_hook {
        Span::styled(
            "SSS-1",
            Style::default().fg(CLR_ACTIVE).add_modifier(Modifier::BOLD),
        )
    } else {
        Span::styled(
            "Custom",
            Style::default().fg(CLR_WARN).add_modifier(Modifier::BOLD),
        )
    };

    let lines = vec![
        Line::from(vec![
            Span::styled(" Name:     ", Style::default().fg(CLR_LABEL)),
            Span::styled(&config.name, Style::default().fg(CLR_VALUE)),
        ]),
        Line::from(vec![
            Span::styled(" Symbol:   ", Style::default().fg(CLR_LABEL)),
            Span::styled(&config.symbol, Style::default().fg(CLR_VALUE)),
        ]),
        Line::from(vec![
            Span::styled(" Decimals: ", Style::default().fg(CLR_LABEL)),
            Span::styled(config.decimals.to_string(), Style::default().fg(CLR_VALUE)),
        ]),
        Line::from(vec![
            Span::styled(" Preset:   ", Style::default().fg(CLR_LABEL)),
            preset,
        ]),
    ];

    let block = Block::default()
        .title(" Identity ")
        .title_style(Style::default().fg(CLR_TITLE).add_modifier(Modifier::BOLD))
        .borders(Borders::ALL)
        .border_style(Style::default().fg(CLR_INACTIVE));

    let p = Paragraph::new(lines).block(block);
    frame.render_widget(p, area);
}

fn render_supply(
    frame: &mut Frame,
    config: &crate::data::ConfigAccount,
    live_supply: Option<u64>,
    area: Rect,
) {
    let decimals = config.decimals as u32;
    let divisor = 10u64.pow(decimals);

    let format_amount = |amount: u64| -> String {
        if divisor == 0 {
            return amount.to_string();
        }
        let whole = amount / divisor;
        let frac = amount % divisor;
        if decimals == 0 {
            format_with_commas(whole)
        } else {
            format!(
                "{}.{:0>width$}",
                format_with_commas(whole),
                frac,
                width = decimals as usize
            )
        }
    };

    let net_supply = config.total_minted.saturating_sub(config.total_burned);

    let lines = vec![
        Line::from(vec![
            Span::styled(" Total Minted: ", Style::default().fg(CLR_LABEL)),
            Span::styled(
                format_amount(config.total_minted),
                Style::default().fg(CLR_ACTIVE),
            ),
        ]),
        Line::from(vec![
            Span::styled(" Total Burned: ", Style::default().fg(CLR_LABEL)),
            Span::styled(
                format_amount(config.total_burned),
                Style::default().fg(CLR_ERR),
            ),
        ]),
        Line::from(vec![
            Span::styled(" Net Supply:   ", Style::default().fg(CLR_LABEL)),
            Span::styled(
                format_amount(net_supply),
                Style::default().fg(CLR_TITLE).add_modifier(Modifier::BOLD),
            ),
        ]),
        Line::from(vec![
            Span::styled(" Live Supply:  ", Style::default().fg(CLR_LABEL)),
            Span::styled(
                live_supply.map_or("N/A".to_string(), format_amount),
                Style::default().fg(CLR_ACCENT),
            ),
        ]),
    ];

    let block = Block::default()
        .title(" Supply ")
        .title_style(Style::default().fg(CLR_TITLE).add_modifier(Modifier::BOLD))
        .borders(Borders::ALL)
        .border_style(Style::default().fg(CLR_INACTIVE));

    let p = Paragraph::new(lines).block(block);
    frame.render_widget(p, area);
}

fn render_authorities(
    frame: &mut Frame,
    config: &crate::data::ConfigAccount,
    config_pda: &solana_sdk::pubkey::Pubkey,
    mint: &solana_sdk::pubkey::Pubkey,
    area: Rect,
) {
    let lines = vec![
        Line::from(vec![
            Span::styled(" Authority: ", Style::default().fg(CLR_LABEL)),
            Span::styled(
                short_pubkey(&config.master_authority),
                Style::default().fg(CLR_VALUE),
            ),
        ]),
        Line::from(vec![
            Span::styled(" Mint:      ", Style::default().fg(CLR_LABEL)),
            Span::styled(short_pubkey(mint), Style::default().fg(CLR_VALUE)),
        ]),
        Line::from(vec![
            Span::styled(" Config:    ", Style::default().fg(CLR_LABEL)),
            Span::styled(short_pubkey(config_pda), Style::default().fg(CLR_VALUE)),
        ]),
        Line::from(vec![
            Span::styled(" Hook Prog: ", Style::default().fg(CLR_LABEL)),
            Span::styled(
                if config.enable_transfer_hook {
                    short_pubkey(&config.transfer_hook_program)
                } else {
                    "Disabled".to_string()
                },
                Style::default().fg(CLR_VALUE),
            ),
        ]),
    ];

    let block = Block::default()
        .title(" Addresses ")
        .title_style(Style::default().fg(CLR_TITLE).add_modifier(Modifier::BOLD))
        .borders(Borders::ALL)
        .border_style(Style::default().fg(CLR_INACTIVE));

    let p = Paragraph::new(lines).block(block);
    frame.render_widget(p, area);
}

fn render_feature_flags(frame: &mut Frame, config: &crate::data::ConfigAccount, area: Rect) {
    let flag = |enabled: bool| -> (Span, Span) {
        if enabled {
            (
                Span::styled("✔ ", Style::default().fg(CLR_ACTIVE)),
                Span::styled("Enabled", Style::default().fg(CLR_ACTIVE)),
            )
        } else {
            (
                Span::styled("✖ ", Style::default().fg(CLR_INACTIVE)),
                Span::styled("Disabled", Style::default().fg(CLR_INACTIVE)),
            )
        }
    };

    let (pd_icon, pd_text) = flag(config.enable_permanent_delegate);
    let (th_icon, th_text) = flag(config.enable_transfer_hook);
    let (df_icon, df_text) = flag(config.default_account_frozen);

    let lines = vec![
        Line::from(vec![
            Span::styled(" Perm. Delegate: ", Style::default().fg(CLR_LABEL)),
            pd_icon,
            pd_text,
        ]),
        Line::from(vec![
            Span::styled(" Transfer Hook:  ", Style::default().fg(CLR_LABEL)),
            th_icon,
            th_text,
        ]),
        Line::from(vec![
            Span::styled(" Default Frozen: ", Style::default().fg(CLR_LABEL)),
            df_icon,
            df_text,
        ]),
    ];

    let block = Block::default()
        .title(" Feature Flags ")
        .title_style(Style::default().fg(CLR_TITLE).add_modifier(Modifier::BOLD))
        .borders(Borders::ALL)
        .border_style(Style::default().fg(CLR_INACTIVE));

    let p = Paragraph::new(lines).block(block);
    frame.render_widget(p, area);
}

fn render_runtime_state(frame: &mut Frame, data: &StablecoinData, area: Rect) {
    let config = match &data.config {
        Some(c) => c,
        None => return,
    };

    let rows = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Percentage(42),
            Constraint::Percentage(28),
            Constraint::Percentage(30),
        ])
        .split(area);

    // Left: pause state + summary stats
    let pause_badge = if config.paused {
        Span::styled(
            "● PAUSED",
            Style::default().fg(CLR_ERR).add_modifier(Modifier::BOLD),
        )
    } else {
        Span::styled(
            "● ACTIVE",
            Style::default().fg(CLR_ACTIVE).add_modifier(Modifier::BOLD),
        )
    };

    let active_roles = data.roles.iter().filter(|r| r.active).count();
    let total_roles = data.roles.len();
    let active_minters = data
        .minters
        .iter()
        .filter(|m| {
            data.roles
                .iter()
                .any(|r| r.user == m.minter && r.role_type == 0 && r.active)
        })
        .count();

    let lines = vec![
        Line::from(vec![
            Span::styled(" Status:       ", Style::default().fg(CLR_LABEL)),
            pause_badge,
        ]),
        Line::from(vec![
            Span::styled(" Active Roles: ", Style::default().fg(CLR_LABEL)),
            Span::styled(
                format!("{active_roles} / {total_roles}"),
                Style::default().fg(CLR_VALUE),
            ),
        ]),
        Line::from(vec![
            Span::styled(" Minters:      ", Style::default().fg(CLR_LABEL)),
            Span::styled(
                format!("{active_minters} active"),
                Style::default().fg(CLR_VALUE),
            ),
        ]),
        Line::from(vec![
            Span::styled(" Blacklisted:  ", Style::default().fg(CLR_LABEL)),
            Span::styled(
                format!("{} addresses", data.blacklist.len()),
                Style::default().fg(if data.blacklist.is_empty() {
                    CLR_VALUE
                } else {
                    CLR_WARN
                }),
            ),
        ]),
    ];

    let block = Block::default()
        .title(" Runtime State ")
        .title_style(Style::default().fg(CLR_TITLE).add_modifier(Modifier::BOLD))
        .borders(Borders::ALL)
        .border_style(Style::default().fg(CLR_INACTIVE));

    let p = Paragraph::new(lines).block(block);
    frame.render_widget(p, rows[0]);

    // Right: supply gauge (net supply as percentage of total minted)
    let config = data.config.as_ref().unwrap();
    let net = config.total_minted.saturating_sub(config.total_burned);
    let ratio = if config.total_minted > 0 {
        (net as f64 / config.total_minted as f64).min(1.0)
    } else {
        0.0
    };

    let gauge_color = if ratio > 0.9 {
        CLR_ACTIVE
    } else if ratio > 0.5 {
        CLR_WARN
    } else {
        CLR_ERR
    };

    let gauge = Gauge::default()
        .block(
            Block::default()
                .title(" Circulation (net / total minted) ")
                .title_style(Style::default().fg(CLR_TITLE).add_modifier(Modifier::BOLD))
                .borders(Borders::ALL)
                .border_style(Style::default().fg(CLR_INACTIVE)),
        )
        .gauge_style(Style::default().fg(gauge_color))
        .ratio(ratio)
        .label(format!("{:.1}%", ratio * 100.0));

    frame.render_widget(gauge, rows[1]);

    let now = chrono::Local::now();
    let freshness = data.freshness_at(now);
    let freshness_badge = match freshness {
        FetchFreshness::Fresh => Span::styled(
            "● FRESH",
            Style::default().fg(CLR_ACTIVE).add_modifier(Modifier::BOLD),
        ),
        FetchFreshness::Stale => Span::styled(
            "● STALE",
            Style::default().fg(CLR_WARN).add_modifier(Modifier::BOLD),
        ),
        FetchFreshness::Error => Span::styled(
            "● ERROR",
            Style::default().fg(CLR_ERR).add_modifier(Modifier::BOLD),
        ),
        FetchFreshness::Connecting => Span::styled(
            "● CONNECTING",
            Style::default().fg(CLR_WARN).add_modifier(Modifier::BOLD),
        ),
    };
    let blacklist_tone = if data.blacklist.is_empty() {
        CLR_ACTIVE
    } else {
        CLR_ERR
    };
    let telemetry_lines = vec![
        Line::from(vec![
            Span::styled(" Freshness:  ", Style::default().fg(CLR_LABEL)),
            freshness_badge,
        ]),
        Line::from(vec![
            Span::styled(" Last Sync:  ", Style::default().fg(CLR_LABEL)),
            Span::styled(
                data.age_label(now).unwrap_or_else(|| "n/a".to_string()),
                Style::default().fg(CLR_VALUE),
            ),
        ]),
        Line::from(vec![
            Span::styled(" Compliance: ", Style::default().fg(CLR_LABEL)),
            Span::styled(
                if data.blacklist.is_empty() {
                    "clear".to_string()
                } else {
                    format!("{} blocked", data.blacklist.len())
                },
                Style::default().fg(blacklist_tone),
            ),
        ]),
        Line::from(vec![
            Span::styled(" Fetch State: ", Style::default().fg(CLR_LABEL)),
            Span::styled(
                data.error
                    .as_deref()
                    .map(|error| truncate_str(error, 18).to_string())
                    .unwrap_or_else(|| "healthy".to_string()),
                Style::default().fg(if data.error.is_some() {
                    CLR_ERR
                } else {
                    CLR_VALUE
                }),
            ),
        ]),
    ];

    let telemetry = Paragraph::new(telemetry_lines).block(
        Block::default()
            .title(" Telemetry ")
            .title_style(Style::default().fg(CLR_TITLE).add_modifier(Modifier::BOLD))
            .borders(Borders::ALL)
            .border_style(Style::default().fg(CLR_INACTIVE)),
    );

    frame.render_widget(telemetry, rows[2]);
}

// ── Roles tab ───────────────────────────────────────────────────────────────

fn render_roles(frame: &mut Frame, app: &App, data: &StablecoinData, area: Rect) {
    if data.roles.is_empty() {
        let msg = if data.config.is_some() {
            "No roles assigned yet."
        } else {
            "Loading..."
        };
        let p = Paragraph::new(msg)
            .style(Style::default().fg(CLR_WARN))
            .block(section_block(" Roles "));
        frame.render_widget(p, area);
        return;
    }

    let header = Row::new(vec![
        Cell::from("Address").style(Style::default().fg(CLR_TITLE).add_modifier(Modifier::BOLD)),
        Cell::from("Role").style(Style::default().fg(CLR_TITLE).add_modifier(Modifier::BOLD)),
        Cell::from("Status").style(Style::default().fg(CLR_TITLE).add_modifier(Modifier::BOLD)),
    ]);

    let rows: Vec<Row> = data
        .roles
        .iter()
        .enumerate()
        .map(|(i, role)| {
            let style = if i == app.selected {
                Style::default().add_modifier(Modifier::REVERSED)
            } else {
                Style::default()
            };

            let status_style = if role.active {
                Style::default().fg(CLR_ACTIVE)
            } else {
                Style::default().fg(CLR_INACTIVE)
            };

            Row::new(vec![
                Cell::from(short_pubkey(&role.user)),
                Cell::from(role_name(role.role_type)),
                Cell::from(if role.active { "Active" } else { "Inactive" }).style(status_style),
            ])
            .style(style)
        })
        .collect();

    let widths = [
        Constraint::Percentage(50),
        Constraint::Percentage(25),
        Constraint::Percentage(25),
    ];

    let title = format!(
        " Roles ({} total, {} active) ",
        data.roles.len(),
        data.roles.iter().filter(|r| r.active).count()
    );
    let table = Table::new(rows, widths)
        .header(header.style(Style::default()).bottom_margin(1))
        .block(section_block(&title));

    frame.render_widget(table, area);
}

// ── Minters tab ─────────────────────────────────────────────────────────────

fn render_minters(frame: &mut Frame, app: &App, data: &StablecoinData, area: Rect) {
    if data.minters.is_empty() {
        let msg = if data.config.is_some() {
            "No minter quotas assigned yet."
        } else {
            "Loading..."
        };
        let p = Paragraph::new(msg)
            .style(Style::default().fg(CLR_WARN))
            .block(section_block(" Minters "));
        frame.render_widget(p, area);
        return;
    }

    // Split: table (top) + gauge for selected minter (bottom)
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Min(8), Constraint::Length(5)])
        .split(area);

    let header = Row::new(vec![
        Cell::from("Minter").style(Style::default().fg(CLR_TITLE).add_modifier(Modifier::BOLD)),
        Cell::from("Minted").style(Style::default().fg(CLR_TITLE).add_modifier(Modifier::BOLD)),
        Cell::from("Quota").style(Style::default().fg(CLR_TITLE).add_modifier(Modifier::BOLD)),
        Cell::from("Remaining").style(Style::default().fg(CLR_TITLE).add_modifier(Modifier::BOLD)),
        Cell::from("Usage").style(Style::default().fg(CLR_TITLE).add_modifier(Modifier::BOLD)),
    ]);

    let rows: Vec<Row> = data
        .minters
        .iter()
        .enumerate()
        .map(|(i, m)| {
            let remaining = m.quota.saturating_sub(m.minted);
            let pct = if m.quota > 0 {
                (m.minted as f64 / m.quota as f64 * 100.0).min(100.0)
            } else {
                0.0
            };

            let usage_color = if pct > 90.0 {
                CLR_ERR
            } else if pct > 50.0 {
                CLR_WARN
            } else {
                CLR_ACTIVE
            };

            let style = if i == app.selected {
                Style::default().add_modifier(Modifier::REVERSED)
            } else {
                Style::default()
            };

            Row::new(vec![
                Cell::from(short_pubkey(&m.minter)),
                Cell::from(m.minted.to_string()),
                Cell::from(m.quota.to_string()),
                Cell::from(remaining.to_string()),
                Cell::from(format!("{pct:.1}%")).style(Style::default().fg(usage_color)),
            ])
            .style(style)
        })
        .collect();

    let widths = [
        Constraint::Percentage(30),
        Constraint::Percentage(18),
        Constraint::Percentage(18),
        Constraint::Percentage(18),
        Constraint::Percentage(16),
    ];

    let title = format!(" Minter Quotas ({}) ", data.minters.len());
    let table = Table::new(rows, widths)
        .header(header.style(Style::default()).bottom_margin(1))
        .block(section_block(&title));

    frame.render_widget(table, chunks[0]);

    // Bottom: gauge for selected minter
    if let Some(minter) = data.minters.get(app.selected) {
        let ratio = if minter.quota > 0 {
            (minter.minted as f64 / minter.quota as f64).min(1.0)
        } else {
            0.0
        };

        let gauge_color = if ratio > 0.9 {
            CLR_ERR
        } else if ratio > 0.5 {
            CLR_WARN
        } else {
            CLR_ACTIVE
        };

        let remaining = minter.quota.saturating_sub(minter.minted);
        let gauge = Gauge::default()
            .block(
                Block::default()
                    .title(format!(
                        " {} — {} / {} (remaining: {}) ",
                        short_pubkey(&minter.minter),
                        minter.minted,
                        minter.quota,
                        remaining,
                    ))
                    .title_style(Style::default().fg(CLR_TITLE).add_modifier(Modifier::BOLD))
                    .borders(Borders::ALL)
                    .border_style(Style::default().fg(CLR_INACTIVE)),
            )
            .gauge_style(Style::default().fg(gauge_color))
            .ratio(ratio)
            .label(format!("{:.1}%", ratio * 100.0));

        frame.render_widget(gauge, chunks[1]);
    }
}

// ── Blacklist tab ───────────────────────────────────────────────────────────

fn render_blacklist(frame: &mut Frame, app: &App, data: &StablecoinData, area: Rect) {
    // Check if SSS-2 features are enabled
    let is_sss2 = data.config.as_ref().is_some_and(|c| c.enable_transfer_hook);

    if !is_sss2 {
        let p = Paragraph::new(" Blacklist is only available with SSS-2 (transfer hook enabled).")
            .style(Style::default().fg(CLR_WARN))
            .block(section_block(" Blacklist "));
        frame.render_widget(p, area);
        return;
    }

    if data.blacklist.is_empty() {
        let p = Paragraph::new(" No addresses blacklisted.")
            .style(Style::default().fg(CLR_ACTIVE))
            .block(section_block(" Blacklist (0 entries) "));
        frame.render_widget(p, area);
        return;
    }

    let header = Row::new(vec![
        Cell::from("Address").style(Style::default().fg(CLR_TITLE).add_modifier(Modifier::BOLD)),
        Cell::from("Reason").style(Style::default().fg(CLR_TITLE).add_modifier(Modifier::BOLD)),
        Cell::from("Date").style(Style::default().fg(CLR_TITLE).add_modifier(Modifier::BOLD)),
        Cell::from("By").style(Style::default().fg(CLR_TITLE).add_modifier(Modifier::BOLD)),
    ]);

    let rows: Vec<Row> = data
        .blacklist
        .iter()
        .enumerate()
        .map(|(i, entry)| {
            let style = if i == app.selected {
                Style::default().add_modifier(Modifier::REVERSED)
            } else {
                Style::default()
            };

            let timestamp = chrono::DateTime::from_timestamp(entry.blacklisted_at, 0)
                .map(|dt| dt.format("%Y-%m-%d %H:%M").to_string())
                .unwrap_or_else(|| "Unknown".to_string());

            Row::new(vec![
                Cell::from(short_pubkey(&entry.address)),
                Cell::from(truncate_str(&entry.reason, 30).to_string()),
                Cell::from(timestamp),
                Cell::from(short_pubkey(&entry.blacklisted_by)),
            ])
            .style(style)
        })
        .collect();

    let widths = [
        Constraint::Percentage(28),
        Constraint::Percentage(32),
        Constraint::Percentage(20),
        Constraint::Percentage(20),
    ];

    let title = format!(" Blacklist ({} entries) ", data.blacklist.len());
    let table = Table::new(rows, widths)
        .header(header.style(Style::default()).bottom_margin(1))
        .block(section_block(&title));

    frame.render_widget(table, area);
}

// ── Help tab ────────────────────────────────────────────────────────────────

fn render_help(frame: &mut Frame, area: Rect) {
    let lines = vec![
        Line::from(""),
        Line::from(vec![Span::styled(
            "  Navigation",
            Style::default().fg(CLR_TITLE).add_modifier(Modifier::BOLD),
        )]),
        Line::from(vec![
            Span::styled("    Tab / Shift+Tab   ", Style::default().fg(CLR_ACCENT)),
            Span::styled("Cycle between tabs", Style::default().fg(CLR_LABEL)),
        ]),
        Line::from(vec![
            Span::styled("    1-5               ", Style::default().fg(CLR_ACCENT)),
            Span::styled("Jump to tab by number", Style::default().fg(CLR_LABEL)),
        ]),
        Line::from(vec![
            Span::styled("    ↑/↓ or j/k        ", Style::default().fg(CLR_ACCENT)),
            Span::styled("Navigate list items", Style::default().fg(CLR_LABEL)),
        ]),
        Line::from(vec![
            Span::styled("    Home              ", Style::default().fg(CLR_ACCENT)),
            Span::styled("Jump to first item", Style::default().fg(CLR_LABEL)),
        ]),
        Line::from(""),
        Line::from(vec![Span::styled(
            "  Actions",
            Style::default().fg(CLR_TITLE).add_modifier(Modifier::BOLD),
        )]),
        Line::from(vec![
            Span::styled("    r                 ", Style::default().fg(CLR_ACCENT)),
            Span::styled(
                "Refresh data from Solana RPC",
                Style::default().fg(CLR_LABEL),
            ),
        ]),
        Line::from(vec![
            Span::styled("    q / Ctrl+C        ", Style::default().fg(CLR_ACCENT)),
            Span::styled("Quit the dashboard", Style::default().fg(CLR_LABEL)),
        ]),
        Line::from(""),
        Line::from(vec![Span::styled(
            "  About",
            Style::default().fg(CLR_TITLE).add_modifier(Modifier::BOLD),
        )]),
        Line::from(vec![Span::styled(
            "    SSS Admin TUI v0.1.0",
            Style::default().fg(CLR_LABEL),
        )]),
        Line::from(vec![Span::styled(
            "    Solana Stablecoin Standard — Interactive Dashboard",
            Style::default().fg(CLR_LABEL),
        )]),
        Line::from(vec![Span::styled(
            "    Data refreshes automatically; r forces an immediate poll",
            Style::default().fg(CLR_INACTIVE),
        )]),
    ];

    let p = Paragraph::new(lines)
        .block(section_block(" Help "))
        .wrap(Wrap { trim: false });

    frame.render_widget(p, area);
}

// ── Utility functions ───────────────────────────────────────────────────────

/// Create a consistent section block with title and borders.
fn section_block(title: &str) -> Block<'_> {
    Block::default()
        .title(title)
        .title_style(Style::default().fg(CLR_TITLE).add_modifier(Modifier::BOLD))
        .borders(Borders::ALL)
        .border_style(Style::default().fg(CLR_INACTIVE))
}

/// Shorten a pubkey to "xxxx...yyyy" format.
fn short_pubkey(pubkey: &solana_sdk::pubkey::Pubkey) -> String {
    let s = pubkey.to_string();
    if s.len() > 12 {
        format!("{}...{}", &s[..4], &s[s.len() - 4..])
    } else {
        s
    }
}

/// Truncate a string and add "..." if it exceeds max_len.
fn truncate_str(s: &str, max_len: usize) -> &str {
    if s.len() <= max_len {
        s
    } else if max_len > 3 {
        &s[..max_len - 3]
    } else {
        &s[..max_len]
    }
}

/// Format a u64 with comma separators (e.g., 1,234,567).
fn format_with_commas(n: u64) -> String {
    let s = n.to_string();
    let mut result = String::with_capacity(s.len() + s.len() / 3);
    for (i, c) in s.chars().enumerate() {
        if i > 0 && (s.len() - i).is_multiple_of(3) {
            result.push(',');
        }
        result.push(c);
    }
    result
}
