//! Unified persistence backend supporting both file-based JSON and Redis storage.
//!
//! [`CacheBackend`] wraps either a [`JsonFileStore`] or a [`RedisCache`] connection,
//! providing a common `load`/`save` interface that services use to persist state.
//! This allows services to remain agnostic about the underlying storage mechanism.

use std::path::PathBuf;

use redis::aio::ConnectionManager;
use serde::de::DeserializeOwned;
use serde::Serialize;

use crate::error::AppError;
use crate::persistence::JsonFileStore;

/// Redis connection pool wrapper providing get/set/delete operations.
#[derive(Clone)]
pub struct RedisCache {
    pool: ConnectionManager,
}

impl RedisCache {
    pub async fn new(url: &str) -> Result<Self, AppError> {
        let client = redis::Client::open(url).map_err(|e| {
            AppError::Internal(format!("Failed to create Redis client: {e}"))
        })?;
        let pool = ConnectionManager::new(client).await.map_err(|e| {
            AppError::Internal(format!("Failed to connect to Redis: {e}"))
        })?;
        Ok(Self { pool })
    }

    pub async fn get<T: DeserializeOwned>(&self, key: &str) -> Result<Option<T>, AppError> {
        let mut conn = self.pool.clone();
        let value: Option<String> = redis::cmd("GET")
            .arg(key)
            .query_async(&mut conn)
            .await
            .map_err(|e| AppError::Internal(format!("Redis GET failed: {e}")))?;
        match value {
            Some(json) => {
                let parsed = serde_json::from_str(&json).map_err(|e| {
                    AppError::Internal(format!("Failed to deserialize Redis value: {e}"))
                })?;
                Ok(Some(parsed))
            }
            None => Ok(None),
        }
    }

    pub async fn set<T: Serialize>(&self, key: &str, value: &T) -> Result<(), AppError> {
        let json = serde_json::to_string(value).map_err(|e| {
            AppError::Internal(format!("Failed to serialize for Redis: {e}"))
        })?;
        let mut conn = self.pool.clone();
        redis::cmd("SET")
            .arg(key)
            .arg(&json)
            .query_async::<()>(&mut conn)
            .await
            .map_err(|e| AppError::Internal(format!("Redis SET failed: {e}")))?;
        Ok(())
    }

    pub async fn delete(&self, key: &str) -> Result<(), AppError> {
        let mut conn = self.pool.clone();
        redis::cmd("DEL")
            .arg(key)
            .query_async::<()>(&mut conn)
            .await
            .map_err(|e| AppError::Internal(format!("Redis DEL failed: {e}")))?;
        Ok(())
    }
}

/// Unified persistence backend supporting both file and Redis storage.
#[derive(Clone)]
pub enum CacheBackend {
    File(JsonFileStore),
    Redis { cache: RedisCache, key_prefix: String },
}

impl CacheBackend {
    pub fn file(path: impl Into<PathBuf>) -> Result<Self, AppError> {
        Ok(Self::File(JsonFileStore::new(path)?))
    }

    pub fn redis(cache: RedisCache, key_prefix: impl Into<String>) -> Self {
        Self::Redis { cache, key_prefix: key_prefix.into() }
    }

    pub async fn load<T: DeserializeOwned + Default>(&self) -> Result<T, AppError> {
        match self {
            Self::File(store) => store.load_or_default(),
            Self::Redis { cache, key_prefix } => {
                cache.get(key_prefix).await.map(|opt| opt.unwrap_or_default())
            }
        }
    }

    pub async fn save<T: Serialize>(&self, value: &T) -> Result<(), AppError> {
        match self {
            Self::File(store) => store.save(value),
            Self::Redis { cache, key_prefix } => cache.set(key_prefix, value).await,
        }
    }
}
