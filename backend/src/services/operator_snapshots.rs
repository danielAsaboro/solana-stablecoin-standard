//! Persisted operator evidence snapshots and summary diffs.

use std::path::PathBuf;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::error::AppError;
use crate::persistence::JsonFileStore;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct OperatorSnapshotSummary {
    pub paused: Option<bool>,
    pub live_supply: Option<u64>,
    pub role_count: Option<usize>,
    pub minter_count: Option<usize>,
    pub blacklist_count: Option<usize>,
    pub incident_count: usize,
    pub active_webhooks: usize,
    pub failing_webhooks: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OperatorSnapshotRecord {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    pub created_at: String,
    pub summary: OperatorSnapshotSummary,
    pub bundle: Value,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct PersistedOperatorSnapshotState {
    snapshots: Vec<OperatorSnapshotRecord>,
}

pub struct OperatorSnapshotService {
    snapshots: RwLock<Vec<OperatorSnapshotRecord>>,
    store: Option<JsonFileStore>,
}

impl OperatorSnapshotService {
    pub fn new() -> Self {
        Self {
            snapshots: RwLock::new(Vec::new()),
            store: None,
        }
    }

    pub fn with_persistence(path: impl Into<PathBuf>) -> Result<Self, AppError> {
        let store = JsonFileStore::new(path)?;
        let persisted: PersistedOperatorSnapshotState = store.load_or_default()?;

        Ok(Self {
            snapshots: RwLock::new(persisted.snapshots),
            store: Some(store),
        })
    }

    pub async fn create_snapshot(
        &self,
        label: Option<String>,
        summary: OperatorSnapshotSummary,
        bundle: Value,
    ) -> OperatorSnapshotRecord {
        let snapshot = OperatorSnapshotRecord {
            id: Uuid::new_v4().to_string(),
            label,
            created_at: Utc::now().to_rfc3339(),
            summary,
            bundle,
        };

        let mut snapshots = self.snapshots.write().await;
        snapshots.push(snapshot.clone());
        snapshots.sort_by(|left, right| right.created_at.cmp(&left.created_at));
        drop(snapshots);
        self.persist_state().await;

        snapshot
    }

    pub async fn list_snapshots(&self, limit: usize) -> Vec<OperatorSnapshotRecord> {
        let snapshots = self.snapshots.read().await;
        let mut list = snapshots.clone();
        list.truncate(limit.min(200));
        list
    }

    pub async fn get_snapshot(&self, id: &str) -> Option<OperatorSnapshotRecord> {
        self.snapshots
            .read()
            .await
            .iter()
            .find(|snapshot| snapshot.id == id)
            .cloned()
    }

    async fn persist_state(&self) {
        let Some(store) = &self.store else {
            return;
        };

        let snapshot = {
            let snapshots = self.snapshots.read().await;
            PersistedOperatorSnapshotState {
                snapshots: snapshots.clone(),
            }
        };

        if let Err(error) = store.save(&snapshot) {
            tracing::error!(
                error = %error,
                path = %store.path().display(),
                "Failed to persist operator snapshots"
            );
        }
    }
}
