import { describe, expect, it } from 'vitest';
import { formatBytes, formatDuration, formatIndex, formatPercent, formatSpeed } from '../src/lib/format';

describe('format', () => {
  it('formats bytes per locale', () => {
    expect(formatBytes(3_840_000, 'pt-BR')).toBe('3,8 MB');
    expect(formatBytes(3_840_000, 'en-US')).toBe('3.8 MB');
    expect(formatBytes(512, 'en-US')).toBe('512 B');
    expect(formatBytes(45_300, 'en-US')).toBe('45 KB');
    expect(formatBytes(123_400_000, 'en-US')).toBe('123 MB');
    expect(formatBytes(1_500_000_000, 'pt-BR')).toBe('1,5 GB');
    expect(formatBytes(-1, 'en-US')).toBe('—');
  });

  it('formats speed', () => {
    expect(formatSpeed(1_200_000, 'pt-BR')).toBe('1,2 MB/s');
  });

  it('formats durations', () => {
    expect(formatDuration(205)).toBe('3:25');
    expect(formatDuration(3723)).toBe('1:02:03');
    expect(formatDuration(5)).toBe('0:05');
    expect(formatDuration(Number.NaN)).toBe('—');
  });

  it('formats percent and index', () => {
    expect(formatPercent(0.423, 'en-US')).toBe('42%');
    expect(formatPercent(2, 'en-US')).toBe('100%');
    expect(formatIndex(3)).toBe('03');
    expect(formatIndex(120)).toBe('120');
  });
});
