// Previews of the pasted links as a pure reducer. Requests to the backend
// live in App.tsx; this module only tracks each link's state and turns a
// preview into queue items.

import type { Preview } from './api';
import type { ItemError } from './errors';
import type { NewItem } from './queue';
import { focusedVideoId } from './ytdlp';

export type Slot =
  | { key: string; url: string; state: 'loading' }
  /** split: download a video with chapters as one track per chapter. */
  | { key: string; url: string; state: 'ok'; preview: Preview; split: boolean }
  | { key: string; url: string; state: 'error'; error: ItemError };

export interface PreviewsState {
  /** Bumped on every new paste, so answers for an older paste are dropped. */
  batch: number;
  slots: Slot[];
}

export type PreviewsAction =
  | { type: 'start'; batch: number; urls: string[] }
  | { type: 'resolved'; batch: number; key: string; preview: Preview }
  | { type: 'failed'; batch: number; key: string; error: ItemError }
  | { type: 'remove'; key: string }
  | { type: 'split'; key: string; split: boolean }
  | { type: 'clear'; batch: number };

export const initialPreviews: PreviewsState = { batch: 0, slots: [] };

/** The slot key is the link itself: parseLinks already removed duplicates. */
export function previewsReducer(state: PreviewsState, action: PreviewsAction): PreviewsState {
  switch (action.type) {
    case 'start':
      return {
        batch: action.batch,
        slots: action.urls.map((url) => ({ key: url, url, state: 'loading' })),
      };
    case 'resolved':
    case 'failed': {
      if (action.batch !== state.batch) return state;
      const slots = state.slots.map((slot): Slot => {
        if (slot.key !== action.key || slot.state !== 'loading') return slot;
        return action.type === 'resolved'
          ? { key: slot.key, url: slot.url, state: 'ok', preview: action.preview, split: false }
          : { key: slot.key, url: slot.url, state: 'error', error: action.error };
      });
      return { ...state, slots };
    }
    case 'remove': {
      const slots = state.slots.filter((s) => s.key !== action.key);
      return slots.length === state.slots.length ? state : { ...state, slots };
    }
    case 'split':
      return {
        ...state,
        slots: state.slots.map((s) =>
          s.key === action.key && s.state === 'ok' && canSplit(s.preview) ? { ...s, split: action.split } : s,
        ),
      };
    case 'clear':
      return { batch: action.batch, slots: [] };
  }
}

export type ReadySlot = Extract<Slot, { state: 'ok' }>;

export function readySlots(state: PreviewsState): ReadySlot[] {
  return state.slots.filter((s): s is ReadySlot => s.state === 'ok');
}

export function canSplit(preview: Preview): boolean {
  return preview.kind === 'video' && preview.chapters.length >= 2;
}

export function isLoading(state: PreviewsState): boolean {
  return state.slots.some((s) => s.state === 'loading');
}

export interface ItemsOptions {
  /** One item per chapter, for a video that has them. */
  split?: boolean;
  /** Leave out songs already in the history (sync). Chapters are never left out. */
  onlyNew?: boolean;
}

/**
 * Queue items for a preview: one per playlist track, numbered by position.
 * A video split by chapters gives one numbered item per chapter. Songs in
 * the history that are queued anyway are forced ("download again").
 */
export function itemsFor(preview: Preview, newId: () => string, opts: ItemsOptions = {}): NewItem[] {
  if (preview.kind === 'video') {
    if (opts.split && canSplit(preview)) {
      return preview.chapters.map((c, i) => ({
        id: newId(),
        url: preview.url,
        title: c.title,
        index: i + 1,
        section: c,
      }));
    }
    const downloaded = preview.entries[0]?.downloaded ?? false;
    if (downloaded && opts.onlyNew) return [];
    return [{ id: newId(), url: preview.url, title: preview.title, index: null, force: downloaded }];
  }
  return preview.entries.flatMap((e, i) =>
    e.downloaded && opts.onlyNew
      ? []
      : [{ id: newId(), url: e.url, title: e.title, index: i + 1, force: e.downloaded }],
  );
}

/** Songs of a preview already in the history (chapters don't count). */
export function downloadedCount(preview: Preview): number {
  return preview.entries.filter((e) => e.downloaded).length;
}

/** The single track a list link was opened on, as a queue item without a number. */
export function focusedItem(preview: Preview, sourceUrl: string, newId: () => string): NewItem | null {
  if (preview.kind !== 'playlist') return null;
  const id = focusedVideoId(sourceUrl);
  const entry = id === null ? undefined : preview.entries.find((e) => e.id === id);
  return entry ? { id: newId(), url: entry.url, title: entry.title, index: null, force: entry.downloaded } : null;
}

export function trackCount(preview: Preview, opts: ItemsOptions = {}): number {
  return itemsFor(preview, () => '', opts).length;
}
