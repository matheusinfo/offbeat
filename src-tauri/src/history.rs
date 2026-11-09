//! History of downloaded videos, so a playlist can be synced without fetching
//! the same songs again. The file uses yt-dlp's --download-archive format
//! ("youtube <id>" per line) but is kept by the backend itself: that lets it
//! skip before spawning anything, leave chapter downloads out and offer
//! "download again".

use crate::error::{AppError, AppResult};
use crate::ytdlp::is_valid_id;
use std::collections::HashSet;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;

const PREFIX: &str = "youtube ";

/// Ids in an archive file; malformed lines are ignored.
pub fn parse(text: &str) -> HashSet<String> {
    text.lines()
        .filter_map(|line| line.trim().strip_prefix(PREFIX))
        .map(str::trim)
        .filter(|id| is_valid_id(id))
        .map(str::to_owned)
        .collect()
}

pub fn load(path: &Path) -> HashSet<String> {
    fs::read_to_string(path)
        .map(|text| parse(&text))
        .unwrap_or_default()
}

pub fn append(path: &Path, id: &str) -> AppResult<()> {
    let ctx = "could not update the download history";
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| AppError::io(ctx, &e))?;
    }
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|e| AppError::io(ctx, &e))?;
    writeln!(file, "{PREFIX}{id}").map_err(|e| AppError::io(ctx, &e))
}

pub fn clear(path: &Path) -> AppResult<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(AppError::io("could not clear the download history", &e)),
    }
}

/// The video id of a single-video link (watch?v=, youtu.be/, shorts/), or
/// None for playlists and anything else.
pub fn video_id(url: &str) -> Option<String> {
    let url = url::Url::parse(url).ok()?;
    let host = url.host_str()?;
    let id = if host == "youtu.be" {
        url.path_segments()?.next().map(str::to_owned)
    } else if url.path() == "/watch" {
        url.query_pairs()
            .find(|(k, _)| k == "v")
            .map(|(_, v)| v.into_owned())
    } else {
        url.path()
            .strip_prefix("/shorts/")
            .map(|rest| rest.trim_end_matches('/').to_owned())
    }?;
    is_valid_id(&id).then_some(id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_archive_lines() {
        let ids =
            parse("youtube abc_DEF-123\n\nyoutube ../etc\nsoundcloud x\n  youtube xyz  \ngarbage");
        let mut ids: Vec<&str> = ids.iter().map(String::as_str).collect();
        ids.sort_unstable();
        assert_eq!(ids, vec!["abc_DEF-123", "xyz"]);
    }

    #[test]
    fn finds_video_ids() {
        for (url, id) in [
            (
                "https://www.youtube.com/watch?v=abc_DEF-123",
                Some("abc_DEF-123"),
            ),
            (
                "https://music.youtube.com/watch?v=abc&list=OLAK5uy_x",
                Some("abc"),
            ),
            ("https://youtu.be/abc?t=10", Some("abc")),
            ("https://www.youtube.com/shorts/abc", Some("abc")),
            ("https://www.youtube.com/playlist?list=PL1", None),
            ("https://www.youtube.com/watch?v=../x", None),
            ("not a url", None),
        ] {
            assert_eq!(video_id(url).as_deref(), id, "{url}");
        }
    }

    #[test]
    fn appends_loads_and_clears() {
        let dir = std::env::temp_dir().join(format!("offbeat-history-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let file = dir.join("nested").join("history.txt");
        assert!(load(&file).is_empty());
        append(&file, "aaa").expect("append");
        append(&file, "bbb").expect("append");
        assert_eq!(
            fs::read_to_string(&file).expect("read"),
            "youtube aaa\nyoutube bbb\n"
        );
        assert_eq!(load(&file).len(), 2);
        clear(&file).expect("clear");
        clear(&file).expect("clear twice");
        assert!(load(&file).is_empty());
        let _ = fs::remove_dir_all(&dir);
    }
}
