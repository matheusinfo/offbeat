use crate::error::AppResult;
use crate::history;
use crate::settings::Settings;
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
}

// A panic while holding a lock must not take every later command down with it.
fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

impl AppState {
    pub fn new(paths: Paths, settings: Settings) -> Self {
        let history = history::load(&paths.history_file);
        Self {
            paths,
            settings: Mutex::new(settings),
            jobs: Mutex::new(HashMap::new()),
            history: Mutex::new(history),
        }
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
