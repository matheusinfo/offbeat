import { describe, expect, it } from 'vitest';
import type { Preview } from '../src/lib/api';
import type { ItemError } from '../src/lib/errors';
import {
  downloadedCount,
  focusedItem,
  initialPreviews,
  isLoading,
  itemsFor,
  previewsReducer,
  readySlots,
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
  entries: [
    { id, url: `https://www.youtube.com/watch?v=${id}`, title: `Song ${id}`, uploader: null, duration: 60, downloaded: false },
  ],
  chapters: [],
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
    downloaded: false,
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
    expect(readySlots(done).map((s) => s.preview.id)).toEqual(['a']);
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

describe('focusedItem', () => {
  const list = playlist('p', 3);
  const id = () => 'x';

  it('picks the track the list link was opened on, without a number', () => {
    expect(focusedItem(list, 'https://music.youtube.com/watch?v=p1&list=OLAK5uy_p', id)).toEqual({
      id: 'x',
      url: 'https://www.youtube.com/watch?v=p1',
      title: 'Track 2',
      index: null,
      force: false,
    });
  });

  it('is null for plain list links, unknown tracks and single videos', () => {
    expect(focusedItem(list, 'https://music.youtube.com/playlist?list=OLAK5uy_p', id)).toBeNull();
    expect(focusedItem(list, 'https://www.youtube.com/watch?v=zz&list=PL1', id)).toBeNull();
    expect(focusedItem(video('v'), 'https://www.youtube.com/watch?v=v&list=PL1', id)).toBeNull();
  });
});

describe('chapters', () => {
  const mix: Preview = {
    ...video('m'),
    title: 'Mix',
    chapters: [
      { title: 'Intro', start: 0, end: 60 },
      { title: 'Song B', start: 60, end: 200 },
    ],
  };
  const id = () => 'x';

  it('splits a video into one numbered item per chapter when asked', () => {
    expect(itemsFor(mix, id, { split: true })).toEqual([
      { id: 'x', url: mix.url, title: 'Intro', index: 1, section: { title: 'Intro', start: 0, end: 60 } },
      { id: 'x', url: mix.url, title: 'Song B', index: 2, section: { title: 'Song B', start: 60, end: 200 } },
    ]);
    expect(trackCount(mix, { split: true })).toBe(2);
    expect(itemsFor(mix, id, { split: false })).toHaveLength(1);
    expect(trackCount(mix, { split: false })).toBe(1);
  });

  it('only lets videos with chapters be split', () => {
    const s = run([
      { type: 'start', batch: 1, urls: ['m', 'v'] },
      { type: 'resolved', batch: 1, key: 'm', preview: mix },
      { type: 'resolved', batch: 1, key: 'v', preview: video('v') },
      { type: 'split', key: 'm', split: true },
      { type: 'split', key: 'v', split: true },
    ]);
    expect(readySlots(s).map((x) => x.split)).toEqual([true, false]);
    expect(itemsFor(video('v'), id, { split: true })).toHaveLength(1);
  });
});

describe('history', () => {
  const id = () => 'x';
  const list = playlist('p', 3);
  const synced: Preview = {
    ...list,
    entries: list.entries.map((e, i) => ({ ...e, downloaded: i !== 1 })),
  };

  it('leaves out downloaded songs only when asked, keeping their positions', () => {
    expect(itemsFor(synced, id, { onlyNew: true }).map((i) => [i.index, i.title, i.force])).toEqual([
      [2, 'Track 2', false],
    ]);
    expect(itemsFor(synced, id).map((i) => i.force)).toEqual([true, false, true]);
    expect(downloadedCount(synced)).toBe(2);
    expect(trackCount(synced, { onlyNew: true })).toBe(1);
  });

  it('forces a downloaded single video unless only new songs are wanted', () => {
    const v: Preview = { ...video('v'), entries: video('v').entries.map((e) => ({ ...e, downloaded: true })) };
    expect(itemsFor(v, id)).toEqual([expect.objectContaining({ force: true, index: null })]);
    expect(itemsFor(v, id, { onlyNew: true })).toEqual([]);
  });
});
