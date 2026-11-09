//! Pure functions that build yt-dlp arguments and parse its output.
//! Nothing here touches the filesystem or spawns processes.

use crate::error::{AppError, AppResult, ErrorCode};
use crate::settings::{FilenamePattern, Profile};
use serde::{Deserialize, Serialize};
use serde_json::Value;

const MAX_URL_LEN: usize = 2048;
const ALLOWED_HOSTS: &[&str] = &[
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be",
];
const THUMBNAIL_PREFIX: &str = "https://i.ytimg.com/";
// Quoted so ffmpeg's filtergraph parser keeps the commas inside min().
const COVER_PPA: &str =
    "ThumbnailsConvertor+ffmpeg_o:-vf \"crop='min(iw,ih)':'min(iw,ih)',scale=300:300\" -q:v 5";
// One-pass EBU R128 to -14 LUFS, the level streaming services use. loudnorm
// outputs 192 kHz, which LAME rejects, hence the explicit sample rate.
const LOUDNORM_PPA: &str = "ExtractAudio+ffmpeg_o:-af loudnorm=I=-14:TP=-1.5:LRA=11 -ar 44100";

fn invalid_url(msg: &str) -> AppError {
    AppError::new(ErrorCode::InvalidUrl, msg)
}

/// Accepts only http(s) YouTube URLs and returns them normalized.
/// The `--` before the URL already stops option injection; this also keeps
/// yt-dlp away from every other extractor and from local files.
pub fn validate_url(input: &str) -> AppResult<String> {
    if input.is_empty() {
        return Err(invalid_url("empty URL"));
    }
    if input.len() > MAX_URL_LEN {
        return Err(invalid_url("URL is too long"));
    }
    if input.starts_with('-') {
        return Err(invalid_url("URL must not start with '-'"));
    }
    if input.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err(invalid_url(
            "URL must not contain spaces or control characters",
        ));
    }
    let url = url::Url::parse(input).map_err(|_| invalid_url("not a valid URL"))?;
    if !matches!(url.scheme(), "https" | "http") {
        return Err(invalid_url("only http and https URLs are accepted"));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(invalid_url("URL must not contain credentials"));
    }
    if url.port().is_some() {
        return Err(invalid_url("URL must not contain a port"));
    }
    match url.host_str() {
        Some(host) if ALLOWED_HOSTS.contains(&host) => Ok(url.into()),
        _ => Err(invalid_url("only YouTube links are accepted")),
    }
}

/// YouTube video and playlist ids; also safe as a folder name.
pub fn is_valid_id(id: &str) -> bool {
    (1..=64).contains(&id.len())
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

fn js_runtime_args(deno: Option<&str>) -> Vec<String> {
    match deno {
        Some(path) => vec!["--js-runtimes".into(), format!("deno:{path}")],
        None => Vec::new(),
    }
}

pub fn preview_args(url: &str, deno: Option<&str>) -> Vec<String> {
    let mut args: Vec<String> = ["--ignore-config", "--no-color", "-J", "--flat-playlist"]
        .into_iter()
        .map(String::from)
        .collect();
    args.extend(js_runtime_args(deno));
    args.push("--".into());
    args.push(url.into());
    args
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PreviewKind {
    Video,
    Playlist,
}

/// Mirrors `PreviewEntry` in src/lib/api.ts.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PreviewEntry {
    pub id: String,
    pub url: String,
    pub title: String,
    pub uploader: Option<String>,
    pub duration: Option<f64>,
}

/// A chapter of a video; also the part of it a download may be limited to.
/// Mirrors `Chapter` in src/lib/api.ts.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Chapter {
    pub title: String,
    /// Seconds from the start of the video.
    pub start: f64,
    pub end: f64,
}

const MAX_CHAPTERS: usize = 300;
const MAX_CHAPTER_TITLE: usize = 300;

impl Chapter {
    /// Checks a chapter sent back by the UI before it reaches yt-dlp.
    pub fn validate(&self) -> AppResult<()> {
        let bad = |msg: &str| Err(AppError::new(ErrorCode::InvalidRequest, msg));
        if !(self.start.is_finite() && self.end.is_finite()) || self.start < 0.0 {
            return bad("chapter times must be finite and not negative");
        }
        if self.end <= self.start {
            return bad("chapter must end after it starts");
        }
        let title = self.title.trim();
        if title.is_empty() || title.chars().count() > MAX_CHAPTER_TITLE {
            return bad("chapter title is empty or too long");
        }
        if title.chars().any(char::is_control) {
            return bad("chapter title must not contain control characters");
        }
        Ok(())
    }
}

/// Chapters worth splitting into tracks: at least two, in order, valid.
fn chapters(v: &Value) -> Vec<Chapter> {
    let Some(list) = v.get("chapters").and_then(Value::as_array) else {
        return Vec::new();
    };
    let parsed: Vec<Chapter> = list
        .iter()
        .take(MAX_CHAPTERS)
        .enumerate()
        .filter_map(|(i, c)| {
            let time = |k: &str| c.get(k).and_then(Value::as_f64);
            let title = str_field(c, "title")
                .map(|t| {
                    t.chars()
                        .filter(|ch| !ch.is_control())
                        .take(MAX_CHAPTER_TITLE)
                        .collect()
                })
                .filter(|t: &String| !t.trim().is_empty())
                .unwrap_or_else(|| format!("{:02}", i + 1));
            let chapter = Chapter {
                title,
                start: time("start_time")?,
                end: time("end_time")?,
            };
            chapter.validate().ok().map(|()| chapter)
        })
        .collect();
    if parsed.len() < 2 || parsed.windows(2).any(|w| w[1].start < w[0].start) {
        return Vec::new();
    }
    parsed
}

/// Mirrors `Preview` in src/lib/api.ts.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Preview {
    pub kind: PreviewKind,
    pub id: String,
    pub url: String,
    pub title: String,
    pub uploader: Option<String>,
    pub duration: Option<f64>,
    pub thumbnail: Option<String>,
    pub entries: Vec<PreviewEntry>,
    /// Only for a single video with two or more chapters; empty otherwise.
    pub chapters: Vec<Chapter>,
}

fn str_field<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
}

fn uploader(v: &Value) -> Option<String> {
    str_field(v, "uploader")
        .or_else(|| str_field(v, "channel"))
        .map(str::to_owned)
}

fn duration(v: &Value) -> Option<f64> {
    v.get("duration")
        .and_then(Value::as_f64)
        .filter(|d| d.is_finite() && *d >= 0.0)
}

fn watch_url(id: &str) -> String {
    format!("https://www.youtube.com/watch?v={id}")
}

/// First field that holds a valid YouTube URL, else `fallback`.
fn youtube_url(v: &Value, fallback: String) -> String {
    ["url", "webpage_url"]
        .into_iter()
        .filter_map(|k| str_field(v, k))
        .find_map(|u| validate_url(u).ok())
        .unwrap_or(fallback)
}

fn allowed_thumbnail(url: &str) -> bool {
    url.starts_with(THUMBNAIL_PREFIX) && !url.chars().any(|c| c.is_whitespace() || c.is_control())
}

/// `thumbnail`, else the widest allowed entry in `thumbnails[]` (the last one
/// when widths are missing, since yt-dlp sorts them worst to best).
fn thumbnail(v: &Value) -> Option<String> {
    if let Some(t) = str_field(v, "thumbnail").filter(|t| allowed_thumbnail(t)) {
        return Some(t.to_owned());
    }
    let list = v.get("thumbnails")?.as_array()?;
    list.iter()
        .enumerate()
        .filter_map(|(i, t)| {
            let url = str_field(t, "url").filter(|u| allowed_thumbnail(u))?;
            let width = t.get("width").and_then(Value::as_u64).unwrap_or(0);
            Some(((width, i), url))
        })
        .max_by_key(|(key, _)| *key)
        .map(|(_, url)| url.to_owned())
}

fn parse_entry(v: &Value) -> Option<PreviewEntry> {
    // Channel pages list tabs/playlists as entries; only plain videos are tracks.
    if let Some(ie) = str_field(v, "ie_key") {
        if ie != "Youtube" {
            return None;
        }
    }
    if str_field(v, "_type") == Some("playlist") {
        return None;
    }
    let id = str_field(v, "id").filter(|id| is_valid_id(id))?;
    Some(PreviewEntry {
        id: id.to_owned(),
        url: youtube_url(v, watch_url(id)),
        title: str_field(v, "title").unwrap_or(id).to_owned(),
        uploader: uploader(v),
        duration: duration(v),
    })
}

pub fn parse_preview(json: &str) -> AppResult<Preview> {
    let bad = |msg: &str| AppError::new(ErrorCode::BadOutput, msg);
    let root: Value =
        serde_json::from_str(json).map_err(|_| bad("yt-dlp returned invalid JSON"))?;
    if !root.is_object() {
        return Err(bad("yt-dlp returned unexpected JSON"));
    }
    let id = str_field(&root, "id")
        .filter(|id| is_valid_id(id))
        .ok_or_else(|| bad("yt-dlp output has no valid id"))?
        .to_owned();
    let title = str_field(&root, "title").unwrap_or(&id).to_owned();

    if str_field(&root, "_type") == Some("playlist") {
        let entries: Vec<PreviewEntry> = root
            .get("entries")
            .and_then(Value::as_array)
            .map(|list| list.iter().filter_map(parse_entry).collect())
            .unwrap_or_default();
        let known: Vec<f64> = entries.iter().filter_map(|e| e.duration).collect();
        let duration = (!known.is_empty()).then(|| known.iter().sum());
        let thumbnail = thumbnail(&root).or_else(|| {
            root.get("entries")
                .and_then(Value::as_array)
                .and_then(|list| list.first())
                .and_then(thumbnail)
        });
        let fallback = format!("https://www.youtube.com/playlist?list={id}");
        return Ok(Preview {
            kind: PreviewKind::Playlist,
            url: youtube_url(&root, fallback),
            uploader: uploader(&root),
            duration,
            thumbnail,
            entries,
            chapters: Vec::new(),
            title,
            id,
        });
    }

    // webpage_url first: for a video, `url` may be a direct media URL.
    let url = str_field(&root, "webpage_url")
        .and_then(|u| validate_url(u).ok())
        .unwrap_or_else(|| watch_url(&id));
    let entry = PreviewEntry {
        id: id.clone(),
        url: url.clone(),
        title: title.clone(),
        uploader: uploader(&root),
        duration: duration(&root),
    };
    Ok(Preview {
        kind: PreviewKind::Video,
        url,
        uploader: entry.uploader.clone(),
        duration: entry.duration,
        thumbnail: thumbnail(&root),
        entries: vec![entry],
        chapters: chapters(&root),
        title,
        id,
    })
}

/// Everything needed to build a download command. Paths are already
/// resolved by the caller; the UI never supplies any of them.
#[derive(Debug, Clone)]
pub struct DownloadPlan {
    pub url: String,
    pub index: Option<u32>,
    pub profile: Profile,
    pub pattern: FilenamePattern,
    pub sponsorblock: bool,
    pub normalize_volume: bool,
    /// Download only this part of the video, as its own track.
    pub section: Option<Chapter>,
    pub output_dir: String,
    pub temp_dir: String,
    pub ffmpeg: String,
    pub deno: Option<String>,
}

/// Literal text for a Python re.sub replacement: only the backslash is special.
fn regex_replacement(text: &str) -> String {
    text.replace('\\', "\\\\")
}

pub fn output_template(pattern: FilenamePattern, index: Option<u32>) -> String {
    let name = match pattern {
        FilenamePattern::Title => "%(title)s.%(ext)s",
        FilenamePattern::ArtistTitle => "%(artist,uploader)s - %(title)s.%(ext)s",
    };
    match index {
        Some(n) => format!("{n:02} - {name}"),
        None => name.to_owned(),
    }
}

fn profile_args(profile: Profile) -> &'static [&'static str] {
    match profile {
        // Copies AAC without re-encoding when the source already is AAC.
        Profile::Original => &[
            "-f",
            "bestaudio[ext=m4a]/bestaudio",
            "-x",
            "--audio-format",
            "m4a",
        ],
        // LAME VBR V5 (~130 kbps) / V7 (~100 kbps), a single encode.
        Profile::Balanced => &[
            "-f",
            "bestaudio",
            "-x",
            "--audio-format",
            "mp3",
            "--audio-quality",
            "5",
        ],
        Profile::Economy => &[
            "-f",
            "bestaudio",
            "-x",
            "--audio-format",
            "mp3",
            "--audio-quality",
            "7",
        ],
    }
}

pub fn download_args(plan: &DownloadPlan) -> Vec<String> {
    let mut args: Vec<String> = [
        "--ignore-config",
        "--no-color",
        "--no-playlist",
        "--newline",
        "--progress",
        // --print implies --simulate; we still want the download.
        "--no-simulate",
        "--progress-template",
        "download:PROG %(progress)j",
        "--progress-template",
        "postprocess:POST %(progress.postprocessor)s %(progress.status)s",
        "--print",
        "after_move:DONE %(filepath)s",
        "--embed-metadata",
        "--embed-thumbnail",
        "--convert-thumbnails",
        "jpg",
        // Square 300 px cover: 20-30 KB instead of 100-300 KB per track. The
        // center crop removes the side bars YouTube Music adds around album
        // art (16:9 thumbnail, square cover in the middle).
        "--ppa",
        COVER_PPA,
    ]
    .into_iter()
    .map(String::from)
    .collect();

    args.push("--ffmpeg-location".into());
    args.push(plan.ffmpeg.clone());
    args.extend(js_runtime_args(plan.deno.as_deref()));
    args.push("-P".into());
    args.push(plan.output_dir.clone());
    args.push("-P".into());
    args.push(format!("temp:{}", plan.temp_dir));
    args.push("-o".into());
    args.push(output_template(plan.pattern, plan.index));
    if let Some(n) = plan.index {
        // Each track is downloaded alone (--no-playlist), so yt-dlp doesn't
        // know its position; write it to the track tag ourselves.
        args.push("--parse-metadata".into());
        args.push(format!("{n}:(?P<track_number>.+)"));
    }
    if let Some(section) = &plan.section {
        args.push("--download-sections".into());
        args.push(format!("*{}-{}", section.start, section.end));
        // The video's name becomes the album (unless it has one) and the
        // chapter's name the title, in the tags and in the file name. Both
        // run before the file is named, in this order.
        args.push("--parse-metadata".into());
        args.push("%(album,title)s:(?P<album>.+)".into());
        args.push("--replace-in-metadata".into());
        args.push("title".into());
        args.push(".+".into());
        args.push(regex_replacement(section.title.trim()));
    }
    args.extend(profile_args(plan.profile).iter().map(|s| s.to_string()));
    // Original copies the AAC stream; a filter would force a re-encode.
    if plan.normalize_volume && plan.profile != Profile::Original {
        args.push("--ppa".into());
        args.push(LOUDNORM_PPA.into());
    }
    // SponsorBlock times refer to the whole video, not to a section of it.
    if plan.sponsorblock && plan.section.is_none() {
        args.push("--sponsorblock-remove".into());
        args.push("music_offtopic".into());
    }
    args.push("--".into());
    args.push(plan.url.clone());
    args
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_youtube_urls() {
        for ok in [
            "https://www.youtube.com/watch?v=abc_DEF-123",
            "https://youtube.com/watch?v=abc_DEF-123&list=PL123",
            "http://m.youtube.com/watch?v=abc_DEF-123",
            "https://music.youtube.com/playlist?list=OLAK5uy_abc",
            "https://music.youtube.com/browse/MPREb_abcDEF12345",
            "https://music.youtube.com/watch?v=xyz_UVW-789&list=OLAK5uy_abc",
            "https://youtu.be/abc_DEF-123?t=10",
            "https://WWW.YouTube.com/watch?v=x",
        ] {
            assert!(validate_url(ok).is_ok(), "{ok}");
        }
        assert_eq!(
            validate_url("https://WWW.YouTube.com/watch?v=x").as_deref(),
            Ok("https://www.youtube.com/watch?v=x")
        );
    }

    #[test]
    fn rejects_everything_else() {
        let long = format!("https://youtube.com/watch?v={}", "a".repeat(MAX_URL_LEN));
        for bad in [
            "",
            "-o",
            "--exec=rm -rf ~",
            "-https://youtube.com/watch?v=x",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "ftp://youtube.com/x",
            "youtube.com/watch?v=x",
            "https://youtube.com.evil.com/watch?v=x",
            "https://evilyoutube.com/watch?v=x",
            "https://youtube.com@evil.com/watch?v=x",
            "https://user:pass@youtube.com/watch?v=x",
            "https://evil.com\\@youtube.com/",
            "https://evil.com#@youtube.com/",
            "https://youtube.com:8080/watch?v=x",
            "https://youtube.com./watch?v=x",
            " https://youtube.com/watch?v=x",
            "https://youtube.com/watch?v=x y",
            "https://youtube.com/watch?v=x\n",
            "https://youtube.com/\u{0}",
            "https://vimeo.com/123",
            long.as_str(),
        ] {
            let err = validate_url(bad).expect_err(bad);
            assert_eq!(err.code, ErrorCode::InvalidUrl, "{bad}");
        }
    }

    #[test]
    fn validates_ids() {
        assert!(is_valid_id("abc_DEF-123"));
        assert!(is_valid_id("PL-abc_123"));
        for bad in ["", "../x", "a b", "a/b", "ação", &"a".repeat(65)] {
            assert!(!is_valid_id(bad), "{bad}");
        }
    }

    #[test]
    fn preview_args_end_with_url() {
        let args = preview_args("https://youtu.be/x", Some("/opt/deno"));
        assert_eq!(
            args,
            vec![
                "--ignore-config",
                "--no-color",
                "-J",
                "--flat-playlist",
                "--js-runtimes",
                "deno:/opt/deno",
                "--",
                "https://youtu.be/x"
            ]
        );
        assert!(!preview_args("u", None).iter().any(|a| a == "--js-runtimes"));
    }

    #[test]
    fn parses_video() {
        let json = r#"{
            "_type": "video", "id": "abc_DEF-123", "title": "Song",
            "uploader": "Artist", "duration": 213,
            "webpage_url": "https://www.youtube.com/watch?v=abc_DEF-123",
            "url": "https://rr1---sn.googlevideo.com/videoplayback?x",
            "thumbnail": "https://i.ytimg.com/vi/abc_DEF-123/maxresdefault.jpg"
        }"#;
        let p = parse_preview(json).expect("parse");
        assert_eq!(p.kind, PreviewKind::Video);
        assert_eq!(p.url, "https://www.youtube.com/watch?v=abc_DEF-123");
        assert_eq!(p.duration, Some(213.0));
        assert_eq!(p.uploader.as_deref(), Some("Artist"));
        assert_eq!(
            p.thumbnail.as_deref(),
            Some("https://i.ytimg.com/vi/abc_DEF-123/maxresdefault.jpg")
        );
        assert_eq!(p.entries.len(), 1);
        assert_eq!(p.entries[0].id, p.id);
        assert_eq!(p.entries[0].url, p.url);
        assert_eq!(p.entries[0].title, "Song");
    }

    #[test]
    fn parses_chapters_of_a_video() {
        let json = r#"{"id": "abc", "title": "Mix", "chapters": [
            {"start_time": 0, "end_time": 169, "title": "black vortex"},
            {"start_time": 169, "end_time": 410.5, "title": "  "},
            {"start_time": 410.5, "end_time": 400, "title": "backwards"},
            {"start_time": 410.5, "end_time": 615, "title": "carefree"}
        ]}"#;
        let p = parse_preview(json).expect("parse");
        let got: Vec<(&str, f64, f64)> = p
            .chapters
            .iter()
            .map(|c| (c.title.as_str(), c.start, c.end))
            .collect();
        assert_eq!(
            got,
            vec![
                ("black vortex", 0.0, 169.0),
                ("02", 169.0, 410.5),
                ("carefree", 410.5, 615.0)
            ]
        );

        let one = r#"{"id": "abc", "chapters": [{"start_time": 0, "end_time": 9, "title": "x"}]}"#;
        assert!(parse_preview(one).expect("parse").chapters.is_empty());
        assert!(parse_preview(r#"{"id": "abc"}"#)
            .expect("parse")
            .chapters
            .is_empty());
    }

    #[test]
    fn validates_chapters_from_the_ui() {
        let c = |title: &str, start: f64, end: f64| Chapter {
            title: title.into(),
            start,
            end,
        };
        assert!(c("Song", 0.0, 1.5).validate().is_ok());
        for bad in [
            c("Song", -1.0, 5.0),
            c("Song", 5.0, 5.0),
            c("Song", 0.0, f64::INFINITY),
            c("Song", f64::NAN, 5.0),
            c(" ", 0.0, 5.0),
            c("a\nb", 0.0, 5.0),
            c(&"x".repeat(301), 0.0, 5.0),
        ] {
            assert_eq!(
                bad.validate().expect_err(&bad.title).code,
                ErrorCode::InvalidRequest
            );
        }
    }

    #[test]
    fn video_without_title_or_webpage_url() {
        let p = parse_preview(r#"{"id":"abc","channel":"Chan"}"#).expect("parse");
        assert_eq!(p.title, "abc");
        assert_eq!(p.url, "https://www.youtube.com/watch?v=abc");
        assert_eq!(p.uploader.as_deref(), Some("Chan"));
        assert_eq!(p.duration, None);
        assert_eq!(p.thumbnail, None);
    }

    #[test]
    fn parses_playlist() {
        let json = r#"{
            "_type": "playlist", "id": "PLabc", "title": "Mix", "channel": "Someone",
            "webpage_url": "https://www.youtube.com/playlist?list=PLabc",
            "thumbnails": [
                {"url": "https://evil.example/big.jpg", "width": 9999},
                {"url": "https://i.ytimg.com/a.jpg", "width": 168},
                {"url": "https://i.ytimg.com/b.jpg", "width": 336}
            ],
            "entries": [
                {"_type": "url", "ie_key": "Youtube", "id": "aaa", "title": "One",
                 "url": "https://www.youtube.com/watch?v=aaa", "duration": 100.5, "uploader": "U1"},
                {"_type": "url", "ie_key": "Youtube", "id": "bbb",
                 "url": "https://evil.example/watch?v=bbb", "duration": null},
                {"_type": "url", "ie_key": "Youtube", "title": "no id"},
                {"_type": "url", "ie_key": "Youtube", "id": "../etc"},
                {"_type": "url", "ie_key": "YoutubeTab", "id": "UCtab"},
                {"_type": "url", "ie_key": "Youtube", "id": "ccc", "duration": 50}
            ]
        }"#;
        let p = parse_preview(json).expect("parse");
        assert_eq!(p.kind, PreviewKind::Playlist);
        assert_eq!(p.url, "https://www.youtube.com/playlist?list=PLabc");
        assert_eq!(p.uploader.as_deref(), Some("Someone"));
        assert_eq!(p.thumbnail.as_deref(), Some("https://i.ytimg.com/b.jpg"));
        let ids: Vec<&str> = p.entries.iter().map(|e| e.id.as_str()).collect();
        assert_eq!(ids, vec!["aaa", "bbb", "ccc"]);
        assert_eq!(p.entries[0].uploader.as_deref(), Some("U1"));
        assert_eq!(p.entries[1].url, "https://www.youtube.com/watch?v=bbb");
        assert_eq!(p.entries[1].title, "bbb");
        assert_eq!(p.duration, Some(150.5));
    }

    #[test]
    fn playlist_thumbnail_and_duration_fallbacks() {
        let json = r#"{
            "_type": "playlist", "id": "PLx", "thumbnail": "http://i.ytimg.com/insecure.jpg",
            "entries": [
                {"id": "aaa", "thumbnails": [{"url": "https://i.ytimg.com/1.jpg"}, {"url": "https://i.ytimg.com/2.jpg"}]}
            ]
        }"#;
        let p = parse_preview(json).expect("parse");
        assert_eq!(p.thumbnail.as_deref(), Some("https://i.ytimg.com/2.jpg"));
        assert_eq!(p.duration, None);
        assert_eq!(p.url, "https://www.youtube.com/playlist?list=PLx");
        assert_eq!(p.title, "PLx");
    }

    #[test]
    fn rejects_bad_thumbnails() {
        for t in [
            "https://i.ytimg.com.evil.com/x.jpg",
            "javascript:alert(1)",
            "https://i.ytimg.com/x.jpg\" onerror=\"x",
            "data:image/png;base64,AAAA",
        ] {
            let json = serde_json::json!({"id": "abc", "thumbnail": t}).to_string();
            assert_eq!(parse_preview(&json).expect("parse").thumbnail, None, "{t}");
        }
    }

    #[test]
    fn rejects_bad_output() {
        for bad in [
            "",
            "not json",
            "[]",
            r#"{"title":"no id"}"#,
            r#"{"id":"a/b"}"#,
        ] {
            assert_eq!(
                parse_preview(bad).expect_err(bad).code,
                ErrorCode::BadOutput
            );
        }
    }

    fn plan() -> DownloadPlan {
        DownloadPlan {
            url: "https://www.youtube.com/watch?v=abc".into(),
            index: None,
            profile: Profile::Balanced,
            pattern: FilenamePattern::Title,
            sponsorblock: false,
            normalize_volume: false,
            section: None,
            output_dir: "/home/u/Music/Offbeat".into(),
            temp_dir: "/home/u/.cache/offbeat/tmp/job1".into(),
            ffmpeg: "/app/ffmpeg".into(),
            deno: Some("/app/deno".into()),
        }
    }

    fn value_after<'a>(args: &'a [String], flag: &str) -> Vec<&'a str> {
        args.windows(2)
            .filter(|w| w[0] == flag)
            .map(|w| w[1].as_str())
            .collect()
    }

    fn contains_seq(args: &[String], seq: &[&str]) -> bool {
        args.windows(seq.len())
            .any(|w| w.iter().zip(seq).all(|(a, b)| a == b))
    }

    #[test]
    fn download_args_common() {
        let args = download_args(&plan());
        assert_eq!(
            &args[args.len() - 2..],
            ["--", "https://www.youtube.com/watch?v=abc"]
        );
        assert_eq!(args.iter().filter(|a| *a == "--").count(), 1);
        for flag in [
            "--ignore-config",
            "--no-playlist",
            "--newline",
            "--no-simulate",
            "--embed-metadata",
            "--embed-thumbnail",
        ] {
            assert!(args.iter().any(|a| a == flag), "{flag}");
        }
        assert_eq!(
            value_after(&args, "--progress-template"),
            vec![
                "download:PROG %(progress)j",
                "postprocess:POST %(progress.postprocessor)s %(progress.status)s"
            ]
        );
        assert_eq!(
            value_after(&args, "--print"),
            vec!["after_move:DONE %(filepath)s"]
        );
        assert_eq!(
            value_after(&args, "--ppa"),
            vec!["ThumbnailsConvertor+ffmpeg_o:-vf \"crop='min(iw,ih)':'min(iw,ih)',scale=300:300\" -q:v 5"]
        );
        // A single video has no position, so no track tag.
        assert!(!args.iter().any(|a| a == "--parse-metadata"));
        assert_eq!(value_after(&args, "--ffmpeg-location"), vec!["/app/ffmpeg"]);
        assert_eq!(value_after(&args, "--js-runtimes"), vec!["deno:/app/deno"]);
        assert_eq!(
            value_after(&args, "-P"),
            vec![
                "/home/u/Music/Offbeat",
                "temp:/home/u/.cache/offbeat/tmp/job1"
            ]
        );
        assert_eq!(value_after(&args, "-o"), vec!["%(title)s.%(ext)s"]);
        assert!(!args.iter().any(|a| a == "--sponsorblock-remove"));

        let no_deno = download_args(&DownloadPlan {
            deno: None,
            ..plan()
        });
        assert!(!no_deno.iter().any(|a| a == "--js-runtimes"));
    }

    #[test]
    fn download_args_profiles() {
        let cases = [
            (
                Profile::Original,
                &[
                    "-f",
                    "bestaudio[ext=m4a]/bestaudio",
                    "-x",
                    "--audio-format",
                    "m4a",
                ][..],
            ),
            (
                Profile::Balanced,
                &[
                    "-f",
                    "bestaudio",
                    "-x",
                    "--audio-format",
                    "mp3",
                    "--audio-quality",
                    "5",
                ][..],
            ),
            (
                Profile::Economy,
                &[
                    "-f",
                    "bestaudio",
                    "-x",
                    "--audio-format",
                    "mp3",
                    "--audio-quality",
                    "7",
                ][..],
            ),
        ];
        for (profile, expected) in cases {
            let args = download_args(&DownloadPlan { profile, ..plan() });
            assert!(contains_seq(&args, expected), "{profile:?}: {args:?}");
        }
        let original = download_args(&DownloadPlan {
            profile: Profile::Original,
            ..plan()
        });
        assert!(!original.iter().any(|a| a == "--audio-quality"));
    }

    #[test]
    fn download_args_normalize_volume() {
        let args = download_args(&DownloadPlan {
            normalize_volume: true,
            ..plan()
        });
        let ppa = value_after(&args, "--ppa");
        assert_eq!(ppa.len(), 2);
        assert_eq!(
            ppa[1],
            "ExtractAudio+ffmpeg_o:-af loudnorm=I=-14:TP=-1.5:LRA=11 -ar 44100"
        );
        let original = download_args(&DownloadPlan {
            normalize_volume: true,
            profile: Profile::Original,
            ..plan()
        });
        assert_eq!(value_after(&original, "--ppa").len(), 1);
    }

    #[test]
    fn download_args_section() {
        let args = download_args(&DownloadPlan {
            index: Some(2),
            sponsorblock: true,
            section: Some(Chapter {
                title: " Back\\slash \\1 song ".into(),
                start: 169.0,
                end: 410.5,
            }),
            ..plan()
        });
        assert_eq!(
            value_after(&args, "--download-sections"),
            vec!["*169-410.5"]
        );
        assert_eq!(
            value_after(&args, "--parse-metadata"),
            vec!["2:(?P<track_number>.+)", "%(album,title)s:(?P<album>.+)"]
        );
        assert!(contains_seq(
            &args,
            &[
                "--replace-in-metadata",
                "title",
                ".+",
                "Back\\\\slash \\\\1 song"
            ]
        ));
        assert!(!args.iter().any(|a| a == "--sponsorblock-remove"));
        assert_eq!(regex_replacement("a\\b"), "a\\\\b");
    }

    #[test]
    fn download_args_templates_and_sponsorblock() {
        let args = download_args(&DownloadPlan {
            index: Some(3),
            pattern: FilenamePattern::ArtistTitle,
            sponsorblock: true,
            ..plan()
        });
        assert_eq!(
            value_after(&args, "-o"),
            vec!["03 - %(artist,uploader)s - %(title)s.%(ext)s"]
        );
        assert!(contains_seq(
            &args,
            &["--sponsorblock-remove", "music_offtopic"]
        ));
        assert_eq!(
            value_after(&args, "--parse-metadata"),
            vec!["3:(?P<track_number>.+)"]
        );
        assert_eq!(
            output_template(FilenamePattern::Title, Some(12)),
            "12 - %(title)s.%(ext)s"
        );
        assert_eq!(
            output_template(FilenamePattern::Title, Some(120)),
            "120 - %(title)s.%(ext)s"
        );
        assert_eq!(
            args.last().map(String::as_str),
            Some("https://www.youtube.com/watch?v=abc")
        );
    }
}
