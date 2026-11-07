import { readText } from '@tauri-apps/plugin-clipboard-manager';
import { Loader2, Search } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { useI18n } from '../i18n';
import type { ItemError } from '../lib/errors';
import { parseSupportedUrl } from '../lib/ytdlp';
import { ErrorNote } from './ErrorNote';

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (url: string) => void;
  loading: boolean;
  /** Error from the last preview request. */
  error: ItemError | null;
}

export function UrlInput({ value, onChange, onSubmit, loading, error }: Props) {
  const { t } = useI18n();
  const inputId = useId();
  const hintId = useId();
  const [invalid, setInvalid] = useState(false);

  // Paste a YouTube link from the clipboard when focusing an empty field.
  async function handleFocus() {
    if (value !== '') return;
    try {
      const text = await readText();
      const url = parseSupportedUrl(text);
      if (url) {
        onChange(url);
        setInvalid(false);
      }
    } catch {
      // Empty or non-text clipboard: nothing to paste.
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;
    const url = parseSupportedUrl(value);
    if (!url) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onSubmit(url);
  }

  const describedBy = invalid || error ? hintId : undefined;

  return (
    <form className="url-input" onSubmit={handleSubmit} noValidate>
      <label htmlFor={inputId} className="field-label">
        {t('url.label')}
      </label>
      <div className="url-input__row">
        <input
          id={inputId}
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder={t('url.placeholder')}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            if (invalid) setInvalid(false);
          }}
          onFocus={() => void handleFocus()}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
        />
        <button type="submit" className="btn btn--primary" disabled={loading}>
          {loading ? (
            <Loader2 size={16} className="spin" aria-hidden="true" />
          ) : (
            <Search size={16} aria-hidden="true" />
          )}
          <span>{t('url.submit')}</span>
        </button>
      </div>
      <div aria-live="polite" className="url-input__status">
        {loading && <p className="muted">{t('url.loading')}</p>}
        {invalid && (
          <p className="field-error" id={hintId}>
            {t('url.invalid')}
          </p>
        )}
        {!invalid && error && <ErrorNote error={error} id={hintId} />}
      </div>
    </form>
  );
}
