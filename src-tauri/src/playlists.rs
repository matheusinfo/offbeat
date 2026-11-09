//! Saved playlists: links the user syncs later with one click (only the songs
//! missing from the download history are queued). Stored in
//! ~/.local/share/offbeat/playlists.json.

use crate::error::{AppError, AppResult, ErrorCode};
use crate::settings::write_json;
use crate::state::AppState;
use crate::ytdlp::validate_url;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use tauri::State;

const MAX_PLAYLISTS: usize = 200;
const MAX_TITLE: usize = 300;

/// Mirrors `SavedPlaylist` in src/lib/api.ts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SavedPlaylist {
    pub url: String,
    pub title: String,
}

/// Normalizes a playlist from the UI or from disk; Err if it can't be kept.
fn checked(p: SavedPlaylist) -> AppResult<SavedPlaylist> {
    let url = validate_url(&p.url)?;
    let title: String = p
        .title
        .chars()
        .filter(|c| !c.is_control())
        .take(MAX_TITLE)
        .collect();
    let title = title.trim();
    if title.is_empty() {
        return Err(AppError::new(
            ErrorCode::InvalidRequest,
            "playlist title is empty",
        ));
    }
    Ok(SavedPlaylist {
        url,
        title: title.to_owned(),
    })
}

/// Invalid or repeated entries are dropped, so a hand-edited file can't break the app.
pub fn load(path: &Path) -> Vec<SavedPlaylist> {
    let Ok(text) = fs::read_to_string(path) else {
        return Vec::new();
    };
    let Ok(list) = serde_json::from_str::<Vec<serde_json::Value>>(&text) else {
        return Vec::new();
    };
    let mut out: Vec<SavedPlaylist> = Vec::new();
    for value in list {
        let Ok(p) = serde_json::from_value::<SavedPlaylist>(value) else {
            continue;
        };
        if let Ok(p) = checked(p) {
            if out.len() < MAX_PLAYLISTS && !out.iter().any(|o| o.url == p.url) {
                out.push(p);
            }
        }
    }
    out
}

/// Adds or renames (same URL) a playlist, keeping the order otherwise.
pub fn upsert(list: &mut Vec<SavedPlaylist>, playlist: SavedPlaylist) -> AppResult<()> {
    let playlist = checked(playlist)?;
    if let Some(existing) = list.iter_mut().find(|p| p.url == playlist.url) {
        existing.title = playlist.title;
        return Ok(());
    }
    if list.len() >= MAX_PLAYLISTS {
        return Err(AppError::new(
            ErrorCode::InvalidRequest,
            "too many saved playlists",
        ));
    }
    list.push(playlist);
    Ok(())
}

fn store(state: &AppState, list: &[SavedPlaylist]) -> AppResult<()> {
    write_json(
        &state.paths.playlists_file,
        &list,
        "could not save the playlists",
    )
}

#[tauri::command]
pub async fn list_playlists(state: State<'_, AppState>) -> AppResult<Vec<SavedPlaylist>> {
    Ok(state.playlists())
}

#[tauri::command]
pub async fn save_playlist(
    state: State<'_, AppState>,
    playlist: SavedPlaylist,
) -> AppResult<Vec<SavedPlaylist>> {
    state.update_playlists(|list| {
        upsert(list, playlist)?;
        store(&state, list)
    })
}

#[tauri::command]
pub async fn remove_playlist(
    state: State<'_, AppState>,
    url: String,
) -> AppResult<Vec<SavedPlaylist>> {
    state.update_playlists(|list| {
        list.retain(|p| p.url != url);
        store(&state, list)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(url: &str, title: &str) -> SavedPlaylist {
        SavedPlaylist {
            url: url.into(),
            title: title.into(),
        }
    }

    #[test]
    fn upsert_adds_renames_and_validates() {
        let mut list = Vec::new();
        upsert(
            &mut list,
            p("https://www.youtube.com/playlist?list=PL1", " Run "),
        )
        .expect("add");
        upsert(
            &mut list,
            p("https://music.youtube.com/playlist?list=OLAK5uy_x", "Album"),
        )
        .expect("add");
        upsert(
            &mut list,
            p("https://www.youtube.com/playlist?list=PL1", "Run\u{7} 2"),
        )
        .expect("rename");
        assert_eq!(
            list,
            vec![
                p("https://www.youtube.com/playlist?list=PL1", "Run 2"),
                p("https://music.youtube.com/playlist?list=OLAK5uy_x", "Album"),
            ]
        );
        for bad in [p("https://evil.com/x", "x"), p("https://youtu.be/x", "  ")] {
            assert!(upsert(&mut list, bad).is_err());
        }
        assert_eq!(list.len(), 2);
    }

    #[test]
    fn load_drops_bad_and_repeated_entries() {
        let dir = std::env::temp_dir().join(format!("offbeat-playlists-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let file = dir.join("playlists.json");
        assert!(load(&file).is_empty());
        let list = vec![
            p("https://www.youtube.com/playlist?list=PL1", "One"),
            p("https://www.youtube.com/playlist?list=PL1", "Again"),
            p("file:///etc/passwd", "Bad"),
        ];
        write_json(&file, &list, "test").expect("write");
        fs::write(
            dir.join("broken.json"),
            r#"[{"url": 1}, {"url": "https://youtu.be/x", "title": "Ok"}]"#,
        )
        .expect("write");
        assert_eq!(
            load(&file),
            vec![p("https://www.youtube.com/playlist?list=PL1", "One")]
        );
        assert_eq!(
            load(&dir.join("broken.json")),
            vec![p("https://youtu.be/x", "Ok")]
        );
        let _ = fs::remove_dir_all(&dir);
    }
}
