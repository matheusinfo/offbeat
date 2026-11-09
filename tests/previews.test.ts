import { describe, expect, it } from 'vitest';
import type { Preview } from '../src/lib/api';
import type { ItemError } from '../src/lib/errors';
import {
  initialPreviews,
  isLoading,
  itemsFor,
  previewsReducer,
  readyPreviews,
  trackCount,
  type PreviewsAction,
  type PreviewsState,
} from '../src/lib/previews';

const run = (actions: PreviewsAction[], state: PreviewsState = initialPreviews) =>
  actions.reduce(previewsReducer, state);

const video = (id: string): Preview => ({
  kind: 'video',
  id,
  url: `https://www.youtube.com/watch?v=${id}`,
  title: `Song ${id}`,
  uploader: null,
  duration: 60,
  thumbnail: null,
  entries: [{ id, url: `https://www.youtube.com/watch?v=${id}`, title: `Song ${id}`, uploader: null, duration: 60 }],
});

const playlist = (id: string, n: number): Preview => ({
  ...video(id),
  kind: 'playlist',
  title: `List ${id}`,
  entries: Array.from({ length: n }, (_, i) => ({
    id: `${id}${i}`,
    url: `https://www.youtube.com/watch?v=${id}${i}`,
    title: `Track ${i + 1}`,
    uploader: null,
    duration: 60,
  })),
});

const error: ItemError = { code: 'network', detail: null };

describe('previewsReducer', () => {
  it('tracks each link from loading to ready or failed', () => {
    const s = run([
      { type: 'start', batch: 1, urls: ['a', 'b'] },
      { type: 'resolved', batch: 1, key: 'a', preview: video('a') },
    ]);
    expect(isLoading(s)).toBe(true);
    const done = run([{ type: 'failed', batch: 1, key: 'b', error }], s);
    expect(isLoading(done)).toBe(false);
    expect(readyPreviews(done).map((p) => p.id)).toEqual(['a']);
    expect(done.slots[1]).toMatchObject({ state: 'error', error });
  });

  it('drops answers from an older paste', () => {
    const s = run([
      { type: 'start', batch: 1, urls: ['a'] },
      { type: 'start', batch: 2, urls: ['a'] },
      { type: 'resolved', batch: 1, key: 'a', preview: video('old') },
    ]);
    expect(s.slots[0]?.state).toBe('loading');
    const cleared = run([{ type: 'clear', batch: 3 }, { type: 'resolved', batch: 2, key: 'a', preview: video('a') }], s);
    expect(cleared.slots).toEqual([]);
  });

  it('removes one link', () => {
    const s = run([
      { type: 'start', batch: 1, urls: ['a', 'b'] },
      { type: 'remove', key: 'a' },
    ]);
    expect(s.slots.map((x) => x.key)).toEqual(['b']);
  });
});

describe('itemsFor', () => {
  let n = 0;
  const id = () => `id${++n}`;

  it('numbers playlist tracks by position', () => {
    const items = itemsFor(playlist('p', 3), id);
    expect(items.map((i) => [i.index, i.title])).toEqual([
      [1, 'Track 1'],
      [2, 'Track 2'],
      [3, 'Track 3'],
    ]);
    expect(trackCount(playlist('p', 3))).toBe(3);
  });

  it('keeps a single video without a number', () => {
    expect(itemsFor(video('v'), id)).toEqual([
      expect.objectContaining({ url: 'https://www.youtube.com/watch?v=v', index: null }),
    ]);
    expect(trackCount(video('v'))).toBe(1);
  });
});
