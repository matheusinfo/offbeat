import { describe, expect, it } from 'vitest';
import { parseLine, parseLooseJson } from '../src/lib/progress';

describe('parseLine', () => {
  it('parses PROG with total_bytes', () => {
    const e = parseLine(
      'PROG {"status":"downloading","downloaded_bytes":500,"total_bytes":1000,"speed":250.5,"eta":2}',
    );
    expect(e).toEqual({
      type: 'progress',
      downloaded: 500,
      total: 1000,
      speed: 250.5,
      eta: 2,
      status: 'downloading',
      fraction: 0.5,
    });
  });

  it('falls back to total_bytes_estimate and ignores leading whitespace', () => {
    const e = parseLine('   PROG {"downloaded_bytes":250,"total_bytes":null,"total_bytes_estimate":1000}\r');
    expect(e).toMatchObject({ type: 'progress', total: 1000, fraction: 0.25, speed: null, eta: null });
  });

  it('tolerates NaN/Infinity and missing fields', () => {
    const e = parseLine('PROG {"downloaded_bytes":10,"speed":NaN,"eta":Infinity,"filename":"NaN Infinity.webm"}');
    expect(e).toMatchObject({ type: 'progress', downloaded: 10, total: null, speed: null, eta: null, fraction: null });
  });

  it('uses fragments when bytes total is unknown', () => {
    expect(parseLine('PROG {"fragment_index":3,"fragment_count":12}')).toMatchObject({ fraction: 0.25 });
  });

  it('clamps fractions and treats finished as 1', () => {
    expect(parseLine('PROG {"downloaded_bytes":2000,"total_bytes":1000}')).toMatchObject({ fraction: 1 });
    expect(parseLine('PROG {"status":"finished","downloaded_bytes":5}')).toMatchObject({ fraction: 1 });
    expect(parseLine('PROG {"downloaded_bytes":-5,"total_bytes":0}')).toMatchObject({
      downloaded: null,
      total: null,
      fraction: null,
    });
  });

  it('returns null for broken PROG json', () => {
    expect(parseLine('PROG {"downloaded_bytes":')).toBeNull();
    expect(parseLine('PROG [1,2]')).toBeNull();
    expect(parseLine('PROG null')).toBeNull();
  });

  it('parses POST lines', () => {
    expect(parseLine('POST ExtractAudio started')).toEqual({
      type: 'postprocess',
      name: 'ExtractAudio',
      status: 'started',
    });
    expect(parseLine('  POST EmbedThumbnail finished\n')).toEqual({
      type: 'postprocess',
      name: 'EmbedThumbnail',
      status: 'finished',
    });
    expect(parseLine('POST ExtractAudio')).toBeNull();
  });

  it('parses DONE with spaces in the path', () => {
    expect(parseLine('DONE /home/u/Música/Offbeat/01 - My Song (Live).m4a')).toEqual({
      type: 'done',
      filepath: '/home/u/Música/Offbeat/01 - My Song (Live).m4a',
    });
    expect(parseLine('DONE   ')).toBeNull();
  });

  it('ignores other lines', () => {
    expect(parseLine('[youtube] abc_DEF-123: Downloading webpage')).toBeNull();
    expect(parseLine('PROGRESS 5')).toBeNull();
    expect(parseLine('')).toBeNull();
  });
});

describe('parseLooseJson', () => {
  it('keeps NaN inside strings and escaped quotes', () => {
    expect(parseLooseJson('{"a":"say \\"NaN\\"","b":-Infinity}')).toEqual({ a: 'say "NaN"', b: null });
  });
});
