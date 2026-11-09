import { describe, expect, it } from 'vitest';
import type { DownloadOutcome } from '../src/lib/api';
import {
  initialQueue,
  isIdleWithResults,
  queueReducer,
  selectStartable,
  summarize,
  type QueueAction,
  type QueueState,
} from '../src/lib/queue';

function run(actions: QueueAction[], state: QueueState = initialQueue): QueueState {
  return actions.reduce(queueReducer, state);
}

const add = (...ids: string[]): QueueAction => ({
  type: 'add',
  items: ids.map((id, i) => ({ id, url: `https://youtu.be/${id}`, title: `Song ${id}`, index: i + 1 })),
});

const outcome = (status: DownloadOutcome['status'], stderr: string[] = []): DownloadOutcome => ({
  status,
  exitCode: status === 'success' ? 0 : 1,
  stderr,
});

const item = (s: QueueState, id: string) => {
  const found = s.items.find((i) => i.id === id);
  if (!found) throw new Error(`no item ${id}`);
  return found;
};

describe('queue reducer', () => {
  it('adds items as queued and ignores duplicate ids', () => {
    const s = run([add('a', 'b'), add('a')]);
    expect(s.items.map((i) => [i.id, i.status, i.index])).toEqual([
      ['a', 'queued', 1],
      ['b', 'queued', 2],
    ]);
    expect(item(s, 'a').section).toBeNull();
    const section = { title: 'Intro', start: 0, end: 60 };
    const withSection = run([{ type: 'add', items: [{ id: 'c', url: 'u', title: 'Intro', index: 1, section }] }]);
    expect(item(withSection, 'c').section).toEqual(section);
  });

  it('starts at most 2 at a time, in order', () => {
    let s = run([add('a', 'b', 'c')]);
    expect(selectStartable(s).map((i) => i.id)).toEqual(['a', 'b']);
    s = run([{ type: 'start', id: 'a' }, { type: 'start', id: 'b' }], s);
    expect(selectStartable(s)).toEqual([]);
    expect(item(s, 'a')).toMatchObject({ status: 'downloading', attempt: 1 });
    s = run([{ type: 'finished', id: 'a', attempt: 1, outcome: outcome('success') }], s);
    expect(selectStartable(s).map((i) => i.id)).toEqual(['c']);
  });

  it('tracks progress, converting and done', () => {
    let s = run([add('a'), { type: 'start', id: 'a' }]);
    s = run(
      [
        {
          type: 'lines',
          updates: [
            {
              id: 'a',
              attempt: 1,
              event: { type: 'progress', downloaded: 5, total: 10, speed: 100, eta: 3, status: 'downloading', fraction: 0.5 },
            },
          ],
        },
      ],
      s,
    );
    expect(item(s, 'a')).toMatchObject({ progress: 0.5, speed: 100, eta: 3 });

    s = run(
      [{ type: 'lines', updates: [{ id: 'a', attempt: 1, event: { type: 'postprocess', name: 'ExtractAudio', status: 'started' } }] }],
      s,
    );
    expect(item(s, 'a')).toMatchObject({ status: 'converting', progress: 1, speed: null, eta: null });

    // A late download line must not move a converting item back.
    s = run(
      [
        {
          type: 'lines',
          updates: [
            { id: 'a', attempt: 1, event: { type: 'progress', downloaded: 1, total: 10, speed: 1, eta: 1, status: null, fraction: 0.1 } },
            { id: 'a', attempt: 1, event: { type: 'done', filepath: '/m/Song a.m4a' } },
          ],
        },
      ],
      s,
    );
    expect(item(s, 'a')).toMatchObject({ status: 'converting', progress: 1, filepath: '/m/Song a.m4a' });

    s = run([{ type: 'finished', id: 'a', attempt: 1, outcome: outcome('success') }], s);
    expect(item(s, 'a')).toMatchObject({ status: 'done', progress: 1, filepath: '/m/Song a.m4a' });
    expect(isIdleWithResults(s)).toBe(true);
  });

  it('records a DONE path that arrives after success', () => {
    let s = run([add('a'), { type: 'start', id: 'a' }, { type: 'finished', id: 'a', attempt: 1, outcome: outcome('success') }]);
    s = run([{ type: 'lines', updates: [{ id: 'a', attempt: 1, event: { type: 'done', filepath: '/x.mp3' } }] }], s);
    expect(item(s, 'a').filepath).toBe('/x.mp3');
  });

  it('classifies failed outcomes and rejected promises', () => {
    let s = run([add('a', 'b'), { type: 'start', id: 'a' }, { type: 'start', id: 'b' }]);
    s = run(
      [
        { type: 'finished', id: 'a', attempt: 1, outcome: outcome('failed', ['ERROR: HTTP Error 403: Forbidden']) },
        { type: 'failed', id: 'b', attempt: 1, error: { code: 'sidecar_missing', detail: '/bin/yt-dlp' } },
      ],
      s,
    );
    expect(item(s, 'a')).toMatchObject({ status: 'error', error: { code: 'http_403' } });
    expect(item(s, 'b')).toMatchObject({ status: 'error', error: { code: 'sidecar_missing', detail: '/bin/yt-dlp' } });
  });

  it('cancels queued items at once and running items when the process ends', () => {
    let s = run([add('a', 'b', 'c'), { type: 'start', id: 'a' }, { type: 'start', id: 'b' }]);
    s = run([{ type: 'cancel', id: 'c' }, { type: 'cancel', id: 'a' }], s);
    expect(item(s, 'c').status).toBe('canceled');
    expect(item(s, 'a')).toMatchObject({ status: 'downloading', cancelRequested: true });
    // Still holds its slot until the backend confirms.
    expect(selectStartable(s)).toEqual([]);

    s = run([{ type: 'finished', id: 'a', attempt: 1, outcome: outcome('canceled') }], s);
    expect(item(s, 'a')).toMatchObject({ status: 'canceled', cancelRequested: false });
  });

  it('treats a failure after a cancel request as canceled', () => {
    let s = run([add('a'), { type: 'start', id: 'a' }, { type: 'cancel', id: 'a' }]);
    s = run([{ type: 'finished', id: 'a', attempt: 1, outcome: outcome('failed', ['ERROR: killed']) }], s);
    expect(item(s, 'a')).toMatchObject({ status: 'canceled', error: null });
  });

  it('cancel all', () => {
    let s = run([add('a', 'b', 'c'), { type: 'start', id: 'a' }, { type: 'cancelAll' }]);
    expect(s.items.map((i) => [i.status, i.cancelRequested])).toEqual([
      ['downloading', true],
      ['canceled', false],
      ['canceled', false],
    ]);
    expect(summarize(s)).toEqual({ queued: 0, running: 1, done: 0, skipped: 0, failed: 0, canceled: 2 });
  });

  it('retries with a new attempt and ignores events from the old one', () => {
    let s = run([
      add('a'),
      { type: 'start', id: 'a' },
      { type: 'finished', id: 'a', attempt: 1, outcome: outcome('failed', ['ERROR: x']) },
      { type: 'retry', id: 'a' },
    ]);
    expect(item(s, 'a')).toMatchObject({ status: 'queued', error: null, progress: null });
    s = run([{ type: 'start', id: 'a' }], s);
    expect(item(s, 'a').attempt).toBe(2);

    const stale = run(
      [
        { type: 'finished', id: 'a', attempt: 1, outcome: outcome('success') },
        { type: 'lines', updates: [{ id: 'a', attempt: 1, event: { type: 'done', filepath: '/old' } }] },
      ],
      s,
    );
    expect(stale).toBe(s);
  });

  it('does not retry done items or start non-queued ones', () => {
    const s = run([add('a'), { type: 'start', id: 'a' }, { type: 'finished', id: 'a', attempt: 1, outcome: outcome('success') }]);
    expect(run([{ type: 'retry', id: 'a' }, { type: 'start', id: 'a' }], s)).toBe(s);
  });

  it('removes and clears only finished items', () => {
    let s = run([
      add('a', 'b', 'c', 'd'),
      { type: 'start', id: 'a' },
      { type: 'start', id: 'b' },
      { type: 'finished', id: 'a', attempt: 1, outcome: outcome('success') },
      { type: 'cancel', id: 'd' },
    ]);
    expect(run([{ type: 'remove', id: 'b' }], s)).toBe(s);
    s = run([{ type: 'clearFinished' }], s);
    expect(s.items.map((i) => i.id)).toEqual(['b', 'c']);
    expect(isIdleWithResults(s)).toBe(false);
  });
});

describe('skipped songs', () => {
  it('marks a song the history skipped and downloads it again on retry', () => {
    let s = run([add('a'), { type: 'start', id: 'a' }]);
    s = run([{ type: 'finished', id: 'a', attempt: 1, outcome: outcome('skipped') }], s);
    expect(item(s, 'a')).toMatchObject({ status: 'skipped', force: false });
    expect(summarize(s)).toMatchObject({ skipped: 1, done: 0 });
    expect(selectStartable(s)).toEqual([]);
    s = run([{ type: 'retry', id: 'a' }], s);
    expect(item(s, 'a')).toMatchObject({ status: 'queued', force: true });
  });
});
