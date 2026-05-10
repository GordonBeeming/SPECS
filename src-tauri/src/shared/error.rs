//! IPC error envelope.
//!
//! Slice command handlers return `Result<T, AppError>`; serde turns AppError into
//! a structured payload so the React side can branch on `kind` instead of
//! string-matching messages.

use serde::Serialize;

#[allow(dead_code)] // variants used as slices grow — documented contract
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("not found: {0}")]
    NotFound(String),
    #[error("invalid input: {0}")]
    Invalid(String),
    #[error("internal error: {0}")]
    Internal(String),
}

#[derive(Serialize)]
struct ErrorPayload<'a> {
    kind: &'a str,
    message: String,
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let (kind, message) = match self {
            AppError::NotFound(m) => ("not_found", m.clone()),
            AppError::Invalid(m) => ("invalid", m.clone()),
            AppError::Internal(m) => ("internal", m.clone()),
        };
        ErrorPayload { kind, message }.serialize(s)
    }
}

impl From<anyhow::Error> for AppError {
    fn from(value: anyhow::Error) -> Self {
        AppError::Internal(value.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
