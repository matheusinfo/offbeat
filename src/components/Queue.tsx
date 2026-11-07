import { AlertCircle, Check, Download, Loader2, Music, RotateCcw, X } from 'lucide-react';
import type { Translate } from '../i18n';
import { useI18n } from '../i18n';
import type { Lang } from '../lib/api';
import { formatDuration, formatIndex, formatPercent, formatSpeed } from '../lib/format';
import { isFinished, isRunning, summarize, type QueueItem, type QueueState } from '../lib/queue';
import { ErrorNote } from './ErrorNote';

interface Props {
  queue: QueueState;
  onCancel: (id: string) => void;
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
  onCancelAll: () => void;
  onClearFinished: () => void;
}

export function Queue({ queue, onCancel, onRemove, onRetry, onCancelAll, onClearFinished }: Props) {
  const { t } = useI18n();
  const summary = summarize(queue);
  const hasPending = summary.running + summary.queued > 0;
  const hasFinished = queue.items.some(isFinished);

  const parts: string[] = [];
  if (summary.running > 0) parts.push(t('queue.running', { count: summary.running }));
  if (summary.queued > 0) parts.push(t('queue.queued', { count: summary.queued }));
  if (summary.done > 0) parts.push(t('queue.done', { count: summary.done }));
  if (summary.failed > 0) parts.push(t('queue.failed', { count: summary.failed }));

  return (
    <section className="queue" aria-labelledby="queue-title">
      <div className="queue__header">
        <h2 id="queue-title" className="section-title">
          {t('queue.title')}
        </h2>
        <p className="queue__summary muted" aria-live="polite">
          {parts.join(' · ')}
        </p>
      </div>

      {queue.items.length === 0 ? (
        <p className="queue__empty muted">{t('queue.empty')}</p>
      ) : (
        <>
          <ul className="queue__list">
            {queue.items.map((item) => (
              <QueueRow key={item.id} item={item} onCancel={onCancel} onRemove={onRemove} onRetry={onRetry} />
            ))}
          </ul>
          <div className="queue__actions">
            {hasFinished && (
              <button type="button" className="btn btn--ghost" onClick={onClearFinished}>
                {t('queue.clearFinished')}
              </button>
            )}
            {hasPending && (
              <button type="button" className="btn btn--ghost btn--danger" onClick={onCancelAll}>
                {t('queue.cancelAll')}
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

interface RowProps {
  item: QueueItem;
  onCancel: (id: string) => void;
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
}

function QueueRow({ item, onCancel, onRemove, onRetry }: RowProps) {
  const { t, lang } = useI18n();
  const running = isRunning(item);
  const title = item.index !== null ? `${formatIndex(item.index)} · ${item.title}` : item.title;
  const showBar = running || item.status === 'done';
  const percent = item.progress !== null ? Math.round(item.progress * 100) : null;

  return (
    <li className={`queue-item queue-item--${item.status}`}>
      <span className="queue-item__icon" aria-hidden="true">
        <StatusIcon item={item} />
      </span>
      <div className="queue-item__body">
        <p className="queue-item__title" title={item.title}>
          {title}
        </p>
        {showBar && (
          <div
            className={`progress${percent === null ? ' progress--indeterminate' : ''}`}
            role="progressbar"
            aria-label={t('queue.progressOf', { title: item.title })}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent ?? undefined}
          >
            <div className="progress__fill" style={{ width: `${percent ?? 100}%` }} />
          </div>
        )}
        <p className="queue-item__status muted">{statusText(item, t, lang)}</p>
        {item.status === 'error' && item.error && <ErrorNote error={item.error} />}
      </div>
      <div className="queue-item__actions">
        {(item.status === 'error' || item.status === 'canceled') && (
          <button
            type="button"
            className="icon-btn"
            onClick={() => onRetry(item.id)}
            aria-label={t('queue.retryItem', { title: item.title })}
            title={t('queue.retryItem', { title: item.title })}
          >
            <RotateCcw size={16} aria-hidden="true" />
          </button>
        )}
        {isFinished(item) ? (
          <button
            type="button"
            className="icon-btn"
            onClick={() => onRemove(item.id)}
            aria-label={t('queue.removeItem', { title: item.title })}
            title={t('queue.removeItem', { title: item.title })}
          >
            <X size={16} aria-hidden="true" />
          </button>
        ) : (
          <button
            type="button"
            className="icon-btn"
            onClick={() => onCancel(item.id)}
            disabled={item.cancelRequested}
            aria-label={t('queue.cancelItem', { title: item.title })}
            title={t('queue.cancelItem', { title: item.title })}
          >
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </div>
    </li>
  );
}

function StatusIcon({ item }: { item: QueueItem }) {
  switch (item.status) {
    case 'queued':
      return <Music size={18} />;
    case 'downloading':
      return <Download size={18} />;
    case 'converting':
      return <Loader2 size={18} className="spin" />;
    case 'done':
      return <Check size={18} />;
    case 'error':
      return <AlertCircle size={18} />;
    case 'canceled':
      return <X size={18} />;
  }
}

function statusText(item: QueueItem, t: Translate, lang: Lang): string {
  if (item.cancelRequested) return t('status.canceling');
  switch (item.status) {
    case 'downloading': {
      if (item.progress === null) return t('status.starting');
      const parts = [`${t('status.downloading')} ${formatPercent(item.progress, lang)}`];
      if (item.speed !== null) parts.push(formatSpeed(item.speed, lang));
      if (item.eta !== null) parts.push(t('queue.eta', { eta: formatDuration(item.eta) }));
      return parts.join(' · ');
    }
    case 'done':
      return item.filepath ? `${t('status.done')} · ${basename(item.filepath)}` : t('status.done');
    default:
      return t(`status.${item.status}` as const);
  }
}

function basename(path: string): string {
  return path.split('/').pop() ?? path;
}
