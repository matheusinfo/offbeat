import { FolderOpen, Loader2, Settings as SettingsIcon } from 'lucide-react';
import { useCallback, useEffect, useReducer, useRef, useState, type Dispatch } from 'react';
import { Preview } from './components/Preview';
import { Queue } from './components/Queue';
import { Settings } from './components/Settings';
import { UrlInput } from './components/UrlInput';
import { I18nProvider, useI18n } from './i18n';
import { api, type Preview as PreviewData, type Settings as SettingsData } from './lib/api';
import { errorFromUnknown, type ItemError } from './lib/errors';
import { formatBytes } from './lib/format';
import { parseLine } from './lib/progress';
import {
  initialQueue,
  isIdleWithResults,
  queueReducer,
  selectStartable,
  summarize,
  type LineUpdate,
  type NewItem,
  type QueueAction,
  type QueueItem,
} from './lib/queue';

type Loaded = { state: 'loading' } | { state: 'failed'; error: ItemError } | { state: 'ok'; settings: SettingsData };

export function App() {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });

  const load = useCallback(() => {
    setLoaded({ state: 'loading' });
    api
      .getSettings()
      .then((settings) => setLoaded({ state: 'ok', settings }))
      .catch((e: unknown) => setLoaded({ state: 'failed', error: errorFromUnknown(e) }));
  }, []);

  useEffect(load, [load]);

  const language = loaded.state === 'ok' ? loaded.settings.language : null;

  return (
    <I18nProvider language={language}>
      {loaded.state === 'ok' ? (
        <Main settings={loaded.settings} onSettingsChange={(settings) => setLoaded({ state: 'ok', settings })} />
      ) : (
        <Startup loaded={loaded} onRetry={load} />
      )}
    </I18nProvider>
  );
}

function Startup({ loaded, onRetry }: { loaded: Loaded; onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <main className="startup" aria-live="polite">
      {loaded.state === 'failed' ? (
        <>
          <p>{t('app.loadFailed')}</p>
          {loaded.error.detail && <pre className="startup__detail">{loaded.error.detail}</pre>}
          <button type="button" className="btn btn--primary" onClick={onRetry}>
            {t('app.retry')}
          </button>
        </>
      ) : (
        <p className="muted">
          <Loader2 size={18} className="spin" aria-hidden="true" /> {t('app.loading')}
        </p>
      )}
    </main>
  );
}

function newId(): string {
  return crypto.randomUUID();
}

function Main({ settings, onSettingsChange }: { settings: SettingsData; onSettingsChange: (s: SettingsData) => void }) {
  const { t, lang } = useI18n();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [url, setUrl] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [previewError, setPreviewError] = useState<ItemError | null>(null);
  // Only the latest preview request may update the screen.
  const previewSeq = useRef(0);

  const [queue, dispatch] = useReducer(queueReducer, initialQueue);
  useDownloadRunner(queue.items, dispatch);

  const [folderSize, setFolderSize] = useState<number | null>(null);
  const [openFailed, setOpenFailed] = useState(false);
  const idleWithResults = isIdleWithResults(queue);
  const doneCount = summarize(queue).done;

  // Folder total: at startup, when the folder changes, and when a batch ends.
  useEffect(() => {
    if (doneCount > 0 && !idleWithResults) return;
    let alive = true;
    api
      .outputDirSize()
      .then((bytes) => alive && setFolderSize(bytes))
      .catch(() => alive && setFolderSize(null));
    return () => {
      alive = false;
    };
  }, [settings.outputDir, idleWithResults, doneCount]);

  function submitPreview(target: string) {
    const seq = ++previewSeq.current;
    setPreviewing(true);
    setPreview(null);
    setPreviewError(null);
    api
      .preview(target)
      .then((p) => seq === previewSeq.current && setPreview(p))
      .catch((e: unknown) => seq === previewSeq.current && setPreviewError(errorFromUnknown(e)))
      .finally(() => seq === previewSeq.current && setPreviewing(false));
  }

  function clearPreview() {
    previewSeq.current++;
    setPreview(null);
    setPreviewError(null);
    setPreviewing(false);
    setUrl('');
  }

  function enqueuePreview() {
    if (!preview) return;
    const items: NewItem[] =
      preview.kind === 'playlist'
        ? preview.entries.map((e, i) => ({ id: newId(), url: e.url, title: e.title, index: i + 1 }))
        : [{ id: newId(), url: preview.url, title: preview.title, index: null }];
    dispatch({ type: 'add', items });
    clearPreview();
  }

  async function openFolder() {
    try {
      setOpenFailed(false);
      await api.openOutputDir();
    } catch {
      setOpenFailed(true);
    }
  }

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__name">{t('app.name')}</h1>
        <button
          type="button"
          className="icon-btn"
          onClick={() => setSettingsOpen(true)}
          aria-label={t('header.settings')}
          title={t('header.settings')}
          aria-haspopup="dialog"
        >
          <SettingsIcon size={20} aria-hidden="true" />
        </button>
      </header>

      <main className="app__main">
        <UrlInput
          value={url}
          onChange={setUrl}
          onSubmit={submitPreview}
          loading={previewing}
          error={previewError}
        />
        {preview && (
          <Preview preview={preview} profile={settings.profile} onDownload={enqueuePreview} onClear={clearPreview} />
        )}
        <Queue
          queue={queue}
          onCancel={(id) => dispatch({ type: 'cancel', id })}
          onRemove={(id) => dispatch({ type: 'remove', id })}
          onRetry={(id) => dispatch({ type: 'retry', id })}
          onCancelAll={() => dispatch({ type: 'cancelAll' })}
          onClearFinished={() => dispatch({ type: 'clearFinished' })}
        />
      </main>

      <footer className="app__footer">
        <p className="muted" aria-live="polite">
          {folderSize !== null && t('footer.folder', { size: formatBytes(folderSize, lang) })}
          {openFailed && <span className="field-error"> {t('footer.openFailed')}</span>}
        </p>
        {idleWithResults && (
          <button type="button" className="btn" onClick={() => void openFolder()}>
            <FolderOpen size={16} aria-hidden="true" />
            <span>{t('footer.openFolder')}</span>
          </button>
        )}
      </footer>

      {settingsOpen && (
        <Settings
          settings={settings}
          onClose={() => setSettingsOpen(false)}
          onSaved={(saved) => {
            onSettingsChange(saved);
            setSettingsOpen(false);
          }}
        />
      )}
    </div>
  );
}

/** Starts queued items as slots free up and sends cancels for items marked for it. */
function useDownloadRunner(items: QueueItem[], dispatch: Dispatch<QueueAction>): void {
  // Keys are `${id}#${attempt}`: guards against double starts (StrictMode
  // re-runs effects) while still allowing retries.
  const started = useRef(new Set<string>());
  const cancelSent = useRef(new Set<string>());
  // Cancels the backend didn't find yet (process not registered): resent on the next line.
  const cancelUnconfirmed = useRef(new Set<string>());

  // Progress lines can arrive many times per second; batch them per frame.
  const pending = useRef<LineUpdate[]>([]);
  const frame = useRef<number | null>(null);

  const flush = useCallback(() => {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    const updates = pending.current.splice(0);
    if (updates.length > 0) dispatch({ type: 'lines', updates });
  }, [dispatch]);

  const requestCancel = useCallback((id: string, key: string) => {
    cancelUnconfirmed.current.delete(key);
    api
      .cancelDownload(id)
      .then((found) => {
        if (!found) cancelUnconfirmed.current.add(key);
      })
      .catch(() => cancelUnconfirmed.current.add(key));
  }, []);

  useEffect(() => {
    for (const item of selectStartable({ items })) {
      const attempt = item.attempt + 1;
      const key = `${item.id}#${attempt}`;
      if (started.current.has(key)) continue;
      started.current.add(key);
      dispatch({ type: 'start', id: item.id });

      const { id } = item;
      api
        .download({ id, url: item.url, index: item.index }, ({ line }) => {
          if (cancelUnconfirmed.current.has(key)) requestCancel(id, key);
          const event = parseLine(line);
          if (!event) return;
          pending.current.push({ id, attempt, event });
          frame.current ??= requestAnimationFrame(flush);
        })
        .then((outcome) => {
          flush();
          dispatch({ type: 'finished', id, attempt, outcome });
        })
        .catch((e: unknown) => {
          flush();
          dispatch({ type: 'failed', id, attempt, error: errorFromUnknown(e) });
        })
        .finally(() => cancelUnconfirmed.current.delete(key));
    }

    for (const item of items) {
      if (!item.cancelRequested) continue;
      const key = `${item.id}#${item.attempt}`;
      if (cancelSent.current.has(key)) continue;
      cancelSent.current.add(key);
      requestCancel(item.id, key);
    }
  }, [items, dispatch, flush, requestCancel]);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );
}
