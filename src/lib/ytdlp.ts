// Client-side helpers around yt-dlp. The backend builds the real command;
// this only pre-validates URLs and estimates sizes for the preview.

import type { Profile } from './api';

const SUPPORTED_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
]);

/** Returns the trimmed URL when it is an http(s) YouTube link, else null. */
export function parseSupportedUrl(raw: string): string | null {
  const text = raw.trim();
  // Reject whitespace inside: a pasted sentence is not a URL.
  if (text === '' || /\s/.test(text)) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username !== '' || url.password !== '') return null;
  if (!SUPPORTED_HOSTS.has(url.hostname.toLowerCase())) return null;
  return text;
}

export function isSupportedUrl(raw: string): boolean {
  return parseSupportedUrl(raw) !== null;
}

/** MB (10^6 bytes) per minute, from the planning doc's "Tamanho por perfil" table. */
export const MB_PER_MINUTE: Record<Profile, number> = {
  original: 0.96,
  balanced: 1.0,
  economy: 0.75,
};

/** Estimated output size in bytes for a duration in seconds. */
export function estimateBytes(durationSeconds: number, profile: Profile): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 0;
  return (durationSeconds / 60) * MB_PER_MINUTE[profile] * 1_000_000;
}

export interface SizeEstimate {
  bytes: number;
  /** Entries with unknown duration, left out of the estimate. */
  unknownCount: number;
}

/** Sums the estimate over entries; null when no entry has a known duration. */
export function estimateEntries(
  durations: ReadonlyArray<number | null>,
  profile: Profile,
): SizeEstimate | null {
  let seconds = 0;
  let unknownCount = 0;
  for (const d of durations) {
    if (d !== null && Number.isFinite(d) && d > 0) seconds += d;
    else unknownCount += 1;
  }
  if (unknownCount === durations.length) return null;
  return { bytes: estimateBytes(seconds, profile), unknownCount };
}
