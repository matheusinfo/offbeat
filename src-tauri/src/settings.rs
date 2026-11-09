use crate::error::{AppError, AppResult, ErrorCode};
use crate::state::AppState;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use tauri::State;

const MAX_PATH_BYTES: usize = 4096;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Profile {
    Original,
    Balanced,
    Economy,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FilenamePattern {
    Title,
    ArtistTitle,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Lang {
    #[serde(rename = "pt-BR")]
    PtBr,
    #[serde(rename = "en-US")]
    EnUs,
}

/// Mirrors `Settings` in src/lib/api.ts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub output_dir: PathBuf,
    pub profile: Profile,
    pub filename_pattern: FilenamePattern,
    pub sponsorblock: bool,
    /// Same loudness for every track (loudnorm); ignored by the Original profile.
    pub normalize_volume: bool,
    /// Skip videos already in the download history.
    pub skip_downloaded: bool,
    pub language: Option<Lang>,
}

impl Settings {
    /// Balanced is the default until M4A playback on the GT 5 is confirmed
    /// (see "Pendência" in docs/planning.md).
    pub fn defaults(output_dir: PathBuf) -> Self {
        Self {
            output_dir,
            profile: Profile::Balanced,
            filename_pattern: FilenamePattern::Title,
            sponsorblock: false,
            normalize_volume: false,
            skip_downloaded: true,
            language: None,
        }
    }

    pub fn validate(&self) -> AppResult<()> {
        validate_output_dir(&self.output_dir)
    }
}

pub fn validate_output_dir(dir: &Path) -> AppResult<()> {
    let invalid = |msg: &str| {
        Err(AppError::new(ErrorCode::InvalidSettings, msg)
            .with_detail(vec![dir.to_string_lossy().into_owned()]))
    };
    if dir.as_os_str().len() > MAX_PATH_BYTES {
        return invalid("output folder path is too long");
    }
    if !dir.is_absolute() {
        return invalid("output folder must be an absolute path");
    }
    if dir.components().any(|c| c == Component::ParentDir) {
        return invalid("output folder must not contain '..'");
    }
    if dir.parent().is_none() {
        return invalid("output folder must not be the root folder");
    }
    Ok(())
}

/// Reads settings field by field so one bad or missing value (e.g. from an
/// older version) falls back to its default instead of resetting everything.
pub fn load(path: &Path, defaults: Settings) -> Settings {
    let Ok(text) = fs::read_to_string(path) else {
        return defaults;
    };
    let Ok(serde_json::Value::Object(map)) = serde_json::from_str(&text) else {
        return defaults;
    };
    fn field<T: DeserializeOwned>(
        map: &serde_json::Map<String, serde_json::Value>,
        key: &str,
    ) -> Option<T> {
        map.get(key)
            .and_then(|v| serde_json::from_value(v.clone()).ok())
    }
    let output_dir = field::<PathBuf>(&map, "outputDir")
        .filter(|d| validate_output_dir(d).is_ok())
        .unwrap_or(defaults.output_dir);
    Settings {
        output_dir,
        profile: field(&map, "profile").unwrap_or(defaults.profile),
        filename_pattern: field(&map, "filenamePattern").unwrap_or(defaults.filename_pattern),
        sponsorblock: field(&map, "sponsorblock").unwrap_or(defaults.sponsorblock),
        normalize_volume: field(&map, "normalizeVolume").unwrap_or(defaults.normalize_volume),
        skip_downloaded: field(&map, "skipDownloaded").unwrap_or(defaults.skip_downloaded),
        language: field::<Option<Lang>>(&map, "language").unwrap_or(defaults.language),
    }
}

/// Writes to a temp file and renames it, so a crash never leaves a
/// half-written settings.json.
pub fn store(path: &Path, settings: &Settings) -> AppResult<()> {
    let ctx = "could not save settings";
    let dir = path
        .parent()
        .ok_or_else(|| AppError::new(ErrorCode::Io, ctx))?;
    fs::create_dir_all(dir).map_err(|e| AppError::io(ctx, &e))?;
    let json = serde_json::to_vec_pretty(settings)
        .map_err(|e| AppError::new(ErrorCode::Io, format!("{ctx}: {e}")))?;
    let tmp = path.with_extension("json.tmp");
    let write = || -> std::io::Result<()> {
        let mut file = fs::File::create(&tmp)?;
        file.write_all(&json)?;
        file.write_all(b"\n")?;
        file.sync_all()?;
        fs::rename(&tmp, path)
    };
    write().map_err(|e| {
        let _ = fs::remove_file(&tmp);
        AppError::io(ctx, &e)
    })
}

#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> AppResult<Settings> {
    Ok(state.settings())
}

#[tauri::command]
pub async fn save_settings(state: State<'_, AppState>, settings: Settings) -> AppResult<Settings> {
    settings.validate()?;
    store(&state.paths.settings_file, &settings)?;
    state.set_settings(settings.clone());
    Ok(settings)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("offbeat-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("create test dir");
        dir
    }

    fn defaults() -> Settings {
        Settings::defaults(PathBuf::from("/home/u/Music/Offbeat"))
    }

    #[test]
    fn serializes_like_api_ts() {
        let s = Settings {
            language: Some(Lang::PtBr),
            filename_pattern: FilenamePattern::ArtistTitle,
            ..defaults()
        };
        let v = serde_json::to_value(&s).expect("serialize");
        assert_eq!(
            v,
            serde_json::json!({
                "outputDir": "/home/u/Music/Offbeat",
                "profile": "balanced",
                "filenamePattern": "artist-title",
                "sponsorblock": false,
                "normalizeVolume": false,
                "skipDownloaded": true,
                "language": "pt-BR"
            })
        );
    }

    #[test]
    fn validates_output_dir() {
        assert!(validate_output_dir(Path::new("/home/u/Música/Offbeat")).is_ok());
        for bad in ["relative/dir", "/", "/home/u/../etc", ""] {
            let err = validate_output_dir(Path::new(bad)).expect_err(bad);
            assert_eq!(err.code, ErrorCode::InvalidSettings);
        }
        let long = format!("/{}", "a".repeat(MAX_PATH_BYTES));
        assert!(validate_output_dir(Path::new(&long)).is_err());
    }

    #[test]
    fn load_falls_back_per_field() {
        let dir = tmp_dir("load");
        let file = dir.join("settings.json");
        assert_eq!(load(&file, defaults()), defaults(), "missing file");

        fs::write(&file, "{not json").expect("write");
        assert_eq!(load(&file, defaults()), defaults(), "corrupt file");

        fs::write(
            &file,
            r#"{"outputDir":"relative","profile":"economy","filenamePattern":"nope","language":"en-US"}"#,
        )
        .expect("write");
        let s = load(&file, defaults());
        assert_eq!(s.output_dir, defaults().output_dir);
        assert_eq!(s.profile, Profile::Economy);
        assert_eq!(s.filename_pattern, FilenamePattern::Title);
        assert_eq!(s.language, Some(Lang::EnUs));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn store_then_load_roundtrips() {
        let dir = tmp_dir("store");
        let file = dir.join("nested").join("settings.json");
        let s = Settings {
            output_dir: PathBuf::from("/tmp/x"),
            profile: Profile::Original,
            filename_pattern: FilenamePattern::ArtistTitle,
            sponsorblock: true,
            normalize_volume: true,
            skip_downloaded: false,
            language: Some(Lang::EnUs),
        };
        store(&file, &s).expect("store");
        assert!(!file.with_extension("json.tmp").exists());
        assert_eq!(load(&file, defaults()), s);
        let _ = fs::remove_dir_all(&dir);
    }
}
