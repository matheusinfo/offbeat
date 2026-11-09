import { ListMusic, Loader2, RefreshCw, X } from 'lucide-react';
import { useI18n } from '../i18n';
import type { SavedPlaylist } from '../lib/api';
import type { ItemError } from '../lib/errors';
import { ErrorNote } from './ErrorNote';

export type SyncState =
  | { state: 'syncing' }
  | { state: 'done'; added: number }
  | { state: 'failed'; error: ItemError };

interface Props {
  playlists: SavedPlaylist[];
  sync: Record<string, SyncState>;
  onSync: (playlist: SavedPlaylist) => void;
  onSyncAll: () => void;
  onRemove: (playlist: SavedPlaylist) => void;
}

/** Playlists saved from a preview; "Sync" queues only their new songs. */
export function SavedPlaylists({ playlists, sync, onSync, onSyncAll, onRemove }: Props) {
  const { t } = useI18n();
  const anySyncing = Object.values(sync).some((s) => s.state === 'syncing');

  return (
    <section className="saved" aria-labelledby="saved-title">
      <div className="saved__header">
        <h2 id="saved-title" className="section-title">
          {t('saved.title')}
        </h2>
        {playlists.length > 1 && (
          <button type="button" className="btn btn--ghost" onClick={onSyncAll} disabled={anySyncing}>
            <RefreshCw size={14} aria-hidden="true" />
            <span>{t('saved.syncAll')}</span>
          </button>
        )}
      </div>
      <ul className="saved__list">
        {playlists.map((p) => {
          const s = sync[p.url];
          return (
            <li key={p.url} className="saved-item">
              <ListMusic size={16} className="saved-item__icon" aria-hidden="true" />
              <div className="saved-item__body">
                <p className="saved-item__title" title={p.title}>
                  {p.title}
                </p>
                <p className="saved-item__status muted" aria-live="polite">
                  {s?.state === 'syncing' && t('saved.syncing')}
                  {s?.state === 'done' &&
                    (s.added === 0
                      ? t('saved.nothingNew')
                      : s.added === 1
                        ? t('saved.addedOne')
                        : t('saved.added', { count: s.added }))}
                </p>
                {s?.state === 'failed' && <ErrorNote error={s.error} />}
              </div>
              <button
                type="button"
                className="btn"
                onClick={() => onSync(p)}
                disabled={s?.state === 'syncing'}
                aria-label={t('saved.syncItem', { title: p.title })}
              >
                {s?.state === 'syncing' ? (
                  <Loader2 size={16} className="spin" aria-hidden="true" />
                ) : (
                  <RefreshCw size={16} aria-hidden="true" />
                )}
                <span>{t('saved.sync')}</span>
              </button>
              <button
                type="button"
                className="icon-btn"
                onClick={() => onRemove(p)}
                aria-label={t('saved.removeItem', { title: p.title })}
                title={t('saved.removeItem', { title: p.title })}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
