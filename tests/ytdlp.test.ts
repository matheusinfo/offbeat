import { describe, expect, it } from 'vitest';
import {
  estimateBytes,
  estimateEntries,
  focusedVideoId,
  isSupportedUrl,
  parseLinks,
  parseSupportedUrl,
} from '../src/lib/ytdlp';

describe('isSupportedUrl', () => {
  it.each([
    'https://www.youtube.com/watch?v=abc_DEF-123',
    'https://youtube.com/watch?v=abc_DEF-123',
    'https://m.youtube.com/watch?v=abc_DEF-123',
    'https://music.youtube.com/watch?v=abc&list=RDAMVM',
    'https://music.youtube.com/playlist?list=OLAK5uy_abcdefghijABCDEFGHIJ0123456789xyz',
    'https://music.youtube.com/browse/MPREb_abcDEF12345',
    'https://youtu.be/abc_DEF-123',
    'http://www.youtube.com/playlist?list=PL123',
    'https://WWW.YOUTUBE.COM/watch?v=x',
    '  https://youtu.be/x  ',
  ])('accepts %s', (url) => expect(isSupportedUrl(url)).toBe(true));

  it.each([
    '',
    'youtube.com/watch?v=x',
    'ftp://youtube.com/x',
    'javascript:alert(1)',
    'file:///etc/passwd',
    'https://evil.com/?u=youtube.com',
    'https://youtube.com.evil.com/watch',
    'https://notyoutube.com/watch',
    'https://user:pw@youtube.com/watch',
    'https://vimeo.com/123',
    'https://youtu.be/x and more text',
    '--exec rm',
  ])('rejects %s', (url) => expect(isSupportedUrl(url)).toBe(false));

  it('returns the trimmed URL', () => {
    expect(parseSupportedUrl(' https://youtu.be/x\n')).toBe('https://youtu.be/x');
  });
});

describe('size estimate', () => {
  it('uses MB per minute from the planning table', () => {
    expect(estimateBytes(240, 'original')).toBeCloseTo(3_840_000);
    expect(estimateBytes(240, 'balanced')).toBeCloseTo(4_000_000);
    expect(estimateBytes(240, 'economy')).toBeCloseTo(3_000_000);
    expect(estimateBytes(Number.NaN, 'economy')).toBe(0);
  });

  it('sums entries and counts unknown durations', () => {
    expect(estimateEntries([60, null, 120], 'balanced')).toEqual({ bytes: 3_000_000, unknownCount: 1 });
    expect(estimateEntries([null, null], 'balanced')).toBeNull();
    expect(estimateEntries([], 'balanced')).toBeNull();
  });
});

describe('parseLinks', () => {
  it('splits links on spaces and line breaks and drops duplicates', () => {
    expect(parseLinks(' https://youtu.be/a\nhttps://youtu.be/b  https://youtu.be/a\r\n')).toEqual({
      urls: ['https://youtu.be/a', 'https://youtu.be/b'],
      invalid: [],
    });
  });

  it('reports words that are not links', () => {
    expect(parseLinks('https://youtu.be/a and https://vimeo.com/1')).toEqual({
      urls: ['https://youtu.be/a'],
      invalid: ['and', 'https://vimeo.com/1'],
    });
    expect(parseLinks('   ')).toEqual({ urls: [], invalid: [] });
  });
});

describe('focusedVideoId', () => {
  it.each([
    ['https://music.youtube.com/watch?v=abc_DEF-123&list=OLAK5uy_x', 'abc_DEF-123'],
    ['https://www.youtube.com/watch?list=PL1&v=abc_DEF-123&index=3', 'abc_DEF-123'],
    ['https://youtu.be/abc_DEF-123?list=PL1', 'abc_DEF-123'],
  ])('finds the video in %s', (url, id) => expect(focusedVideoId(url)).toBe(id));

  it.each([
    'https://www.youtube.com/watch?v=abc_DEF-123',
    'https://music.youtube.com/playlist?list=OLAK5uy_x',
    'https://www.youtube.com/watch?v=bad!id&list=PL1',
    'https://vimeo.com/watch?v=x&list=y',
  ])('ignores %s', (url) => expect(focusedVideoId(url)).toBeNull());
});
