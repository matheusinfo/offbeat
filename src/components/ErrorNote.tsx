import { AlertCircle } from 'lucide-react';
import { useI18n } from '../i18n';
import { ERROR_MESSAGE, type ItemError } from '../lib/errors';

/** Translated error with the raw yt-dlp line (or tested path) under "Details". */
export function ErrorNote({ error, id }: { error: ItemError; id?: string }) {
  const { t } = useI18n();
  return (
    <div className="error-note" id={id}>
      <p className="error-note__message">
        <AlertCircle size={16} aria-hidden="true" />
        <span>{t(ERROR_MESSAGE[error.code])}</span>
      </p>
      {error.detail && (
        <details className="error-note__details">
          <summary>{t('app.details')}</summary>
          <pre>{error.detail}</pre>
        </details>
      )}
    </div>
  );
}
