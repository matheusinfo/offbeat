use crate::error::{AppError, AppResult, ErrorCode};
use crate::process;
use crate::state::AppState;
use serde::Serialize;
use std::path::PathBuf;
use std::time::Duration;
use tauri::State;

const VERSION_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, Copy)]
pub enum Tool {
    YtDlp,
    Ffmpeg,
    Ffprobe,
    Deno,
}

impl Tool {
    fn file_name(self) -> &'static str {
        match self {
            Tool::YtDlp => "yt-dlp",
            Tool::Ffmpeg => "ffmpeg",
            Tool::Ffprobe => "ffprobe",
            Tool::Deno => "deno",
        }
    }
}

/// Tauri copies `externalBin` next to the main executable, both in
/// `tauri dev` (target/debug) and in the bundles.
pub fn path(tool: Tool) -> AppResult<PathBuf> {
    let exe = std::env::current_exe().map_err(|e| AppError::io("cannot locate the app", &e))?;
    let dir = exe
        .parent()
        .ok_or_else(|| AppError::new(ErrorCode::SidecarMissing, "cannot locate the app folder"))?;
    let candidate = dir.join(tool.file_name());
    if candidate.is_file() {
        Ok(candidate)
    } else {
        Err(AppError::new(
            ErrorCode::SidecarMissing,
            format!("{} not found", tool.file_name()),
        )
        .with_detail(vec![candidate.to_string_lossy().into_owned()]))
    }
}

/// Mirrors `ToolVersions` in src/lib/api.ts.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolVersions {
    pub yt_dlp: Option<String>,
    pub ffmpeg: Option<String>,
    pub deno: Option<String>,
}

async fn first_line(program: AppResult<PathBuf>, arg: &str) -> Option<String> {
    let program = program.ok()?;
    let output = process::run(&program, &[arg.to_owned()], VERSION_TIMEOUT)
        .await
        .ok()?;
    if output.code != Some(0) {
        return None;
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .map(str::to_owned)
}

/// The version number out of a banner line: "ffmpeg version N-1234-gabc
/// Copyright ..." -> "N-1234-gabc", "deno 2.9.8 (stable, ...)" -> "2.9.8".
/// yt-dlp prints only the number, which passes through unchanged.
fn version_token(line: String) -> String {
    let words: Vec<&str> = line.split_whitespace().collect();
    let token = match words.as_slice() {
        [_, "version", v, ..] => v,
        [name, v, ..] if name.chars().all(|c| c.is_ascii_alphabetic()) => v,
        _ => return line,
    };
    token.to_string()
}

/// yt-dlp is the one in use: the copy updated from the app, if any.
#[tauri::command]
pub async fn tool_versions(state: State<'_, AppState>) -> AppResult<ToolVersions> {
    let (yt_dlp, ffmpeg, deno) = tokio::join!(
        first_line(state.ytdlp_path(), "--version"),
        first_line(path(Tool::Ffmpeg), "-version"),
        first_line(path(Tool::Deno), "--version"),
    );
    Ok(ToolVersions {
        yt_dlp: yt_dlp.map(version_token),
        ffmpeg: ffmpeg.map(version_token),
        deno: deno.map(version_token),
    })
}

#[cfg(test)]
mod tests {
    use super::version_token;

    #[test]
    fn extracts_version_numbers() {
        let v = |s: &str| version_token(s.to_owned());
        assert_eq!(v("2026.10.26"), "2026.10.26");
        assert_eq!(
            v("ffmpeg version N-128544-ga6c7695959-20261106 Copyright (c) 2000-2026"),
            "N-128544-ga6c7695959-20261106"
        );
        assert_eq!(
            v("deno 2.9.8 (stable, release, x86_64-unknown-linux-gnu)"),
            "2.9.8"
        );
    }
}
