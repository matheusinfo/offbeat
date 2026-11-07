import { Download, ListMusic, Music, X } from 'lucide-react';
import { useI18n } from '../i18n';
import type { Preview as PreviewData, Profile } from '../lib/api';
import { formatBytes, formatDuration, formatIndex } from '../lib/format';
import { estimateEntries } from '../lib/ytdlp';

interface Props {
  preview: PreviewData;
  profile: Profile;
  onDownload: () => void;
  onClear: () => void;
}

// The CSP only allows covers from i.ytimg.com; anything else would just break.
function safeThumbnail(url: string | null): string | null {
  return url !== null && url.startsWith('https://i.ytimg.com/') ? url : null;
}

export function Preview({ preview, profile, onDownload, onClear }: Props) {
  const { t, lang } = useI18n();
  const thumbnail = safeThumbnail(preview.thumbnail);
  const isPlaylist = preview.kind === 'playlist';
  const count = preview.entries.length;
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
                {entry.duration !== null && <span className="muted">{formatDuration(entry.duration)}</span>}
              </li>
            ))}
          </ol>
        </details>
      )}
      {isPlaylist && count === 0 && <p className="muted">{t('preview.emptyPlaylist')}</p>}

      <div className="preview__actions">
        <button type="button" className="btn" onClick={onClear}>
          <X size={16} aria-hidden="true" />
          <span>{t('preview.clear')}</span>
        </button>
        <button type="button" className="btn btn--primary" onClick={onDownload} disabled={count === 0}>
          <Download size={16} aria-hidden="true" />
          <span>{isPlaylist && count > 1 ? t('preview.downloadMany', { count }) : t('preview.download')}</span>
        </button>
      </div>
    </section>
  );
}
