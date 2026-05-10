use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use crate::shared::error::AppResult;

use super::dto::HealthStatus;

#[tauri::command]
pub fn health_check() -> AppResult<HealthStatus> {
    Ok(HealthStatus {
        ok: true,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        rust_target: format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH),
        timestamp: OffsetDateTime::now_utc()
            .format(&Rfc3339)
            .unwrap_or_else(|_| "unknown".to_string()),
    })
}
