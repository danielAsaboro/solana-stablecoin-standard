//! Operator timeline and evidence routes.

use std::cmp::Reverse;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use axum::{
    extract::{Json as ExtractJson, Path, Query, State},
    http::{
        header::{self, HeaderMap, HeaderValue},
        StatusCode,
    },
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::error::AppError;
use crate::services::compliance::{ComplianceAction, ComplianceOperation, ComplianceStatus};
use crate::services::indexer::{EventFilter, IndexedEvent};
use crate::services::mint_burn::{MintBurnOperation, OperationStatus};
use crate::services::operator_snapshots::{OperatorSnapshotRecord, OperatorSnapshotSummary};
use crate::services::webhook::{DeliveryRecord, DeliveryStatus, WebhookRegistration};
use crate::AppState;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TimelineSource {
    Operations,
    Indexer,
    Compliance,
    Webhook,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TimelineSeverity {
    Info,
    Success,
    Warning,
    Critical,
}

#[derive(Debug, Clone, Serialize)]
pub struct TimelineRecord {
    pub id: String,
    pub source: TimelineSource,
    pub occurred_at: String,
    pub action: String,
    pub severity: TimelineSeverity,
    pub status: String,
    pub summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub event_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signature: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub authority: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_address: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub webhook_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub replayed_from: Option<String>,
    pub correlation_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TimelineIncident {
    pub id: String,
    pub occurred_at: String,
    pub action: String,
    pub severity: TimelineSeverity,
    pub status: String,
    pub summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signature: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub authority: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_address: Option<String>,
    pub sources: Vec<TimelineSource>,
    pub related_count: usize,
    pub records: Vec<TimelineRecord>,
}

#[derive(Debug, Serialize)]
pub struct OperatorEvidenceBundle {
    pub generated_at: String,
    pub summary: OperatorSnapshotSummary,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime: Option<Value>,
    pub incidents: Vec<TimelineIncident>,
    pub audit_export: Vec<Value>,
    pub webhooks: Vec<WebhookRegistration>,
    pub deliveries: Vec<DeliveryRecord>,
}

#[derive(Debug, Serialize)]
pub struct OperatorSnapshotDiff {
    pub from_snapshot_id: String,
    pub to_snapshot_id: String,
    pub from_created_at: String,
    pub to_created_at: String,
    pub changes: Value,
}

#[derive(Debug, Deserialize)]
pub struct TimelineQuery {
    pub limit: Option<usize>,
    pub source: Option<String>,
    pub severity: Option<String>,
    pub action: Option<String>,
    pub status: Option<String>,
    pub address: Option<String>,
    pub authority: Option<String>,
    pub signature: Option<String>,
    pub date_from: Option<String>,
    pub date_to: Option<String>,
    pub format: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SnapshotQuery {
    pub limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
pub struct SnapshotRequest {
    pub label: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SnapshotDiffQuery {
    pub from: String,
    pub to: String,
}

#[derive(Debug, Deserialize)]
pub struct IncidentReplayQuery {
    pub webhook_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TimelineOutputFormat {
    Json,
    Jsonl,
    Csv,
}

impl TimelineOutputFormat {
    fn from_request(query: &TimelineQuery, headers: &HeaderMap) -> Self {
        match query.format.as_deref() {
            Some("jsonl" | "ndjson" | "application/x-ndjson") => Self::Jsonl,
            Some("csv" | "text/csv") => Self::Csv,
            _ => {
                let accept = headers
                    .get(header::ACCEPT)
                    .and_then(|value| value.to_str().ok())
                    .unwrap_or_default();
                if accept.contains("application/x-ndjson") {
                    Self::Jsonl
                } else if accept.contains("text/csv") {
                    Self::Csv
                } else {
                    Self::Json
                }
            }
        }
    }
}

fn parse_csv_set(value: &Option<String>) -> Option<HashSet<String>> {
    value.as_ref().map(|raw| {
        raw.split(',')
            .map(|item| item.trim().to_lowercase())
            .filter(|item| !item.is_empty())
            .collect()
    })
}

fn parse_iso(value: &Option<String>) -> Option<DateTime<Utc>> {
    value
        .as_ref()
        .and_then(|candidate| DateTime::parse_from_rfc3339(candidate).ok())
        .map(|value| value.with_timezone(&Utc))
}

fn occurred_at_datetime(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|value| value.with_timezone(&Utc))
}

fn severity_rank(severity: &TimelineSeverity) -> u8 {
    match severity {
        TimelineSeverity::Critical => 4,
        TimelineSeverity::Warning => 3,
        TimelineSeverity::Success => 2,
        TimelineSeverity::Info => 1,
    }
}

fn incident_source_rank(source: TimelineSource) -> u8 {
    match source {
        TimelineSource::Operations => 0,
        TimelineSource::Indexer => 1,
        TimelineSource::Compliance => 2,
        TimelineSource::Webhook => 3,
    }
}

fn source_label(source: TimelineSource) -> &'static str {
    match source {
        TimelineSource::Operations => "operations",
        TimelineSource::Indexer => "indexer",
        TimelineSource::Compliance => "compliance",
        TimelineSource::Webhook => "webhook",
    }
}

fn source_allowed(source: TimelineSource, filter: &Option<HashSet<String>>) -> bool {
    filter
        .as_ref()
        .is_none_or(|set| set.contains(source_label(source)))
}

fn severity_allowed(severity: &TimelineSeverity, filter: &Option<HashSet<String>>) -> bool {
    filter.as_ref().is_none_or(|set| {
        let value = match severity {
            TimelineSeverity::Info => "info",
            TimelineSeverity::Success => "success",
            TimelineSeverity::Warning => "warning",
            TimelineSeverity::Critical => "critical",
        };
        set.contains(value)
    })
}

fn action_allowed(action: &str, filter: &Option<String>) -> bool {
    filter
        .as_ref()
        .is_none_or(|candidate| action.eq_ignore_ascii_case(candidate))
}

fn text_contains(value: &Option<String>, needle: &Option<String>) -> bool {
    needle
        .as_ref()
        .is_none_or(|candidate| value.as_ref().is_some_and(|value| value.contains(candidate)))
}

fn iso_from_unix(timestamp: Option<i64>) -> String {
    timestamp
        .and_then(|seconds| chrono::DateTime::from_timestamp(seconds, 0))
        .map(|value| value.to_rfc3339())
        .unwrap_or_else(|| chrono::Utc::now().to_rfc3339())
}

fn string_field(data: &Value, key: &str) -> Option<String> {
    data.get(key).and_then(|value| value.as_str()).map(str::to_string)
}

fn bool_field(data: &Value, key: &str) -> Option<bool> {
    data.get(key).and_then(|value| value.as_bool())
}

fn action_for_event(event_type: &str) -> String {
    match event_type {
        "StablecoinInitialized" => "initialize",
        "TokensMinted" => "mint",
        "TokensBurned" => "burn",
        "AccountFrozen" => "freeze",
        "AccountThawed" => "thaw",
        "StablecoinPaused" => "pause",
        "StablecoinUnpaused" => "unpause",
        "RoleUpdated" => "role.update",
        "MinterQuotaUpdated" => "minter.update",
        "AuthorityTransferred" => "authority.transfer",
        "AddressBlacklisted" => "blacklist.add",
        "AddressUnblacklisted" => "blacklist.remove",
        "TokensSeized" => "seize",
        _ => "event",
    }
    .to_string()
}

fn event_record(event: IndexedEvent) -> TimelineRecord {
    let action = action_for_event(&event.event_type);
    let severity = match event.event_type.as_str() {
        "StablecoinPaused" | "AccountFrozen" => TimelineSeverity::Warning,
        "AddressBlacklisted" | "AddressUnblacklisted" | "TokensSeized" => TimelineSeverity::Critical,
        "RoleUpdated" if bool_field(&event.data, "active") == Some(false) => TimelineSeverity::Warning,
        _ => TimelineSeverity::Success,
    };
    let status = match event.event_type.as_str() {
        "StablecoinPaused" => "paused",
        "StablecoinUnpaused" => "active",
        "AccountFrozen" => "frozen",
        "AccountThawed" => "thawed",
        "AddressBlacklisted" => "restricted",
        "AddressUnblacklisted" => "cleared",
        _ => "confirmed",
    }
    .to_string();
    let authority = match event.event_type.as_str() {
        "StablecoinInitialized" | "AccountFrozen" | "AccountThawed" | "StablecoinPaused" | "StablecoinUnpaused" => {
            string_field(&event.data, "authority")
        }
        "TokensMinted" => string_field(&event.data, "minter"),
        "TokensBurned" => string_field(&event.data, "burner"),
        "RoleUpdated" | "MinterQuotaUpdated" => string_field(&event.data, "updated_by"),
        "AddressBlacklisted" => string_field(&event.data, "blacklisted_by"),
        "AddressUnblacklisted" => string_field(&event.data, "removed_by"),
        "TokensSeized" => string_field(&event.data, "seized_by"),
        _ => None,
    };
    let target_address = match event.event_type.as_str() {
        "TokensMinted" => string_field(&event.data, "recipient"),
        "TokensBurned" | "TokensSeized" => string_field(&event.data, "from"),
        "AccountFrozen" | "AccountThawed" => string_field(&event.data, "account"),
        "RoleUpdated" => string_field(&event.data, "user"),
        "MinterQuotaUpdated" => string_field(&event.data, "minter"),
        "AuthorityTransferred" => string_field(&event.data, "new_authority"),
        "AddressBlacklisted" | "AddressUnblacklisted" => string_field(&event.data, "address"),
        _ => None,
    };

    TimelineRecord {
        id: event.id,
        source: TimelineSource::Indexer,
        occurred_at: iso_from_unix(event.timestamp),
        action: action.clone(),
        severity,
        status,
        summary: format!("Indexed {action} event: {}", event.event_type),
        event_type: Some(event.event_type),
        signature: Some(event.signature.clone()),
        authority,
        target_address,
        webhook_id: None,
        replayed_from: None,
        correlation_id: format!("tx:{}", event.signature),
        details: Some(event.data),
    }
}

fn compliance_record(operation: ComplianceOperation) -> TimelineRecord {
    let action = match operation.action {
        ComplianceAction::Blacklist => "blacklist.add",
        ComplianceAction::Unblacklist => "blacklist.remove",
        ComplianceAction::Check => "blacklist.check",
    }
    .to_string();
    let severity = match operation.status {
        ComplianceStatus::Completed => TimelineSeverity::Info,
        ComplianceStatus::Executing => TimelineSeverity::Warning,
        ComplianceStatus::Failed => TimelineSeverity::Critical,
    };
    let status = match operation.status {
        ComplianceStatus::Completed => "completed",
        ComplianceStatus::Executing => "executing",
        ComplianceStatus::Failed => "failed",
    }
    .to_string();
    let summary = match operation.action {
        ComplianceAction::Blacklist => "Compliance blacklist operation",
        ComplianceAction::Unblacklist => "Compliance unblacklist operation",
        ComplianceAction::Check => "Compliance blacklist check",
    }
    .to_string();
    let correlation_id = operation
        .signature
        .as_ref()
        .map(|signature| format!("tx:{signature}"))
        .unwrap_or_else(|| format!("compliance:{}", operation.id));

    TimelineRecord {
        id: operation.id,
        source: TimelineSource::Compliance,
        occurred_at: operation
            .completed_at
            .clone()
            .unwrap_or(operation.created_at.clone()),
        action,
        severity,
        status,
        summary,
        event_type: None,
        signature: operation.signature,
        authority: Some(operation.authority),
        target_address: Some(operation.address),
        webhook_id: None,
        replayed_from: None,
        correlation_id,
        details: Some(json!({
            "reason": operation.reason,
            "error": operation.error,
        })),
    }
}

fn operation_record(operation: MintBurnOperation) -> TimelineRecord {
    let severity = match operation.status {
        OperationStatus::Pending | OperationStatus::Executing => TimelineSeverity::Warning,
        OperationStatus::Completed => TimelineSeverity::Success,
        OperationStatus::Failed => TimelineSeverity::Critical,
    };
    let status = match operation.status {
        OperationStatus::Pending => "pending",
        OperationStatus::Executing => "executing",
        OperationStatus::Completed => "completed",
        OperationStatus::Failed => "failed",
    }
    .to_string();
    let correlation_id = operation
        .signature
        .as_ref()
        .map(|signature| format!("tx:{signature}"))
        .unwrap_or_else(|| format!("operation:{}", operation.id));

    TimelineRecord {
        id: operation.id,
        source: TimelineSource::Operations,
        occurred_at: operation
            .completed_at
            .clone()
            .unwrap_or(operation.created_at.clone()),
        action: operation.operation_type.clone(),
        severity,
        status: status.clone(),
        summary: format!(
            "{} operation {status} for {}",
            operation.operation_type.to_uppercase(),
            operation.target
        ),
        event_type: None,
        signature: operation.signature,
        authority: Some(operation.authority),
        target_address: Some(operation.target),
        webhook_id: None,
        replayed_from: None,
        correlation_id,
        details: Some(json!({
            "amount": operation.amount,
            "error": operation.error,
        })),
    }
}

fn webhook_record(delivery: DeliveryRecord) -> TimelineRecord {
    let severity = match delivery.status {
        DeliveryStatus::Delivered => TimelineSeverity::Success,
        DeliveryStatus::Pending => TimelineSeverity::Warning,
        DeliveryStatus::Failed => TimelineSeverity::Critical,
    };
    let status = match delivery.status {
        DeliveryStatus::Delivered => "delivered",
        DeliveryStatus::Pending => "pending",
        DeliveryStatus::Failed => "failed",
    }
    .to_string();
    let signature = delivery.transaction_signature.clone();
    let correlation_id = delivery
        .correlation_id
        .clone()
        .or_else(|| signature.as_ref().map(|value| format!("tx:{value}")))
        .unwrap_or_else(|| format!("delivery:{}", delivery.id));

    TimelineRecord {
        id: delivery.id.clone(),
        source: TimelineSource::Webhook,
        occurred_at: delivery
            .last_attempt_at
            .clone()
            .unwrap_or_else(|| delivery.created_at.clone()),
        action: format!("webhook.{status}"),
        severity,
        status: status.clone(),
        summary: format!("Webhook delivery {status} for {}", delivery.event_type),
        event_type: Some(delivery.event_type.clone()),
        signature,
        authority: None,
        target_address: None,
        webhook_id: Some(delivery.webhook_id.clone()),
        replayed_from: delivery.replayed_from.clone(),
        correlation_id,
        details: Some(json!({
            "attempts": delivery.attempts,
            "response_code": delivery.response_code,
            "error": delivery.error,
            "payload": delivery.payload,
        })),
    }
}

fn record_matches(
    record: &TimelineRecord,
    severity_filter: &Option<HashSet<String>>,
    action_filter: &Option<String>,
    query: &TimelineQuery,
    date_from: Option<DateTime<Utc>>,
    date_to: Option<DateTime<Utc>>,
) -> bool {
    if !severity_allowed(&record.severity, severity_filter) || !action_allowed(&record.action, action_filter) {
        return false;
    }

    if let Some(status) = &query.status {
        if !record.status.eq_ignore_ascii_case(status) {
            return false;
        }
    }

    if !text_contains(&record.target_address, &query.address)
        && !query.address.as_ref().is_none_or(|address| record.summary.contains(address))
    {
        return false;
    }

    if !text_contains(&record.authority, &query.authority) {
        return false;
    }

    if !text_contains(&record.signature, &query.signature) {
        return false;
    }

    if let Some(occurred_at) = occurred_at_datetime(&record.occurred_at) {
        if let Some(from) = date_from {
            if occurred_at < from {
                return false;
            }
        }
        if let Some(to) = date_to {
            if occurred_at > to {
                return false;
            }
        }
    }

    true
}

async fn build_records(state: &AppState, fetch_limit: usize, query: &TimelineQuery) -> Vec<TimelineRecord> {
    let source_filter = parse_csv_set(&query.source);
    let severity_filter = parse_csv_set(&query.severity);
    let action_filter = query.action.as_ref().map(|value| value.to_lowercase());
    let date_from = parse_iso(&query.date_from);
    let date_to = parse_iso(&query.date_to);
    let mut records = Vec::new();

    if source_allowed(TimelineSource::Operations, &source_filter) {
        if let Some(mint_burn) = &state.mint_burn {
            let operations = mint_burn.list_operations(fetch_limit).await;
            records.extend(
                operations
                    .into_iter()
                    .map(operation_record)
                    .filter(|record| {
                        record_matches(record, &severity_filter, &action_filter, query, date_from, date_to)
                    }),
            );
        }
    }

    if source_allowed(TimelineSource::Indexer, &source_filter) {
        if let Some(indexer) = &state.indexer {
            let events = indexer
                .get_events(EventFilter {
                    event_type: None,
                    limit: Some(fetch_limit),
                    before_signature: None,
                })
                .await;
            records.extend(
                events
                    .into_iter()
                    .map(event_record)
                    .filter(|record| {
                        record_matches(record, &severity_filter, &action_filter, query, date_from, date_to)
                    }),
            );
        }
    }

    if source_allowed(TimelineSource::Compliance, &source_filter) {
        if let Some(compliance) = &state.compliance {
            let operations = compliance.list_operations(fetch_limit).await;
            records.extend(
                operations
                    .into_iter()
                    .map(compliance_record)
                    .filter(|record| {
                        record_matches(record, &severity_filter, &action_filter, query, date_from, date_to)
                    }),
            );
        }
    }

    if source_allowed(TimelineSource::Webhook, &source_filter) {
        let deliveries = state.webhook.get_delivery_log(fetch_limit).await;
        records.extend(
            deliveries
                .into_iter()
                .map(webhook_record)
                .filter(|record| {
                    record_matches(record, &severity_filter, &action_filter, query, date_from, date_to)
                }),
        );
    }

    records
}

fn build_incidents(mut records: Vec<TimelineRecord>, limit: usize) -> Vec<TimelineIncident> {
    records.sort_by_key(|record| Reverse(record.occurred_at.clone()));
    let mut grouped: HashMap<String, Vec<TimelineRecord>> = HashMap::new();
    let mut order: Vec<String> = Vec::new();

    for record in records {
        if !grouped.contains_key(&record.correlation_id) {
            order.push(record.correlation_id.clone());
        }
        grouped
            .entry(record.correlation_id.clone())
            .or_default()
            .push(record);
    }

    let mut incidents = order
        .into_iter()
        .filter_map(|correlation_id| {
            let mut records = grouped.remove(&correlation_id)?;
            records.sort_by_key(|record| Reverse(record.occurred_at.clone()));
            let primary = records
                .iter()
                .min_by_key(|record| {
                    (
                        incident_source_rank(record.source),
                        Reverse(record.occurred_at.clone()),
                    )
                })?
                .clone();
            let mut sources: Vec<TimelineSource> = records.iter().map(|record| record.source).collect();
            sources.sort_by_key(|source| incident_source_rank(*source));
            sources.dedup();

            let severity = records
                .iter()
                .map(|record| record.severity.clone())
                .max_by_key(severity_rank)
                .unwrap_or(TimelineSeverity::Info);
            let summary = if records.len() == 1 {
                primary.summary.clone()
            } else {
                format!(
                    "{} with {} related records across {}",
                    primary.summary,
                    records.len() - 1,
                    sources
                        .iter()
                        .map(|source| source_label(*source))
                        .collect::<Vec<_>>()
                        .join(", ")
                )
            };

            Some(TimelineIncident {
                id: correlation_id,
                occurred_at: primary.occurred_at.clone(),
                action: primary.action.clone(),
                severity,
                status: primary.status.clone(),
                summary,
                signature: primary.signature.clone(),
                authority: primary.authority.clone(),
                target_address: primary.target_address.clone(),
                sources,
                related_count: records.len(),
                records,
            })
        })
        .collect::<Vec<_>>();

    incidents.sort_by_key(|incident| Reverse(incident.occurred_at.clone()));
    incidents.truncate(limit);
    incidents
}

fn render_jsonl<T: Serialize>(items: &[T]) -> Result<String, AppError> {
    let lines = items
        .iter()
        .map(serde_json::to_string)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| AppError::Internal(format!("Failed to serialize operator export: {error}")))?;
    Ok(lines.join("\n"))
}

fn render_csv(incidents: &[TimelineIncident]) -> String {
    let mut lines = vec![
        "incident_id,occurred_at,action,severity,status,signature,authority,target_address,sources,related_count,summary".to_string(),
    ];

    for incident in incidents {
        let cells = [
            incident.id.clone(),
            incident.occurred_at.clone(),
            incident.action.clone(),
            serde_json::to_string(&incident.severity).unwrap_or_else(|_| "\"info\"".to_string()),
            incident.status.clone(),
            incident.signature.clone().unwrap_or_default(),
            incident.authority.clone().unwrap_or_default(),
            incident.target_address.clone().unwrap_or_default(),
            incident
                .sources
                .iter()
                .map(|source| source_label(*source))
                .collect::<Vec<_>>()
                .join("|"),
            incident.related_count.to_string(),
            incident.summary.clone(),
        ];

        lines.push(
            cells
                .into_iter()
                .map(|cell| format!("\"{}\"", cell.replace('"', "\"\"")))
                .collect::<Vec<_>>()
                .join(","),
        );
    }

    lines.join("\n")
}

async fn build_evidence_bundle(
    state: &AppState,
    incident_limit: usize,
) -> Result<OperatorEvidenceBundle, AppError> {
    let timeline_query = TimelineQuery {
        limit: Some(incident_limit),
        source: None,
        severity: None,
        action: None,
        status: None,
        address: None,
        authority: None,
        signature: None,
        date_from: None,
        date_to: None,
        format: None,
    };
    let records = build_records(state, incident_limit.saturating_mul(4).min(500), &timeline_query).await;
    let incidents = build_incidents(records, incident_limit);
    let deliveries = state.webhook.get_delivery_log(incident_limit).await;
    let webhooks = state.webhook.list_registrations().await;
    let audit_export = if let Some(compliance) = &state.compliance {
        compliance
            .list_audit_log(incident_limit)
            .await
            .into_iter()
            .map(|operation| {
                json!({
                    "id": operation.id,
                    "action": match operation.action {
                        ComplianceAction::Blacklist => "blacklist",
                        ComplianceAction::Unblacklist => "unblacklist",
                        ComplianceAction::Check => "check",
                    },
                    "status": match operation.status {
                        ComplianceStatus::Executing => "executing",
                        ComplianceStatus::Completed => "completed",
                        ComplianceStatus::Failed => "failed",
                    },
                    "address": operation.address,
                    "reason": operation.reason,
                    "signature": operation.signature,
                    "authority": operation.authority,
                    "timestamp": operation.completed_at.unwrap_or(operation.created_at),
                    "error": operation.error,
                })
            })
            .collect()
    } else {
        Vec::new()
    };

    let summary = OperatorSnapshotSummary {
        paused: None,
        live_supply: None,
        role_count: None,
        minter_count: None,
        blacklist_count: None,
        incident_count: incidents.len(),
        active_webhooks: webhooks.iter().filter(|webhook| webhook.active).count(),
        failing_webhooks: webhooks
            .iter()
            .filter(|webhook| webhook.failure_count > 0)
            .count(),
    };

    let runtime = state.mint_burn.as_ref().map(|service| {
        json!({
            "service_pubkey": service.service_pubkey(),
            "mint_address": service.mint_address(),
            "config_address": service.config_address(),
            "program_id": service.program_id(),
        })
    });

    Ok(OperatorEvidenceBundle {
        generated_at: Utc::now().to_rfc3339(),
        summary,
        runtime,
        incidents,
        audit_export,
        webhooks,
        deliveries,
    })
}

fn delta_i128(from: Option<u64>, to: Option<u64>) -> Option<i128> {
    match (from, to) {
        (Some(from), Some(to)) => Some(to as i128 - from as i128),
        _ => None,
    }
}

fn delta_i64(from: Option<usize>, to: Option<usize>) -> Option<i64> {
    match (from, to) {
        (Some(from), Some(to)) => Some(to as i64 - from as i64),
        _ => None,
    }
}

fn snapshot_diff(from: &OperatorSnapshotRecord, to: &OperatorSnapshotRecord) -> OperatorSnapshotDiff {
    let changes = json!({
        "paused": {
            "from": from.summary.paused,
            "to": to.summary.paused,
        },
        "live_supply_delta": delta_i128(from.summary.live_supply, to.summary.live_supply),
        "role_count_delta": delta_i64(from.summary.role_count, to.summary.role_count),
        "minter_count_delta": delta_i64(from.summary.minter_count, to.summary.minter_count),
        "blacklist_count_delta": delta_i64(from.summary.blacklist_count, to.summary.blacklist_count),
        "incident_count_delta": to.summary.incident_count as i64 - from.summary.incident_count as i64,
        "active_webhooks_delta": to.summary.active_webhooks as i64 - from.summary.active_webhooks as i64,
        "failing_webhooks_delta": to.summary.failing_webhooks as i64 - from.summary.failing_webhooks as i64,
    });

    OperatorSnapshotDiff {
        from_snapshot_id: from.id.clone(),
        to_snapshot_id: to.id.clone(),
        from_created_at: from.created_at.clone(),
        to_created_at: to.created_at.clone(),
        changes,
    }
}

async fn list_timeline(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<TimelineQuery>,
) -> Result<Response, AppError> {
    let limit = query.limit.unwrap_or(50).min(200);
    let fetch_limit = limit.saturating_mul(6).min(800);
    let incidents = build_incidents(build_records(&state, fetch_limit, &query).await, limit);

    match TimelineOutputFormat::from_request(&query, &headers) {
        TimelineOutputFormat::Json => Ok(Json(incidents).into_response()),
        TimelineOutputFormat::Jsonl => Ok((
            [(header::CONTENT_TYPE, HeaderValue::from_static("application/x-ndjson"))],
            render_jsonl(&incidents)?,
        )
            .into_response()),
        TimelineOutputFormat::Csv => Ok((
            [(header::CONTENT_TYPE, HeaderValue::from_static("text/csv"))],
            render_csv(&incidents),
        )
            .into_response()),
    }
}

async fn get_incident(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<TimelineIncident>, AppError> {
    let query = TimelineQuery {
        limit: Some(500),
        source: None,
        severity: None,
        action: None,
        status: None,
        address: None,
        authority: None,
        signature: None,
        date_from: None,
        date_to: None,
        format: None,
    };
    let incidents = build_incidents(build_records(&state, 800, &query).await, 500);
    incidents
        .into_iter()
        .find(|incident| incident.id == id)
        .map(Json)
        .ok_or_else(|| AppError::NotFound(format!("Incident '{id}' not found")))
}

async fn redeliver_incident(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<IncidentReplayQuery>,
) -> Result<(StatusCode, Json<Vec<DeliveryRecord>>), AppError> {
    let query_all = TimelineQuery {
        limit: Some(500),
        source: None,
        severity: None,
        action: None,
        status: None,
        address: None,
        authority: None,
        signature: None,
        date_from: None,
        date_to: None,
        format: None,
    };
    let incident = build_incidents(build_records(&state, 800, &query_all).await, 500)
        .into_iter()
        .find(|incident| incident.id == id)
        .ok_or_else(|| AppError::NotFound(format!("Incident '{id}' not found")))?;
    let delivery_ids = incident
        .records
        .iter()
        .filter(|record| record.source == TimelineSource::Webhook)
        .filter(|record| {
            query
                .webhook_id
                .as_ref()
                .is_none_or(|webhook_id| record.webhook_id.as_ref() == Some(webhook_id))
        })
        .map(|record| record.id.clone())
        .collect::<Vec<_>>();

    if delivery_ids.is_empty() {
        return Err(AppError::NotFound(format!(
            "Incident '{}' has no matching webhook deliveries to replay",
            incident.id
        )));
    }

    let mut replayed = Vec::new();
    for delivery_id in delivery_ids {
        replayed.push(Arc::clone(&state.webhook).redeliver(&delivery_id).await?);
    }

    Ok((StatusCode::ACCEPTED, Json(replayed)))
}

async fn get_evidence_bundle(
    State(state): State<AppState>,
) -> Result<Json<OperatorEvidenceBundle>, AppError> {
    Ok(Json(build_evidence_bundle(&state, 25).await?))
}

async fn create_snapshot(
    State(state): State<AppState>,
    ExtractJson(request): ExtractJson<SnapshotRequest>,
) -> Result<(StatusCode, Json<OperatorSnapshotRecord>), AppError> {
    let bundle = build_evidence_bundle(&state, 25).await?;
    let summary = bundle.summary.clone();
    let bundle_value = serde_json::to_value(&bundle)
        .map_err(|error| AppError::Internal(format!("Failed to serialize evidence bundle: {error}")))?;
    let snapshot = state
        .operator_snapshots
        .create_snapshot(request.label, summary, bundle_value)
        .await;
    Ok((StatusCode::CREATED, Json(snapshot)))
}

async fn list_snapshots(
    State(state): State<AppState>,
    Query(query): Query<SnapshotQuery>,
) -> Json<Vec<OperatorSnapshotRecord>> {
    Json(
        state
            .operator_snapshots
            .list_snapshots(query.limit.unwrap_or(20))
            .await,
    )
}

async fn get_snapshot(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<OperatorSnapshotRecord>, AppError> {
    state
        .operator_snapshots
        .get_snapshot(&id)
        .await
        .map(Json)
        .ok_or_else(|| AppError::NotFound(format!("Snapshot '{id}' not found")))
}

async fn diff_snapshots(
    State(state): State<AppState>,
    Query(query): Query<SnapshotDiffQuery>,
) -> Result<Json<OperatorSnapshotDiff>, AppError> {
    let from = state
        .operator_snapshots
        .get_snapshot(&query.from)
        .await
        .ok_or_else(|| AppError::NotFound(format!("Snapshot '{}' not found", query.from)))?;
    let to = state
        .operator_snapshots
        .get_snapshot(&query.to)
        .await
        .ok_or_else(|| AppError::NotFound(format!("Snapshot '{}' not found", query.to)))?;
    Ok(Json(snapshot_diff(&from, &to)))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/operator-timeline", get(list_timeline))
        .route("/operator-timeline/{id}", get(get_incident))
        .route("/operator-timeline/{id}/redeliver", post(redeliver_incident))
        .route("/operator-evidence", get(get_evidence_bundle))
        .route("/operator-snapshots", get(list_snapshots).post(create_snapshot))
        .route("/operator-snapshots/diff", get(diff_snapshots))
        .route("/operator-snapshots/{id}", get(get_snapshot))
}
