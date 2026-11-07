// Locale-aware formatting. Sizes use decimal units (1 MB = 10^6 bytes),
// matching the planning doc's MB-per-minute table.

import type { Lang } from './api';

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

export function formatBytes(bytes: number, lang: Lang): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit++;
  }
  // One decimal from MB up; B and KB don't need it.
  const digits = unit >= 2 && value < 100 ? 1 : 0;
  const text = new Intl.NumberFormat(lang, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
  return `${text} ${UNITS[unit] ?? ''}`.trimEnd();
}

export function formatSpeed(bytesPerSecond: number, lang: Lang): string {
  return `${formatBytes(bytesPerSecond, lang)}/s`;
}

/** 205 → "3:25", 3723 → "1:02:03". */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function formatPercent(fraction: number, lang: Lang): string {
  return new Intl.NumberFormat(lang, { style: 'percent', maximumFractionDigits: 0 }).format(
    Math.min(1, Math.max(0, fraction)),
  );
}

/** "01" for playlist positions, padded to at least two digits. */
export function formatIndex(index: number): string {
  return String(index).padStart(2, '0');
}
