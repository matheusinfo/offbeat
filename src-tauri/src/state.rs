use crate::error::AppResult;
use crate::history;
use crate::playlists::{self, SavedPlaylist};
use crate::settings::Settings;
use crate::sidecar::{self, Tool};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use tokio::sync::Notify;

/// Fixed locations resolved once at startup.
pub struct Paths {
    /// ~/.config/offbeat/settings.json
    pub settings_file: PathBuf,
    /// ~/.cache/offbeat/tmp; one subfolder per running download.
    pub temp_root: PathBuf,
    /// ~/.local/share/offbeat/history.txt, in yt-dlp's archive format.
    pub history_file: PathBuf,
    /// ~/.local/share/offbeat/playlists.json
    pub playlists_file: PathBuf,
    /// ~/.local/share/offbeat/bin: the yt-dlp updated from the app.
    pub bin_dir: PathBuf,
}

/// Cancellation handle of a running download.
#[derive(Default)]
pub struct Job {
    pub cancel_requested: AtomicBool,
    pub cancel: Notify,
    /// Process group id while the child is alive and not yet reaped; 0 otherwise.
    pub pgid: AtomicI32,
}

impl Job {
    pub fn request_cancel(&self) {
        self.cancel_requested.store(true, Ordering::SeqCst);
        // notify_one keeps a permit if the download task isn't waiting yet.
        self.cancel.notify_one();
    }
}

pub struct AppState {
    pub paths: Paths,
    settings: Mutex<Settings>,
    jobs: Mutex<HashMap<String, Arc<Job>>>,
    /// Ids of downloaded videos; mirrors history_file.
    history: Mutex<HashSet<String>>,
    playlists: Mutex<Vec<SavedPlaylist>>,
    /// The updated yt-dlp, while it is newer than the bundled one.
    ytdlp_override: Mutex<Option<PathBuf>>,
    updating: AtomicBool,
}

/// Clears the "updating" flag when the update ends, however it ends.
pub struct UpdateGuard<'a>(&'a AtomicBool);

impl Drop for UpdateGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

// A panic while holding a lock must not take every later command down with it.
fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

impl AppState {
    pub fn new(paths: Paths, settings: Settings) -> Self {
        let history = history::load(&paths.history_file);
        let saved = playlists::load(&paths.playlists_file);
        Self {
            paths,
            settings: Mutex::new(settings),
            jobs: Mutex::new(HashMap::new()),
            history: Mutex::new(history),
            playlists: Mutex::new(saved),
            ytdlp_override: Mutex::new(None),
            updating: AtomicBool::new(false),
        }
    }

    /// The yt-dlp to run: the updated copy when there is one, else the bundled.
    pub fn ytdlp_path(&self) -> AppResult<PathBuf> {
        match lock(&self.ytdlp_override).clone() {
            Some(path) if path.is_file() => Ok(path),
            _ => sidecar::path(Tool::YtDlp),
        }
    }

    pub fn set_ytdlp_override(&self, path: Option<PathBuf>) {
        *lock(&self.ytdlp_override) = path;
    }

    /// None if an update is already running.
    pub fn begin_update(&self) -> Option<UpdateGuard<'_>> {
        self.updating
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .ok()
            .map(|_| UpdateGuard(&self.updating))
    }

    pub fn playlists(&self) -> Vec<SavedPlaylist> {
        lock(&self.playlists).clone()
    }

    /// Applies `change` to a copy and keeps it only if it succeeds (including
    /// writing the file), so memory and disk never disagree.
    pub fn update_playlists(
        &self,
        change: impl FnOnce(&mut Vec<SavedPlaylist>) -> AppResult<()>,
    ) -> AppResult<Vec<SavedPlaylist>> {
        let mut current = lock(&self.playlists);
        let mut next = current.clone();
        change(&mut next)?;
        *current = next.clone();
        Ok(next)
    }

    pub fn is_downloaded(&self, id: &str) -> bool {
        lock(&self.history).contains(id)
    }

    /// Appends under the lock, so two downloads finishing together never
    /// interleave their lines.
    pub fn record_download(&self, id: &str) -> AppResult<()> {
        let mut ids = lock(&self.history);
        if ids.contains(id) {
            return Ok(());
        }
        history::append(&self.paths.history_file, id)?;
        ids.insert(id.to_owned());
        Ok(())
    }

    pub fn history_count(&self) -> usize {
        lock(&self.history).len()
    }

    pub fn clear_history(&self) -> AppResult<()> {
        let mut ids = lock(&self.history);
        history::clear(&self.paths.history_file)?;
        ids.clear();
        Ok(())
    }

    pub fn settings(&self) -> Settings {
        lock(&self.settings).clone()
    }

    pub fn set_settings(&self, settings: Settings) {
        *lock(&self.settings) = settings;
    }

    /// Registers a job; None if one with this id is already running.
    pub fn start_job(&self, id: &str) -> Option<Arc<Job>> {
        let mut jobs = lock(&self.jobs);
        if jobs.contains_key(id) {
            return None;
        }
        let job = Arc::new(Job::default());
        jobs.insert(id.to_owned(), Arc::clone(&job));
        Some(job)
    }

    pub fn finish_job(&self, id: &str) {
        lock(&self.jobs).remove(id);
    }

    pub fn job(&self, id: &str) -> Option<Arc<Job>> {
        lock(&self.jobs).get(id).cloned()
    }

    pub fn all_jobs(&self) -> Vec<Arc<Job>> {
        lock(&self.jobs).values().cloned().collect()
    }
}
