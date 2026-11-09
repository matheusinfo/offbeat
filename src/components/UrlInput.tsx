import { readText } from '@tauri-apps/plugin-clipboard-manager';
import { Loader2, Search } from 'lucide-react';
import { useId, useState, type ClipboardEvent, type FormEvent } from 'react';
import { useI18n } from '../i18n';
import type { ItemError } from '../lib/errors';
import { MAX_LINKS, parseLinks } from '../lib/ytdlp';
import { ErrorNote } from './ErrorNote';

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** One or more links, already validated. */
  onSubmit: (urls: string[]) => void;
  loading: boolean;
  /** Error of the preview when a single link was sent. */
  error: ItemError | null;
}

export function UrlInput({ value, onChange, onSubmit, loading, error }: Props) {
  const { t } = useI18n();
  const inputId = useId();
  const hintId = useId();
  const [invalid, setInvalid] = useState<'none' | 'link' | 'tooMany'>('none');

  // Paste YouTube links from the clipboard when focusing an empty field.
  async function handleFocus() {
    if (value !== '') return;
    try {
      const { urls, invalid: words } = parseLinks(await readText());
      if (urls.length > 0 && words.length === 0) {
        onChange(urls.join(' '));
        setInvalid('none');
      }
    } catch {
      // Empty or non-text clipboard: nothing to paste.
    }
  }

  // A single-line input drops line breaks, which would glue a pasted list of
  // links together; paste them separated by spaces instead.
  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('text');
    if (!/[\r\n]/.test(text.trim())) return;
    e.preventDefault();
    const input = e.currentTarget;
    const before = value.slice(0, input.selectionStart ?? value.length);
    const after = value.slice(input.selectionEnd ?? value.length);
    onChange([before, text.trim().split(/\s+/).join(' '), after].filter((s) => s.trim() !== '').join(' '));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;
    const { urls, invalid: words } = parseLinks(value);
    if (urls.length === 0 || words.length > 0) {
      setInvalid('link');
      return;
    }
    if (urls.length > MAX_LINKS) {
      setInvalid('tooMany');
      return;
    }
    setInvalid('none');
    onSubmit(urls);
  }

  const describedBy = invalid !== 'none' || error ? hintId : undefined;

  return (
    <form className="url-input" onSubmit={handleSubmit} noValidate>
      <label htmlFor={inputId} className="field-label">
        {t('url.label')}
      </label>
      <div className="url-input__row">
        <input
          id={inputId}
          type="text"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder={t('url.placeholder')}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            if (invalid !== 'none') setInvalid('none');
          }}
          onPaste={handlePaste}
          onFocus={() => void handleFocus()}
          aria-invalid={invalid !== 'none' || undefined}
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
        {invalid !== 'none' && (
          <p className="field-error" id={hintId}>
            {invalid === 'tooMany' ? t('url.tooMany', { max: MAX_LINKS }) : t('url.invalid')}
          </p>
        )}
        {invalid === 'none' && error && <ErrorNote error={error} id={hintId} />}
      </div>
    </form>
  );
}
