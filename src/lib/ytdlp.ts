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

/**
 * Video id of a link that points at one video inside a list
 * (watch?v=ID&list=… or youtu.be/ID?list=…). yt-dlp downloads the whole list
 * for these; the id lets the user pick just that track. Null otherwise.
 */
export function focusedVideoId(raw: string): string | null {
  const text = parseSupportedUrl(raw);
  if (text === null) return null;
  const url = new URL(text);
  if (!url.searchParams.get('list')) return null;
  const id = url.hostname.toLowerCase() === 'youtu.be' ? url.pathname.slice(1) : url.searchParams.get('v');
  return id !== null && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
}

/** Links previewed at once; more than this is almost surely a pasting mistake. */
export const MAX_LINKS = 20;

export interface ParsedLinks {
  /** Supported URLs in the order pasted, without duplicates. */
  urls: string[];
  /** Words that are not supported links. */
  invalid: string[];
}

/** Splits pasted text (spaces or line breaks) into YouTube links. */
export function parseLinks(raw: string): ParsedLinks {
  const urls: string[] = [];
  const invalid: string[] = [];
  for (const word of raw.split(/\s+/)) {
    if (word === '') continue;
    const url = parseSupportedUrl(word);
    if (url === null) invalid.push(word);
    else if (!urls.includes(url)) urls.push(url);
  }
  return { urls, invalid };
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
