//! Child process plumbing shared by preview, download and tool_versions.
//!
//! Every child runs in its own process group: the standalone yt-dlp is a
//! PyInstaller bootloader that forks the real interpreter, and yt-dlp itself
//! spawns ffmpeg and deno, so signals must reach the whole tree.

use crate::error::{AppError, AppResult, ErrorCode};
use std::collections::VecDeque;
use std::path::Path;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::task::JoinHandle;

pub const STDERR_TAIL: usize = 30;

/// How long to wait for pipes to close after the main process exited.
const DRAIN_GRACE: Duration = Duration::from_secs(5);

pub fn spawn(program: &Path, args: &[String]) -> AppResult<Child> {
    let mut cmd = Command::new(program);
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("PYTHONIOENCODING", "utf-8")
        .process_group(0)
        .kill_on_drop(true);
    cmd.spawn().map_err(|e| {
        AppError::new(
            ErrorCode::SpawnFailed,
            format!("could not start {}: {e}", program.display()),
        )
        .with_detail(vec![program.to_string_lossy().into_owned()])
    })
}

/// Signals the whole group. Only call while the leader is not yet reaped (or
/// while other members are known to be alive), so the pgid can't be reused.
pub fn kill_group(pgid: i32, signal: libc::c_int) {
    if pgid > 0 {
        // SAFETY: plain syscall; a negative pid targets the process group.
        unsafe {
            libc::kill(-pgid, signal);
        }
    }
}

pub fn pgid_of(child: &Child) -> AppResult<i32> {
    child
        .id()
        .and_then(|pid| i32::try_from(pid).ok())
        .ok_or_else(|| {
            AppError::new(
                ErrorCode::SpawnFailed,
                "child exited before it could be tracked",
            )
        })
}

/// Waits for reader tasks after the main process exited. If a stray group
/// member still holds a pipe, the group is killed (safe: that member keeps
/// the pgid alive) so the readers can finish.
pub async fn drain<T: Default>(pgid: i32, task: JoinHandle<T>) -> T {
    let mut task = task;
    match tokio::time::timeout(DRAIN_GRACE, &mut task).await {
        Ok(result) => result.unwrap_or_default(),
        Err(_) => {
            kill_group(pgid, libc::SIGKILL);
            match tokio::time::timeout(DRAIN_GRACE, &mut task).await {
                Ok(result) => result.unwrap_or_default(),
                Err(_) => {
                    task.abort();
                    T::default()
                }
            }
        }
    }
}

/// Reads `reader` line by line (lossy UTF-8, no trailing `\r\n`), calling
/// `on_line` for each one.
pub async fn for_each_line<R, F>(reader: R, mut on_line: F)
where
    R: AsyncRead + Unpin,
    F: FnMut(String),
{
    let mut reader = BufReader::new(reader);
    let mut buf = Vec::new();
    loop {
        buf.clear();
        match reader.read_until(b'\n', &mut buf).await {
            Ok(0) | Err(_) => break,
            Ok(_) => {
                while matches!(buf.last(), Some(b'\n' | b'\r')) {
                    buf.pop();
                }
                on_line(String::from_utf8_lossy(&buf).into_owned());
            }
        }
    }
}

/// Keeps the last `STDERR_TAIL` lines.
#[derive(Debug, Default)]
pub struct Tail(VecDeque<String>);

impl Tail {
    pub fn push(&mut self, line: String) {
        if self.0.len() == STDERR_TAIL {
            self.0.pop_front();
        }
        self.0.push_back(line);
    }

    pub fn into_vec(self) -> Vec<String> {
        self.0.into()
    }
}

pub fn tail_of(text: &[u8]) -> Vec<String> {
    let mut tail = Tail::default();
    for line in String::from_utf8_lossy(text).lines() {
        tail.push(line.trim_end_matches('\r').to_owned());
    }
    tail.into_vec()
}

pub struct Output {
    pub code: Option<i32>,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    pub timed_out: bool,
}

async fn read_all<R: AsyncRead + Unpin>(reader: Option<R>) -> Vec<u8> {
    let mut buf = Vec::new();
    if let Some(mut r) = reader {
        let _ = r.read_to_end(&mut buf).await;
    }
    buf
}

/// Runs to completion, killing the whole group if it takes longer than `limit`.
pub async fn run(program: &Path, args: &[String], limit: Duration) -> AppResult<Output> {
    let mut child = spawn(program, args)?;
    let pgid = pgid_of(&child)?;
    let stdout = tokio::spawn(read_all(child.stdout.take()));
    let stderr = tokio::spawn(read_all(child.stderr.take()));

    let (status, timed_out) = match tokio::time::timeout(limit, child.wait()).await {
        Ok(status) => (status, false),
        Err(_) => {
            // Leader not reaped yet, so the pgid is still ours.
            kill_group(pgid, libc::SIGKILL);
            (child.wait().await, true)
        }
    };
    let status = status.map_err(|e| AppError::io("could not wait for the child process", &e))?;
    let stdout = drain(pgid, stdout).await;
    let stderr = drain(pgid, stderr).await;
    Ok(Output {
        code: status.code(),
        stdout,
        stderr,
        timed_out,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tail_keeps_last_lines() {
        let text: String = (0..40).map(|i| format!("line {i}\r\n")).collect();
        let tail = tail_of(text.as_bytes());
        assert_eq!(tail.len(), STDERR_TAIL);
        assert_eq!(tail.first().map(String::as_str), Some("line 10"));
        assert_eq!(tail.last().map(String::as_str), Some("line 39"));
    }

    #[tokio::test]
    async fn for_each_line_is_lossy_and_strips_cr() {
        let input: &[u8] = b"a\r\nb\xff\nlast";
        let mut lines = Vec::new();
        for_each_line(input, |l| lines.push(l)).await;
        assert_eq!(lines, vec!["a", "b\u{fffd}", "last"]);
    }

    #[tokio::test]
    async fn run_times_out_and_kills_group() {
        let sh = Path::new("/bin/sh");
        // The background sleep shares the group and holds stdout open.
        let args = vec!["-c".to_owned(), "sleep 30 & sleep 30".to_owned()];
        let started = std::time::Instant::now();
        let out = run(sh, &args, Duration::from_millis(300))
            .await
            .expect("run");
        assert!(out.timed_out);
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[tokio::test]
    async fn run_collects_output() {
        let args = vec!["-c".to_owned(), "echo out; echo err >&2; exit 3".to_owned()];
        let out = run(Path::new("/bin/sh"), &args, Duration::from_secs(5))
            .await
            .expect("run");
        assert_eq!(out.code, Some(3));
        assert_eq!(out.stdout, b"out\n");
        assert_eq!(tail_of(&out.stderr), vec!["err"]);
    }
}
