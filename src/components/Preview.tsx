import { Bookmark, BookmarkCheck, Check, Download, ListMusic, Loader2, Music, X } from 'lucide-react';
import { useI18n } from '../i18n';
import type { Preview as PreviewData, Profile } from '../lib/api';
import type { ItemError } from '../lib/errors';
import { ErrorNote } from './ErrorNote';
import { formatBytes, formatDuration, formatIndex } from '../lib/format';
import { canSplit, downloadedCount, trackCount } from '../lib/previews';
import { estimateEntries } from '../lib/ytdlp';

interface Props {
  preview: PreviewData;
  profile: Profile;
  /** Download a video with chapters as one track per chapter. */
  split: boolean;
  onSplitChange: (split: boolean) => void;
  /** The skipDownloaded setting: offer only the new songs first. */
  skipDownloaded: boolean;
  /** onlyNew leaves out songs already in the history. */
  onDownload: (onlyNew: boolean) => void;
  /** Playlists only: whether it is in the saved list (null for a video). */
  saved: boolean | null;
  onToggleSaved: () => void;
  /** Title of the track a list link was opened on (watch?v=…&list=…), if any. */
  focusedTitle: string | null;
  onDownloadFocused: () => void;
  onClear: () => void;
}

// The CSP only allows covers from i.ytimg.com; anything else would just break.
function safeThumbnail(url: string | null): string | null {
  return url !== null && url.startsWith('https://i.ytimg.com/') ? url : null;
}

export function Preview({
  preview,
  profile,
  split,
  onSplitChange,
  skipDownloaded,
  onDownload,
  saved,
  onToggleSaved,
  focusedTitle,
  onDownloadFocused,
  onClear,
}: Props) {
  const { t, lang } = useI18n();
  const thumbnail = safeThumbnail(preview.thumbnail);
  const isPlaylist = preview.kind === 'playlist';
  const splittable = canSplit(preview);
  const chapterCount = preview.chapters.length;
  const splitting = split && splittable;
  const count = trackCount(preview, { split });
  // Chapters ignore the history: they are parts, not songs already saved.
  const downloaded = splitting ? 0 : downloadedCount(preview);
  const newCount = trackCount(preview, { split, onlyNew: true });
  const offerNew = skipDownloaded && downloaded > 0;
  const durations =
    isPlaylist ? preview.entries.map((e) => e.duration) : [preview.duration ?? preview.entries[0]?.duration ?? null];
  const estimate = estimateEntries(durations, profile);
  const profileName = t(`profile.${profile}` as const);

  let sizeText: string;
  if (!estimate) sizeText = t('preview.noEstimate');
  else if (estimate.unknownCount > 0)
    sizeText = t('preview.estimatePartial', {
      size: formatBytes(estimate.bytes, lang),
      profile: profileName,
      count: estimate.unknownCount,
    });
  else sizeText = t('preview.estimate', { size: formatBytes(estimate.bytes, lang), profile: profileName });

  return (
    <section className="card preview" aria-label={t('preview.label')}>
      <div className="preview__main">
        {thumbnail ? (
          <img className="preview__thumb" src={thumbnail} alt="" referrerPolicy="no-referrer" />
        ) : (
          <div className="preview__thumb preview__thumb--empty" aria-hidden="true">
            {isPlaylist ? <ListMusic size={28} /> : <Music size={28} />}
          </div>
        )}
        <div className="preview__info">
          <p className="preview__kind">
            {isPlaylist ? t('preview.playlist') : t('preview.video')}
            {isPlaylist && (
              <> · {count === 1 ? t('preview.trackOne') : t('preview.trackMany', { count })}</>
            )}
            {splittable && <> · {t('preview.chapters', { count: chapterCount })}</>}
          </p>
          <h2 className="preview__title">{preview.title}</h2>
          {preview.uploader && <p className="muted">{preview.uploader}</p>}
          <p className="muted preview__meta">
            {preview.duration !== null && <span>{formatDuration(preview.duration)} · </span>}
            <span>{sizeText}</span>
          </p>
        </div>
      </div>

      {isPlaylist && count > 0 && (
        <details className="preview__tracks">
          <summary>{t('preview.showTracks')}</summary>
          <ol>
            {preview.entries.map((entry, i) => (
              <li key={`${entry.id}-${i}`}>
                <span className="preview__track-index">{formatIndex(i + 1)}</span>
                <span className="preview__track-title">{entry.title}</span>
                {entry.downloaded && (
                  <span className="preview__track-done" title={t('preview.trackDownloaded')}>
                    <Check size={14} aria-hidden="true" />
                    <span className="visually-hidden">{t('preview.trackDownloaded')}</span>
                  </span>
                )}
                {entry.duration !== null && <span className="muted">{formatDuration(entry.duration)}</span>}
              </li>
            ))}
          </ol>
        </details>
      )}
      {splittable && (
        <>
          <label className="checkbox">
            <input type="checkbox" checked={split} onChange={(e) => onSplitChange(e.target.checked)} />
            <span>
              <span className="checkbox__label">{t('preview.split', { count: chapterCount })}</span>
              <span className="hint">{t('preview.splitHint')}</span>
            </span>
          </label>
          <details className="preview__tracks">
            <summary>{t('preview.showChapters')}</summary>
            <ol>
              {preview.chapters.map((chapter, i) => (
                <li key={`${chapter.start}-${i}`}>
                  <span className="preview__track-index">{formatIndex(i + 1)}</span>
                  <span className="preview__track-title">{chapter.title}</span>
                  <span className="muted">{formatDuration(chapter.end - chapter.start)}</span>
                </li>
              ))}
            </ol>
          </details>
        </>
      )}
      {isPlaylist && count === 0 && <p className="muted">{t('preview.emptyPlaylist')}</p>}
      {downloaded > 0 && (
        <p className="preview__history muted">
          {isPlaylist ? t('preview.someDownloaded', { count: downloaded, total: count }) : t('preview.videoDownloaded')}
        </p>
      )}
      {focusedTitle !== null && (
        <p className="preview__focused muted">{t('preview.focusedHint', { title: focusedTitle })}</p>
      )}

      <div className="preview__actions">
        {saved !== null && (
          <button
            type="button"
            className="btn btn--ghost preview__save"
            onClick={onToggleSaved}
            aria-pressed={saved}
            title={saved ? t('preview.savedHint') : t('preview.saveHint')}
          >
            {saved ? <BookmarkCheck size={16} aria-hidden="true" /> : <Bookmark size={16} aria-hidden="true" />}
            <span>{saved ? t('preview.saved') : t('preview.save')}</span>
          </button>
        )}
        <button type="button" className="btn" onClick={onClear}>
          <X size={16} aria-hidden="true" />
          <span>{t('preview.clear')}</span>
        </button>
        {focusedTitle !== null && (
          <button type="button" className="btn" onClick={onDownloadFocused}>
            <Music size={16} aria-hidden="true" />
            <span>{t('preview.downloadFocused')}</span>
          </button>
        )}
        {offerNew && newCount > 0 && (
          <button type="button" className="btn" onClick={() => onDownload(false)}>
            <span>{t('preview.downloadEvery', { count })}</span>
          </button>
        )}
        {offerNew ? (
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => onDownload(newCount > 0)}
          >
            <Download size={16} aria-hidden="true" />
            <span>
              {newCount === 0
                ? count > 1
                  ? t('preview.downloadAgainMany', { count })
                  : t('preview.downloadAgain')
                : newCount === 1
                  ? t('preview.downloadNewOne')
                  : t('preview.downloadNew', { count: newCount })}
            </span>
          </button>
        ) : (
          <button type="button" className="btn btn--primary" onClick={() => onDownload(false)} disabled={count === 0}>
            <Download size={16} aria-hidden="true" />
            <span>{count > 1 ? t('preview.downloadMany', { count }) : t('preview.download')}</span>
          </button>
        )}
      </div>
    </section>
  );
}

/** A pasted link still loading or that failed, shown when several were pasted. */
export function LinkStatus({ url, error, onRemove }: { url: string; error: ItemError | null; onRemove: () => void }) {
  const { t } = useI18n();
  return (
    <section className="card link-status" aria-label={url}>
      <div className="link-status__main">
        {error === null && <Loader2 size={16} className="spin" aria-hidden="true" />}
        <p className="link-status__url" title={url}>
          {error === null ? t('previews.loadingLink', { url }) : url}
        </p>
        <button
          type="button"
          className="icon-btn"
          onClick={onRemove}
          aria-label={t('previews.remove', { url })}
          title={t('previews.remove', { url })}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      {error !== null && <ErrorNote error={error} />}
    </section>
  );
}
