use crate::error::{AppError, AppResult, ErrorCode};
use crate::process::{self, Tail};
use crate::sidecar::{self, Tool};
use crate::state::{AppState, Job};
use crate::ytdlp::{self, Chapter, DownloadPlan, Preview};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;
use tauri::ipc::Channel;
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

const PREVIEW_TIMEOUT: Duration = Duration::from_secs(60);
/// Time between SIGTERM and SIGKILL on cancel.
const CANCEL_GRACE: Duration = Duration::from_secs(3);

/// Mirrors `DownloadRequest` in src/lib/api.ts.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRequest {
    pub id: String,
    pub url: String,
    pub index: Option<u32>,
    /// Download only this chapter of the video, as its own track.
    pub section: Option<Chapter>,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Stream {
    Stdout,
    Stderr,
}

/// Mirrors `DownloadEvent` in src/lib/api.ts.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "event", content = "data", rename_all = "camelCase")]
pub enum DownloadEvent {
    Line { stream: Stream, line: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DownloadStatus {
    Success,
    Failed,
    Canceled,
}

/// Mirrors `DownloadOutcome` in src/lib/api.ts.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadOutcome {
    pub status: DownloadStatus,
    pub exit_code: Option<i32>,
    pub stderr: Vec<String>,
}

fn utf8(path: &Path) -> AppResult<String> {
    path.to_str().map(str::to_owned).ok_or_else(|| {
        AppError::new(ErrorCode::Io, "path is not valid UTF-8")
            .with_detail(vec![path.to_string_lossy().into_owned()])
    })
}

/// Deno is optional: without it yt-dlp falls back to its own JS handling,
/// which may fail on some videos, but that's better than refusing to run.
fn deno_path() -> AppResult<Option<String>> {
    sidecar::path(Tool::Deno).ok().map(|p| utf8(&p)).transpose()
}

#[tauri::command]
pub async fn preview(url: String) -> AppResult<Preview> {
    let url = ytdlp::validate_url(&url)?;
    let ytdlp_bin = sidecar::path(Tool::YtDlp)?;
    let args = ytdlp::preview_args(&url, deno_path()?.as_deref());
    let out = process::run(&ytdlp_bin, &args, PREVIEW_TIMEOUT).await?;
    let stderr = process::tail_of(&out.stderr);
    if out.timed_out {
        return Err(AppError::new(ErrorCode::YtdlpFailed, "yt-dlp timed out").with_detail(stderr));
    }
    if out.code != Some(0) {
        return Err(
            AppError::new(ErrorCode::YtdlpFailed, "yt-dlp could not read this link")
                .with_detail(stderr),
        );
    }
    let json = String::from_utf8_lossy(&out.stdout);
    ytdlp::parse_preview(&json)
}

/// Removes the job from the registry and its temp folder on every exit path.
struct JobGuard<'a> {
    state: &'a AppState,
    id: String,
    temp_dir: PathBuf,
}

impl Drop for JobGuard<'_> {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.temp_dir);
        self.state.finish_job(&self.id);
    }
}

#[tauri::command]
pub async fn download(
    state: State<'_, AppState>,
    request: DownloadRequest,
    on_event: Channel<DownloadEvent>,
) -> AppResult<DownloadOutcome> {
    if !ytdlp::is_valid_id(&request.id) {
        return Err(AppError::new(
            ErrorCode::InvalidRequest,
            "invalid download id",
        ));
    }
    if request.index == Some(0) {
        return Err(AppError::new(ErrorCode::InvalidRequest, "index is 1-based"));
    }
    if let Some(section) = &request.section {
        section.validate()?;
    }
    let url = ytdlp::validate_url(&request.url)?;
    let settings = state.settings();
    let ytdlp_bin = sidecar::path(Tool::YtDlp)?;
    let ffmpeg = sidecar::path(Tool::Ffmpeg)?;
    // yt-dlp finds ffprobe next to ffmpeg and needs it to extract audio.
    sidecar::path(Tool::Ffprobe)?;
    let deno = deno_path()?;

    let job = state.start_job(&request.id).ok_or_else(|| {
        AppError::new(
            ErrorCode::Busy,
            "a download with this id is already running",
        )
    })?;
    let temp_dir = state.paths.temp_root.join(&request.id);
    let _guard = JobGuard {
        state: state.inner(),
        id: request.id.clone(),
        temp_dir: temp_dir.clone(),
    };

    fs::create_dir_all(&settings.output_dir).map_err(|e| {
        AppError::io("could not create the output folder", &e)
            .with_detail(vec![settings.output_dir.to_string_lossy().into_owned()])
    })?;
    let _ = fs::remove_dir_all(&temp_dir);
    fs::create_dir_all(&temp_dir)
        .map_err(|e| AppError::io("could not create the temp folder", &e))?;

    let plan = DownloadPlan {
        url,
        index: request.index,
        profile: settings.profile,
        pattern: settings.filename_pattern,
        sponsorblock: settings.sponsorblock,
        normalize_volume: settings.normalize_volume,
        section: request.section,
        output_dir: utf8(&settings.output_dir)?,
        temp_dir: utf8(&temp_dir)?,
        ffmpeg: utf8(&ffmpeg)?,
        deno,
    };
    run_download(&ytdlp_bin, &ytdlp::download_args(&plan), &job, on_event).await
}

async fn run_download(
    program: &Path,
    args: &[String],
    job: &Arc<Job>,
    on_event: Channel<DownloadEvent>,
) -> AppResult<DownloadOutcome> {
    let mut child = process::spawn(program, args)?;
    let pgid = process::pgid_of(&child)?;
    job.pgid.store(pgid, Ordering::SeqCst);

    // With --print, yt-dlp is quiet and progress goes to stderr, so both
    // streams are forwarded; the UI parses them.
    let stdout_task = child.stdout.take().map(|out| {
        let ch = on_event.clone();
        tokio::spawn(process::for_each_line(out, move |line| {
            let _ = ch.send(DownloadEvent::Line {
                stream: Stream::Stdout,
                line,
            });
        }))
    });
    let stderr_task = tokio::spawn({
        let err = child.stderr.take();
        let ch = on_event;
        async move {
            let mut tail = Tail::default();
            if let Some(err) = err {
                process::for_each_line(err, |line| {
                    let _ = ch.send(DownloadEvent::Line {
                        stream: Stream::Stderr,
                        line: line.clone(),
                    });
                    tail.push(line);
                })
                .await;
            }
            tail
        }
    });

    let status = tokio::select! {
        status = child.wait() => status,
        _ = job.cancel.notified() => {
            // The leader isn't reaped until wait() returns, so the pgid can't be reused here.
            process::kill_group(pgid, libc::SIGTERM);
            match tokio::time::timeout(CANCEL_GRACE, child.wait()).await {
                Ok(status) => status,
                Err(_) => {
                    process::kill_group(pgid, libc::SIGKILL);
                    child.wait().await
                }
            }
        }
    };
    job.pgid.store(0, Ordering::SeqCst);
    let status = status.map_err(|e| AppError::io("could not wait for yt-dlp", &e))?;

    if let Some(task) = stdout_task {
        process::drain(pgid, task).await;
    }
    let tail = process::drain(pgid, stderr_task).await;

    let exit_code = status.code();
    let status = if exit_code == Some(0) {
        DownloadStatus::Success
    } else if job.cancel_requested.load(Ordering::SeqCst) {
        DownloadStatus::Canceled
    } else {
        DownloadStatus::Failed
    };
    Ok(DownloadOutcome {
        status,
        exit_code,
        stderr: tail.into_vec(),
    })
}

#[tauri::command]
pub async fn cancel_download(state: State<'_, AppState>, id: String) -> AppResult<bool> {
    Ok(match state.job(&id) {
        Some(job) => {
            job.request_cancel();
            true
        }
        None => false,
    })
}

/// Kills every running download; called when the app exits, since the
/// children live in their own process groups and would outlive us.
pub fn kill_all(state: &AppState) {
    for job in state.all_jobs() {
        process::kill_group(job.pgid.swap(0, Ordering::SeqCst), libc::SIGKILL);
    }
}

#[tauri::command]
pub async fn open_output_dir(app: AppHandle, state: State<'_, AppState>) -> AppResult<()> {
    let dir = state.settings().output_dir;
    fs::create_dir_all(&dir).map_err(|e| AppError::io("could not create the output folder", &e))?;
    app.opener()
        .open_path(utf8(&dir)?, None::<&str>)
        .map_err(|e| {
            AppError::new(
                ErrorCode::Io,
                format!("could not open the output folder: {e}"),
            )
        })
}

/// Regular files directly inside `dir` (no recursion, symlinks not followed).
pub fn dir_size(dir: &Path) -> AppResult<u64> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(e) => return Err(AppError::io("could not read the output folder", &e)),
    };
    let mut total = 0u64;
    for entry in entries.flatten() {
        if let Ok(meta) = entry.metadata() {
            if meta.file_type().is_file() {
                total = total.saturating_add(meta.len());
            }
        }
    }
    Ok(total)
}

#[tauri::command]
pub async fn output_dir_size(state: State<'_, AppState>) -> AppResult<u64> {
    let dir = state.settings().output_dir;
    tauri::async_runtime::spawn_blocking(move || dir_size(&dir))
        .await
        .map_err(|e| {
            AppError::new(
                ErrorCode::Io,
                format!("could not measure the output folder: {e}"),
            )
        })?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn event_matches_api_ts() {
        let ev = DownloadEvent::Line {
            stream: Stream::Stderr,
            line: "PROG {}".into(),
        };
        assert_eq!(
            serde_json::to_value(&ev).expect("serialize"),
            serde_json::json!({"event": "line", "data": {"stream": "stderr", "line": "PROG {}"}})
        );
        let outcome = DownloadOutcome {
            status: DownloadStatus::Canceled,
            exit_code: None,
            stderr: vec!["x".into()],
        };
        assert_eq!(
            serde_json::to_value(&outcome).expect("serialize"),
            serde_json::json!({"status": "canceled", "exitCode": null, "stderr": ["x"]})
        );
    }

    #[test]
    fn dir_size_counts_only_top_level_files() {
        let dir = std::env::temp_dir().join(format!("offbeat-size-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("sub")).expect("mkdir");
        fs::write(dir.join("a.mp3"), [0u8; 10]).expect("write");
        fs::write(dir.join("b.m4a"), [0u8; 5]).expect("write");
        fs::write(dir.join("sub").join("c.mp3"), [0u8; 100]).expect("write");
        assert_eq!(dir_size(&dir).expect("size"), 15);
        let _ = fs::remove_dir_all(&dir);
        assert_eq!(dir_size(&dir).expect("missing"), 0);
    }
}
