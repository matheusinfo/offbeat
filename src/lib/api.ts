// Contract between the React UI and the Rust backend (src-tauri/src).
// Every type here has a serde twin in Rust; keep both sides in sync.
// The UI never builds yt-dlp arguments or picks paths: it sends a URL and an
// id, and the backend builds the command from the saved settings.

import { Channel, invoke } from '@tauri-apps/api/core';

export type Lang = 'pt-BR' | 'en-US';

/** Size profiles from docs/planning.md ("Compactação para o relógio"). */
export type Profile = 'original' | 'balanced' | 'economy';

export type FilenamePattern = 'title' | 'artist-title';

export interface Settings {
  /** Absolute path. Default: XDG music dir + /Offbeat (~/Música/Offbeat). */
  outputDir: string;
  profile: Profile;
  filenamePattern: FilenamePattern;
  /** Cut non-music parts with SponsorBlock (contacts sponsor.ajay.app). */
  sponsorblock: boolean;
  /** Same loudness for every track; ignored by the Original profile (no re-encode). */
  normalizeVolume: boolean;
  /** Skip videos already in the download history. */
  skipDownloaded: boolean;
  /** null follows the system language. */
  language: Lang | null;
}

export interface PreviewEntry {
  id: string;
  /** Watch URL for this track, already validated by the backend. */
  url: string;
  title: string;
  uploader: string | null;
  /** Seconds. */
  duration: number | null;
  /** Already in the download history (~/.local/share/offbeat/history.txt). */
  downloaded: boolean;
}

/** A chapter of a video, or the part of it a download is limited to. */
export interface Chapter {
  title: string;
  /** Seconds from the start of the video. */
  start: number;
  end: number;
}

export interface Preview {
  kind: 'video' | 'playlist';
  id: string;
  url: string;
  title: string;
  uploader: string | null;
  /** Seconds. For playlists, the sum of known entry durations (or null). */
  duration: number | null;
  /** Only https://i.ytimg.com/... URLs (the CSP allows nothing else). */
  thumbnail: string | null;
  /** For a single video, one entry equal to the video itself. */
  entries: PreviewEntry[];
  /** Only for a single video with two or more chapters; empty otherwise. */
  chapters: Chapter[];
}

export interface DownloadRequest {
  /** Chosen by the UI; [A-Za-z0-9_-]{1,64}. */
  id: string;
  url: string;
  /** 1-based position in the playlist; adds a "01 - " prefix to the file name. */
  index: number | null;
  /** Download only this chapter, named and tagged as its own track. */
  section: Chapter | null;
  /** Download even if the video is in the history. */
  force: boolean;
}

/** Raw output line from yt-dlp (stdout or stderr); parsed in lib/progress.ts. */
export type DownloadEvent = {
  event: 'line';
  data: { stream: 'stdout' | 'stderr'; line: string };
};

export interface DownloadOutcome {
  /** skipped: already in the history (and skipDownloaded is on); nothing ran. */
  status: 'success' | 'failed' | 'canceled' | 'skipped';
  exitCode: number | null;
  /** Last stderr lines (at most 30), for lib/errors.ts. */
  stderr: string[];
}

export type ErrorCode =
  | 'invalid_url'
  | 'invalid_request'
  | 'invalid_settings'
  | 'sidecar_missing'
  | 'spawn_failed'
  | 'ytdlp_failed'
  | 'bad_output'
  | 'busy'
  | 'io';

/** Rejection value of every command. */
export interface AppError {
  code: ErrorCode;
  message: string;
  /** stderr tail for ytdlp_failed, the tested path for sidecar_missing. */
  detail: string[];
}

/** A playlist kept for one-click sync (~/.local/share/offbeat/playlists.json). */
export interface SavedPlaylist {
  url: string;
  title: string;
}

export interface ToolVersions {
  ytDlp: string | null;
  ffmpeg: string | null;
  deno: string | null;
}

export function isAppError(e: unknown): e is AppError {
  return typeof e === 'object' && e !== null && 'code' in e && 'message' in e;
}

export const api = {
  preview: (url: string) => invoke<Preview>('preview', { url }),

  download: (request: DownloadRequest, onLine: (e: DownloadEvent['data']) => void) => {
    const onEvent = new Channel<DownloadEvent>();
    onEvent.onmessage = (msg) => {
      if (msg.event === 'line') onLine(msg.data);
    };
    return invoke<DownloadOutcome>('download', { request, onEvent });
  },

  /** true if a running download with this id was found and stopped. */
  cancelDownload: (id: string) => invoke<boolean>('cancel_download', { id }),

  getSettings: () => invoke<Settings>('get_settings'),

  /** Validates, saves to ~/.config/offbeat/settings.json and returns what was saved. */
  saveSettings: (settings: Settings) => invoke<Settings>('save_settings', { settings }),

  openOutputDir: () => invoke<void>('open_output_dir'),

  /** Total bytes of the files directly inside the output folder. */
  outputDirSize: () => invoke<number>('output_dir_size'),

  toolVersions: () => invoke<ToolVersions>('tool_versions'),

  /** Number of videos in the download history. */
  historyCount: () => invoke<number>('history_count'),

  clearHistory: () => invoke<void>('clear_history'),

  listPlaylists: () => invoke<SavedPlaylist[]>('list_playlists'),

  /** Adds (or renames, same URL) and returns the updated list. */
  savePlaylist: (playlist: SavedPlaylist) => invoke<SavedPlaylist[]>('save_playlist', { playlist }),

  removePlaylist: (url: string) => invoke<SavedPlaylist[]>('remove_playlist', { url }),
};
