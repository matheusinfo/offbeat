import { describe, expect, it } from 'vitest';
import { classifyLine, classifyStderr, errorFromUnknown, ERROR_MESSAGE } from '../src/lib/errors';
import { ptBR } from '../src/i18n/pt-BR';

describe('classifyLine', () => {
  it.each([
    ["ERROR: [youtube] x: Sign in to confirm you're not a bot. Use --cookies", 'bot_check'],
    ['ERROR: [youtube] x: Sign in to confirm you’re not a bot', 'bot_check'],
    ['ERROR: [youtube] x: Private video. Sign in if you\'ve been granted access', 'private'],
    ['ERROR: This video is available to this channel\'s members-only', 'private'],
    ['ERROR: Join this channel to get access to members-only content', 'private'],
    ['ERROR: Postprocessing: ffprobe and ffmpeg not found. Please install', 'ffmpeg_missing'],
    ['ERROR: ffmpeg not found', 'ffmpeg_missing'],
    ['ERROR: unable to download video data: HTTP Error 403: Forbidden', 'http_403'],
    ['ERROR: [youtube] x: Video unavailable', 'unavailable'],
    ['ERROR: [youtube] aaaaaaaaaaa: This video is unavailable', 'unavailable'],
    ['ERROR: [youtube] x: Unable to download webpage: <urlopen error>', 'network'],
    ['ERROR: Temporary failure in name resolution', 'network'],
    ['ERROR: Read timed out.', 'network'],
    ['ERROR: something else', 'unknown'],
  ])('%s → %s', (line, kind) => expect(classifyLine(line)).toBe(kind));
});

describe('classifyStderr', () => {
  it('prefers the last known error and returns its line', () => {
    expect(
      classifyStderr(['WARNING: Unable to download webpage (retrying)', 'ERROR: HTTP Error 403: Forbidden', '']),
    ).toEqual({ code: 'http_403', detail: 'ERROR: HTTP Error 403: Forbidden' });
  });

  it('falls back to the last ERROR line, then the last line', () => {
    expect(classifyStderr(['ERROR: weird', 'some trailer'])).toEqual({ code: 'unknown', detail: 'ERROR: weird' });
    expect(classifyStderr(['a', 'b'])).toEqual({ code: 'unknown', detail: 'b' });
    expect(classifyStderr([])).toEqual({ code: 'unknown', detail: null });
  });
});

describe('errorFromUnknown', () => {
  it('shows the tested path for sidecar_missing', () => {
    expect(
      errorFromUnknown({ code: 'sidecar_missing', message: 'yt-dlp not found', detail: ['/opt/offbeat/yt-dlp'] }),
    ).toEqual({ code: 'sidecar_missing', detail: '/opt/offbeat/yt-dlp' });
  });

  it('classifies ytdlp_failed stderr', () => {
    expect(
      errorFromUnknown({ code: 'ytdlp_failed', message: 'failed', detail: ['ERROR: x: Video unavailable'] }),
    ).toEqual({ code: 'unavailable', detail: 'ERROR: x: Video unavailable' });
    expect(errorFromUnknown({ code: 'ytdlp_failed', message: 'failed', detail: [] })).toEqual({
      code: 'ytdlp_failed',
      detail: 'failed',
    });
  });

  it('keeps other AppError codes and handles non-AppErrors', () => {
    expect(errorFromUnknown({ code: 'invalid_url', message: 'bad url', detail: [] })).toEqual({
      code: 'invalid_url',
      detail: 'bad url',
    });
    expect(errorFromUnknown('boom')).toEqual({ code: 'unknown', detail: 'boom' });
    expect(errorFromUnknown(new Error('x'))).toEqual({ code: 'unknown', detail: 'x' });
    expect(errorFromUnknown(42)).toEqual({ code: 'unknown', detail: null });
  });

  it('maps every kind to an existing message', () => {
    for (const key of Object.values(ERROR_MESSAGE)) expect(ptBR[key]).toBeTypeOf('string');
  });
});
