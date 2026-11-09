//! Updating yt-dlp from the app. YouTube breaks old yt-dlp versions every few
//! weeks, and the copy inside the AppImage is read-only. The bundled binary
//! is copied to ~/.local/share/offbeat/bin/yt-dlp and updated there with
//! yt-dlp's own updater (`-U`), which downloads the release from GitHub and
//! checks it against the release's SHA2-256SUMS. The copy is used only while
//! it is newer than the bundled one.
//!
//! This is the app's only network access of its own, and it happens only
//! when the user clicks "Update yt-dlp".

use crate::error::{AppError, AppResult, ErrorCode};
use crate::process;
use crate::sidecar::{self, Tool};
use crate::state::AppState;
use serde::Serialize;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::State;

const UPDATE_TIMEOUT: Duration = Duration::from_secs(300);
const VERSION_TIMEOUT: Duration = Duration::from_secs(20);

/// "2026.10.26", "2026.10.26.1" or a nightly "2026.10.26.232204" as numbers,
/// so they compare in release order.
pub fn parse_version(text: &str) -> Option<Vec<u64>> {
    let text = text.trim();
    let parts: Option<Vec<u64>> = text.split('.').map(|p| p.parse().ok()).collect();
    parts.filter(|p| p.len() >= 3)
}

pub fn is_newer(candidate: &str, than: &str) -> bool {
    match (parse_version(candidate), parse_version(than)) {
        (Some(a), Some(b)) => a > b,
        _ => false,
    }
}

async fn version_of(program: &Path) -> Option<String> {
    let out = process::run(program, &["--version".to_owned()], VERSION_TIMEOUT)
        .await
        .ok()?;
    if out.code != Some(0) {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let line = text.lines().map(str::trim).find(|l| !l.is_empty())?;
    parse_version(line).map(|_| line.to_owned())
}

pub fn local_copy(state: &AppState) -> PathBuf {
    state.paths.bin_dir.join("yt-dlp")
}

/// Copies through a temp file, so an interrupted copy never looks like a binary.
fn install_copy(from: &Path, to: &Path) -> std::io::Result<()> {
    if let Some(dir) = to.parent() {
        fs::create_dir_all(dir)?;
    }
    let tmp = to.with_extension("tmp");
    fs::copy(from, &tmp)?;
    fs::set_permissions(&tmp, fs::Permissions::from_mode(0o755))?;
    fs::rename(&tmp, to)
}

/// At startup: keep the updated copy only if it is still newer than the
/// bundled yt-dlp (a newer AppImage may ship a newer one).
pub async fn reconcile(state: &AppState) {
    let local = local_copy(state);
    if !local.is_file() {
        return;
    }
    let Ok(bundled) = sidecar::path(Tool::YtDlp) else {
        return;
    };
    let (local_v, bundled_v) = tokio::join!(version_of(&local), version_of(&bundled));
    match (local_v, bundled_v) {
        (Some(l), Some(b)) if is_newer(&l, &b) => state.set_ytdlp_override(Some(local)),
        // A broken copy or one that is not newer only takes space.
        (_, Some(_)) => {
            let _ = fs::remove_file(&local);
        }
        // Can't tell: keep the copy but don't use it.
        _ => {}
    }
}

/// Mirrors `UpdateOutcome` in src/lib/api.ts.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateOutcome {
    /// true when a newer version is now in use.
    pub updated: bool,
    /// Version of the yt-dlp now in use.
    pub version: String,
}

#[tauri::command]
pub async fn update_ytdlp(state: State<'_, AppState>) -> AppResult<UpdateOutcome> {
    let _guard = state
        .begin_update()
        .ok_or_else(|| AppError::new(ErrorCode::Busy, "yt-dlp is already being updated"))?;
    let bundled = sidecar::path(Tool::YtDlp)?;
    let local = local_copy(&state);
    let before = state.ytdlp_path()?;
    let before_v = version_of(&before).await;

    if !local.is_file() {
        install_copy(&bundled, &local)
            .map_err(|e| AppError::io("could not prepare the yt-dlp copy", &e))?;
    }
    let args: Vec<String> = ["--ignore-config", "--no-color", "-U"]
        .into_iter()
        .map(String::from)
        .collect();
    let out = process::run(&local, &args, UPDATE_TIMEOUT).await?;
    let mut detail = process::tail_of(&out.stdout);
    detail.extend(process::tail_of(&out.stderr));
    if out.timed_out || out.code != Some(0) {
        return Err(
            AppError::new(ErrorCode::YtdlpFailed, "yt-dlp could not update").with_detail(detail),
        );
    }

    let (local_v, bundled_v) = tokio::join!(version_of(&local), version_of(&bundled));
    let bundled_v = bundled_v.ok_or_else(|| {
        AppError::new(
            ErrorCode::SidecarMissing,
            "could not run the bundled yt-dlp",
        )
    })?;
    let Some(local_v) = local_v.filter(|l| is_newer(l, &bundled_v)) else {
        // The bundled one is already the latest; the copy is not needed.
        let _ = fs::remove_file(&local);
        state.set_ytdlp_override(None);
        return Ok(UpdateOutcome {
            updated: before_v.is_some_and(|b| is_newer(&bundled_v, &b)),
            version: bundled_v,
        });
    };
    state.set_ytdlp_override(Some(local));
    Ok(UpdateOutcome {
        updated: before_v.is_none_or(|b| is_newer(&local_v, &b)),
        version: local_v,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_versions_in_release_order() {
        assert_eq!(parse_version("2026.10.26"), Some(vec![2026, 10, 26]));
        assert_eq!(
            parse_version(" 2026.10.26.1\n"),
            Some(vec![2026, 10, 26, 1])
        );
        assert_eq!(parse_version("2026.10"), None);
        assert_eq!(parse_version("abc"), None);
        assert!(is_newer("2026.11.02", "2026.10.26"));
        assert!(is_newer("2026.10.26.1", "2026.10.26"));
        assert!(is_newer("2026.10.26", "2026.9.30"));
        assert!(!is_newer("2026.10.26", "2026.10.26"));
        assert!(!is_newer("garbage", "2026.10.26"));
    }

    #[test]
    fn install_copy_is_executable() {
        let dir = std::env::temp_dir().join(format!("offbeat-updater-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("mkdir");
        let src = dir.join("src");
        fs::write(&src, b"#!/bin/sh\n").expect("write");
        let dst = dir.join("bin").join("yt-dlp");
        install_copy(&src, &dst).expect("copy");
        let mode = fs::metadata(&dst).expect("meta").permissions().mode();
        assert_eq!(mode & 0o777, 0o755);
        assert!(!dst.with_extension("tmp").exists());
        let _ = fs::remove_dir_all(&dir);
    }
}
