// Previews of the pasted links as a pure reducer. Requests to the backend
// live in App.tsx; this module only tracks each link's state and turns a
// preview into queue items.

import type { Preview } from './api';
import type { ItemError } from './errors';
import type { NewItem } from './queue';
import { focusedVideoId } from './ytdlp';

export type Slot =
  | { key: string; url: string; state: 'loading' }
  | { key: string; url: string; state: 'ok'; preview: Preview }
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
          ? { key: slot.key, url: slot.url, state: 'ok', preview: action.preview }
          : { key: slot.key, url: slot.url, state: 'error', error: action.error };
      });
      return { ...state, slots };
    }
    case 'remove': {
      const slots = state.slots.filter((s) => s.key !== action.key);
      return slots.length === state.slots.length ? state : { ...state, slots };
    }
    case 'clear':
      return { batch: action.batch, slots: [] };
  }
}

export function readyPreviews(state: PreviewsState): Preview[] {
  return state.slots.flatMap((s) => (s.state === 'ok' ? [s.preview] : []));
}

export function isLoading(state: PreviewsState): boolean {
  return state.slots.some((s) => s.state === 'loading');
}

/** Queue items for a preview: one per playlist track, numbered by position. */
export function itemsFor(preview: Preview, newId: () => string): NewItem[] {
  if (preview.kind === 'video') {
    return [{ id: newId(), url: preview.url, title: preview.title, index: null }];
  }
  return preview.entries.map((e, i) => ({ id: newId(), url: e.url, title: e.title, index: i + 1 }));
}

/** The single track a list link was opened on, as a queue item without a number. */
export function focusedItem(preview: Preview, sourceUrl: string, newId: () => string): NewItem | null {
  if (preview.kind !== 'playlist') return null;
  const id = focusedVideoId(sourceUrl);
  const entry = id === null ? undefined : preview.entries.find((e) => e.id === id);
  return entry ? { id: newId(), url: entry.url, title: entry.title, index: null } : null;
}

export function trackCount(preview: Preview): number {
  return preview.kind === 'video' ? 1 : preview.entries.length;
}
