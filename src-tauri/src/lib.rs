mod downloads;
mod error;
mod history;
mod playlists;
mod process;
mod settings;
mod sidecar;
mod state;
mod ytdlp;

use settings::Settings;
use state::{AppState, Paths};
use std::path::PathBuf;
use tauri::{App, Manager, RunEvent};

/// ~/.config/offbeat and ~/.cache/offbeat, as promised in docs/planning.md
/// (not the identifier-based folders Tauri would pick).
fn app_dir(base: tauri::Result<PathBuf>) -> Result<PathBuf, String> {
    base.map(|d| d.join("offbeat"))
        .map_err(|e| format!("could not resolve app folders: {e}"))
}

fn default_output_dir(app: &App) -> Result<PathBuf, String> {
    let path = app.path();
    path.audio_dir()
        .or_else(|_| path.home_dir().map(|h| h.join("Music")))
        .map(|d| d.join("Offbeat"))
        .map_err(|e| format!("could not resolve the music folder: {e}"))
}

fn setup(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    let paths = Paths {
        settings_file: app_dir(app.path().config_dir())?.join("settings.json"),
        temp_root: app_dir(app.path().cache_dir())?.join("tmp"),
        history_file: app_dir(app.path().data_dir())?.join("history.txt"),
        playlists_file: app_dir(app.path().data_dir())?.join("playlists.json"),
    };
    // Leftovers from a crash or a kill; nothing can be running yet.
    if let Err(e) = std::fs::remove_dir_all(&paths.temp_root) {
        if e.kind() != std::io::ErrorKind::NotFound {
            eprintln!(
                "offbeat: could not clean {}: {e}",
                paths.temp_root.display()
            );
        }
    }
    let defaults = Settings::defaults(default_output_dir(app)?);
    let settings = settings::load(&paths.settings_file, defaults);
    app.manage(AppState::new(paths, settings));
    Ok(())
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(setup)
        .invoke_handler(tauri::generate_handler![
            downloads::preview,
            downloads::download,
            downloads::cancel_download,
            downloads::open_output_dir,
            downloads::output_dir_size,
            downloads::history_count,
            downloads::clear_history,
            playlists::list_playlists,
            playlists::save_playlist,
            playlists::remove_playlist,
            settings::get_settings,
            settings::save_settings,
            sidecar::tool_versions,
        ])
        .build(tauri::generate_context!());
    let app = match app {
        Ok(app) => app,
        Err(e) => {
            eprintln!("offbeat: failed to start: {e}");
            std::process::exit(1);
        }
    };
    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            if let Some(state) = handle.try_state::<AppState>() {
                downloads::kill_all(&state);
            }
        }
    });
}
