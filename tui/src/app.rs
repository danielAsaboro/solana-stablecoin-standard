//! Application state machine for the TUI.
//!
//! Manages tab navigation, selected items, and keyboard input routing.

use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};

/// Available tabs in the dashboard.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tab {
    Dashboard,
    Roles,
    Minters,
    Blacklist,
    Help,
}

impl Tab {
    /// All tabs in display order.
    pub const ALL: [Tab; 5] = [
        Tab::Dashboard,
        Tab::Roles,
        Tab::Minters,
        Tab::Blacklist,
        Tab::Help,
    ];

    /// Tab display name.
    pub fn name(self) -> &'static str {
        match self {
            Tab::Dashboard => "Dashboard",
            Tab::Roles => "Roles",
            Tab::Minters => "Minters",
            Tab::Blacklist => "Blacklist",
            Tab::Help => "Help",
        }
    }

    /// Index in the ALL array.
    pub fn index(self) -> usize {
        match self {
            Tab::Dashboard => 0,
            Tab::Roles => 1,
            Tab::Minters => 2,
            Tab::Blacklist => 3,
            Tab::Help => 4,
        }
    }
}

/// Actions that can result from a key press.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AppAction {
    /// No action needed.
    None,
    /// Quit the application.
    Quit,
    /// Trigger a manual data refresh.
    Refresh,
}

/// Application state.
pub struct App {
    /// Currently active tab.
    pub tab: Tab,
    /// Selected row index within the current tab's list/table.
    pub selected: usize,
    /// Whether the app should quit.
    pub should_quit: bool,
    /// Status message shown in the footer.
    pub status_msg: Option<String>,
}

impl App {
    /// Create a new app with default state.
    pub fn new() -> Self {
        Self {
            tab: Tab::Dashboard,
            selected: 0,
            should_quit: false,
            status_msg: None,
        }
    }

    /// Handle a key event and return the resulting action.
    pub fn handle_key(&mut self, key: KeyEvent) -> AppAction {
        // Ctrl+C always quits
        if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('c') {
            self.should_quit = true;
            return AppAction::Quit;
        }

        match key.code {
            // Quit
            KeyCode::Char('q') => {
                self.should_quit = true;
                AppAction::Quit
            }

            // Manual refresh
            KeyCode::Char('r') => {
                self.status_msg = Some("Refreshing...".to_string());
                AppAction::Refresh
            }

            // Tab navigation: Tab key cycles forward
            KeyCode::Tab => {
                let idx = self.tab.index();
                let next = (idx + 1) % Tab::ALL.len();
                self.tab = Tab::ALL[next];
                self.selected = 0;
                AppAction::None
            }

            // Tab navigation: Shift+Tab cycles backward
            KeyCode::BackTab => {
                let idx = self.tab.index();
                let prev = if idx == 0 { Tab::ALL.len() - 1 } else { idx - 1 };
                self.tab = Tab::ALL[prev];
                self.selected = 0;
                AppAction::None
            }

            // Direct tab selection with number keys
            KeyCode::Char('1') => { self.tab = Tab::Dashboard; self.selected = 0; AppAction::None }
            KeyCode::Char('2') => { self.tab = Tab::Roles; self.selected = 0; AppAction::None }
            KeyCode::Char('3') => { self.tab = Tab::Minters; self.selected = 0; AppAction::None }
            KeyCode::Char('4') => { self.tab = Tab::Blacklist; self.selected = 0; AppAction::None }
            KeyCode::Char('5') => { self.tab = Tab::Help; self.selected = 0; AppAction::None }

            // List navigation
            KeyCode::Up | KeyCode::Char('k') => {
                self.selected = self.selected.saturating_sub(1);
                AppAction::None
            }
            KeyCode::Down | KeyCode::Char('j') => {
                self.selected = self.selected.saturating_add(1);
                AppAction::None
            }
            KeyCode::Home => {
                self.selected = 0;
                AppAction::None
            }

            _ => AppAction::None,
        }
    }

    /// Clamp the selected index to a valid range for the current list size.
    pub fn clamp_selected(&mut self, max_items: usize) {
        if max_items == 0 {
            self.selected = 0;
        } else if self.selected >= max_items {
            self.selected = max_items - 1;
        }
    }
}
