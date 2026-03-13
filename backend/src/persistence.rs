use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde::de::DeserializeOwned;
use uuid::Uuid;

use crate::error::AppError;

#[derive(Debug, Clone)]
pub struct JsonFileStore {
    path: PathBuf,
}

impl JsonFileStore {
    pub fn new(path: impl Into<PathBuf>) -> Result<Self, AppError> {
        let path = path.into();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| {
                AppError::Internal(format!(
                    "Failed to create persistence directory '{}': {e}",
                    parent.display()
                ))
            })?;
        }
        Ok(Self { path })
    }

    pub fn load_or_default<T>(&self) -> Result<T, AppError>
    where
        T: DeserializeOwned + Default,
    {
        if !self.path.exists() {
            return Ok(T::default());
        }

        let bytes = fs::read(&self.path).map_err(|e| {
            AppError::Internal(format!(
                "Failed to read persistence file '{}': {e}",
                self.path.display()
            ))
        })?;

        if bytes.is_empty() {
            return Ok(T::default());
        }

        serde_json::from_slice(&bytes).map_err(|e| {
            AppError::Internal(format!(
                "Failed to parse persistence file '{}': {e}",
                self.path.display()
            ))
        })
    }

    pub fn save<T>(&self, value: &T) -> Result<(), AppError>
    where
        T: Serialize,
    {
        let payload = serde_json::to_vec_pretty(value).map_err(|e| {
            AppError::Internal(format!(
                "Failed to serialize persistence payload for '{}': {e}",
                self.path.display()
            ))
        })?;

        let tmp_path = temp_path_for(&self.path);
        fs::write(&tmp_path, payload).map_err(|e| {
            AppError::Internal(format!(
                "Failed to write persistence temp file '{}': {e}",
                tmp_path.display()
            ))
        })?;
        fs::rename(&tmp_path, &self.path).map_err(|e| {
            AppError::Internal(format!(
                "Failed to replace persistence file '{}' with '{}': {e}",
                self.path.display(),
                tmp_path.display()
            ))
        })?;

        Ok(())
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

fn temp_path_for(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("state.json");
    path.with_file_name(format!("{file_name}.{}.tmp", Uuid::new_v4()))
}
