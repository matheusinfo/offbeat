// Download queue as a pure reducer. Side effects (api.download, cancel) live
// in App.tsx; this module only decides what the state becomes and what to
// start next.

import type { Chapter, DownloadOutcome } from './api';
import { classifyStderr, type ItemError } from './errors';
import type { LineEvent } from './progress';

export const MAX_CONCURRENT = 2;

export type ItemStatus = 'queued' | 'downloading' | 'converting' | 'done' | 'skipped' | 'error' | 'canceled';

export interface QueueItem {
  id: string;
  url: string;
  title: string;
  /** 1-based playlist position, or null for a single video. */
  index: number | null;
  /** Chapter of the video this item downloads, or null for the whole video. */
  section: Chapter | null;
  /** Download even if already in the history ("download again"). */
  force: boolean;
  status: ItemStatus;
  /** 0..1, or null while unknown. */
  progress: number | null;
  /** Bytes per second. */
  speed: number | null;
  /** Seconds. */
  eta: number | null;
  filepath: string | null;
  error: ItemError | null;
  /** Bumped on every start, so late events from an older run are ignored. */
  attempt: number;
  /** Cancel was asked for; the item keeps its slot until the process exits. */
  cancelRequested: boolean;
}

export interface QueueState {
  items: QueueItem[];
}

export interface NewItem {
  id: string;
  url: string;
  title: string;
  index: number | null;
  section?: Chapter | null;
  force?: boolean;
}

export interface LineUpdate {
  id: string;
  attempt: number;
  event: LineEvent;
}

export type QueueAction =
  | { type: 'add'; items: NewItem[] }
  | { type: 'start'; id: string }
  | { type: 'lines'; updates: LineUpdate[] }
  | { type: 'finished'; id: string; attempt: number; outcome: DownloadOutcome }
  | { type: 'failed'; id: string; attempt: number; error: ItemError }
  | { type: 'cancel'; id: string }
  | { type: 'cancelAll' }
  | { type: 'remove'; id: string }
  | { type: 'clearFinished' }
  | { type: 'retry'; id: string };

export const initialQueue: QueueState = { items: [] };

export function isRunning(item: QueueItem): boolean {
  return item.status === 'downloading' || item.status === 'converting';
}

export function isFinished(item: QueueItem): boolean {
  return (
    item.status === 'done' || item.status === 'skipped' || item.status === 'error' || item.status === 'canceled'
  );
}

/** Queued items that fit in the free slots, in queue order. */
export function selectStartable(state: QueueState, max = MAX_CONCURRENT): QueueItem[] {
  const free = max - state.items.filter(isRunning).length;
  if (free <= 0) return [];
  return state.items.filter((i) => i.status === 'queued').slice(0, free);
}

export interface QueueSummary {
  queued: number;
  running: number;
  done: number;
  skipped: number;
  failed: number;
  canceled: number;
}

export function summarize(state: QueueState): QueueSummary {
  const s: QueueSummary = { queued: 0, running: 0, done: 0, skipped: 0, failed: 0, canceled: 0 };
  for (const item of state.items) {
    if (item.status === 'queued') s.queued++;
    else if (isRunning(item)) s.running++;
    else if (item.status === 'done') s.done++;
    else if (item.status === 'skipped') s.skipped++;
    else if (item.status === 'error') s.failed++;
    else s.canceled++;
  }
  return s;
}

export function hasPending(s: QueueSummary): boolean {
  return s.running + s.queued > 0;
}

export interface BatchResult {
  done: number;
  failed: number;
  skipped: number;
}

/**
 * What a batch produced, from the summaries when it started (pending went
 * from 0 to more) and when it ended. Items cleared in between can make a
 * difference negative; those count as 0.
 */
export function batchResult(start: QueueSummary, end: QueueSummary): BatchResult {
  return {
    done: Math.max(0, end.done - start.done),
    failed: Math.max(0, end.failed - start.failed),
    skipped: Math.max(0, end.skipped - start.skipped),
  };
}

/** "Open folder" is offered once something finished and nothing is pending. */
export function isIdleWithResults(state: QueueState): boolean {
  const s = summarize(state);
  return s.done > 0 && s.running === 0 && s.queued === 0;
}

function freshRun(item: QueueItem): QueueItem {
  return {
    ...item,
    progress: null,
    speed: null,
    eta: null,
    filepath: null,
    error: null,
    cancelRequested: false,
  };
}

function update(state: QueueState, id: string, fn: (item: QueueItem) => QueueItem): QueueState {
  let changed = false;
  const items = state.items.map((item) => {
    if (item.id !== id) return item;
    const next = fn(item);
    if (next !== item) changed = true;
    return next;
  });
  return changed ? { items } : state;
}

function applyLine(item: QueueItem, event: LineEvent): QueueItem {
  switch (event.type) {
    case 'progress':
      // Once ffmpeg runs, stray download lines must not move the bar back.
      if (item.status !== 'downloading') return item;
      return {
        ...item,
        progress: event.fraction ?? item.progress,
        speed: event.speed,
        eta: event.eta,
      };
    case 'postprocess':
      if (event.status !== 'started' || !isRunning(item)) return item;
      return { ...item, status: 'converting', progress: 1, speed: null, eta: null };
    case 'done':
      // The DONE line may arrive after the command resolved; keep the path anyway.
      if (!isRunning(item) && item.status !== 'done') return item;
      return { ...item, filepath: event.filepath, progress: 1 };
  }
}

export function queueReducer(state: QueueState, action: QueueAction): QueueState {
  switch (action.type) {
    case 'add': {
      const known = new Set(state.items.map((i) => i.id));
      const added: QueueItem[] = action.items
        .filter((n) => !known.has(n.id))
        .map((n) => ({
          ...n,
          section: n.section ?? null,
          force: n.force ?? false,
          status: 'queued',
          progress: null,
          speed: null,
          eta: null,
          filepath: null,
          error: null,
          attempt: 0,
          cancelRequested: false,
        }));
      return added.length === 0 ? state : { items: [...state.items, ...added] };
    }

    case 'start':
      return update(state, action.id, (item) =>
        item.status === 'queued'
          ? { ...freshRun(item), status: 'downloading', attempt: item.attempt + 1 }
          : item,
      );

    case 'lines': {
      if (action.updates.length === 0) return state;
      let next = state;
      for (const u of action.updates) {
        next = update(next, u.id, (item) =>
          item.attempt === u.attempt ? applyLine(item, u.event) : item,
        );
      }
      return next;
    }

    case 'finished':
      return update(state, action.id, (item) => {
        if (item.attempt !== action.attempt || !isRunning(item)) return item;
        const { status, stderr } = action.outcome;
        if (status === 'success') {
          return { ...item, status: 'done', progress: 1, speed: null, eta: null, cancelRequested: false };
        }
        if (status === 'skipped') {
          return { ...item, status: 'skipped', progress: null, speed: null, eta: null, cancelRequested: false };
        }
        if (status === 'canceled' || item.cancelRequested) {
          return { ...item, status: 'canceled', speed: null, eta: null, cancelRequested: false };
        }
        return {
          ...item,
          status: 'error',
          speed: null,
          eta: null,
          error: classifyStderr(stderr),
        };
      });

    case 'failed':
      return update(state, action.id, (item) => {
        if (item.attempt !== action.attempt || !isRunning(item)) return item;
        return item.cancelRequested
          ? { ...item, status: 'canceled', speed: null, eta: null, cancelRequested: false }
          : { ...item, status: 'error', speed: null, eta: null, error: action.error };
      });

    case 'cancel':
      return update(state, action.id, (item) => {
        if (item.status === 'queued') return { ...item, status: 'canceled' };
        if (isRunning(item) && !item.cancelRequested) return { ...item, cancelRequested: true };
        return item;
      });

    case 'cancelAll': {
      let changed = false;
      const items = state.items.map((item): QueueItem => {
        if (item.status === 'queued') {
          changed = true;
          return { ...item, status: 'canceled' };
        }
        if (isRunning(item) && !item.cancelRequested) {
          changed = true;
          return { ...item, cancelRequested: true };
        }
        return item;
      });
      return changed ? { items } : state;
    }

    case 'remove': {
      const items = state.items.filter((i) => !(i.id === action.id && isFinished(i)));
      return items.length === state.items.length ? state : { items };
    }

    case 'clearFinished': {
      const items = state.items.filter((i) => !isFinished(i));
      return items.length === state.items.length ? state : { items };
    }

    case 'retry':
      return update(state, action.id, (item) => {
        if (item.status === 'error' || item.status === 'canceled') return { ...freshRun(item), status: 'queued' };
        // "Download again" for a song the history skipped.
        if (item.status === 'skipped') return { ...freshRun(item), status: 'queued', force: true };
        return item;
      });
  }
}
