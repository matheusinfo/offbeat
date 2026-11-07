use serde::Serialize;
use std::fmt;

/// Mirrors `ErrorCode` in src/lib/api.ts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    InvalidUrl,
    InvalidRequest,
    InvalidSettings,
    SidecarMissing,
    SpawnFailed,
    YtdlpFailed,
    BadOutput,
    Busy,
    Io,
}

/// Rejection value of every command; mirrors `AppError` in src/lib/api.ts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AppError {
    pub code: ErrorCode,
    pub message: String,
    pub detail: Vec<String>,
}

pub type AppResult<T> = Result<T, AppError>;

impl AppError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            detail: Vec::new(),
        }
    }

    pub fn with_detail(mut self, detail: Vec<String>) -> Self {
        self.detail = detail;
        self
    }

    pub fn io(context: &str, err: &std::io::Error) -> Self {
        Self::new(ErrorCode::Io, format!("{context}: {err}"))
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.code, self.message)
    }
}

impl std::error::Error for AppError {}
