// Turns yt-dlp stderr and backend AppErrors into a small set of error kinds,
// each with a translated message that suggests what to do next.

import { isAppError, type ErrorCode } from './api';
import type { MessageKey } from '../i18n/pt-BR';

export type StderrKind =
  | 'bot_check'
  | 'private'
  | 'ffmpeg_missing'
  | 'http_403'
  | 'unavailable'
  | 'network'
  | 'unknown';

export type ErrorKind = StderrKind | ErrorCode;

export interface ItemError {
  code: ErrorKind;
  /** Raw line (or tested path) shown under "details"; null when there is none. */
  detail: string | null;
}

// Order matters: the first match wins, so specific causes come before generic ones.
const PATTERNS: ReadonlyArray<readonly [Exclude<StderrKind, 'unknown'>, RegExp]> = [
  ['bot_check', /sign in to confirm you['’]re not a bot/i],
  ['private', /private video|members[- ]only|join this channel/i],
  ['ffmpeg_missing', /ffmpeg not found|ffprobe and ffmpeg not found|ffmpeg and ffprobe not found/i],
  ['http_403', /HTTP Error 403/i],
  // yt-dlp 2026 says "This video is unavailable"; older versions "Video unavailable".
  ['unavailable', /video (is )?unavailable|video is not available/i],
  ['network', /unable to download webpage|temporary failure in name resolution|timed out/i],
];

export function classifyLine(line: string): StderrKind {
  for (const [kind, re] of PATTERNS) if (re.test(line)) return kind;
  return 'unknown';
}

/**
 * Classifies a stderr tail. Searches from the end, because the last errors
 * are the ones that ended the run; earlier lines may be retried warnings.
 */
export function classifyStderr(lines: readonly string[]): ItemError {
  const clean = lines.map((l) => l.trim()).filter((l) => l !== '');
  for (let i = clean.length - 1; i >= 0; i--) {
    const line = clean[i] ?? '';
    const kind = classifyLine(line);
    if (kind !== 'unknown') return { code: kind, detail: line };
  }
  return { code: 'unknown', detail: lastErrorLine(clean) };
}

function lastErrorLine(lines: readonly string[]): string | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] ?? '';
    if (line.startsWith('ERROR:')) return line;
  }
  return lines[lines.length - 1] ?? null;
}

/** Maps a rejection from any api.* call to an ItemError. */
export function errorFromUnknown(e: unknown): ItemError {
  if (!isAppError(e)) {
    const text = e instanceof Error ? e.message : typeof e === 'string' ? e : null;
    return { code: 'unknown', detail: text };
  }
  const detail = Array.isArray(e.detail) ? e.detail.filter((l) => typeof l === 'string') : [];
  if (e.code === 'ytdlp_failed') {
    const classified = classifyStderr(detail);
    return classified.code === 'unknown'
      ? { code: 'ytdlp_failed', detail: classified.detail ?? e.message }
      : classified;
  }
  if (e.code === 'sidecar_missing') {
    // detail holds the tested path(s): that is what the user needs to see.
    return { code: e.code, detail: detail.length > 0 ? detail.join('\n') : e.message };
  }
  const last = detail[detail.length - 1];
  return { code: e.code, detail: last ?? (e.message || null) };
}

export const ERROR_MESSAGE: Record<ErrorKind, MessageKey> = {
  bot_check: 'error.botCheck',
  private: 'error.private',
  ffmpeg_missing: 'error.ffmpegMissing',
  http_403: 'error.http403',
  unavailable: 'error.unavailable',
  network: 'error.network',
  unknown: 'error.unknown',
  invalid_url: 'error.invalidUrl',
  invalid_request: 'error.invalidRequest',
  invalid_settings: 'error.invalidSettings',
  sidecar_missing: 'error.sidecarMissing',
  spawn_failed: 'error.spawnFailed',
  ytdlp_failed: 'error.ytdlpFailed',
  bad_output: 'error.badOutput',
  busy: 'error.busy',
  io: 'error.io',
};
