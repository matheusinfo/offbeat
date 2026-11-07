import { open } from '@tauri-apps/plugin-dialog';
import { FolderOpen, Loader2, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useI18n } from '../i18n';
import {
  api,
  isAppError,
  type FilenamePattern,
  type Lang,
  type Profile,
  type Settings as SettingsData,
  type ToolVersions,
} from '../lib/api';

interface Props {
  settings: SettingsData;
  onClose: () => void;
  onSaved: (settings: SettingsData) => void;
}

const PROFILES: Profile[] = ['original', 'balanced', 'economy'];
const PATTERNS: FilenamePattern[] = ['title', 'artist-title'];

type Versions = { state: 'loading' } | { state: 'failed' } | { state: 'ok'; value: ToolVersions };

/** Mounted only while open; the native <dialog> gives focus trapping and Esc. */
export function Settings({ settings, onClose, onSaved }: Props) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const dirId = useId();
  const [draft, setDraft] = useState<SettingsData>(settings);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string[] | null>(null);
  const [versions, setVersions] = useState<Versions>({ state: 'loading' });

  // No close() on cleanup: it fires an async "close" event, and under
  // StrictMode (mount, unmount, mount) that event lands after the remount and
  // calls onClose, so the modal shut itself as soon as it opened. Unmounting
  // removes the dialog from the page, which already ends the modal state.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  useEffect(() => {
    let alive = true;
    api
      .toolVersions()
      .then((value) => alive && setVersions({ state: 'ok', value }))
      .catch(() => alive && setVersions({ state: 'failed' }));
    return () => {
      alive = false;
    };
  }, []);

  function patch(change: Partial<SettingsData>) {
    setDraft((d) => ({ ...d, ...change }));
    setSaveError(null);
  }

  async function chooseFolder() {
    try {
      const dir = await open({ directory: true, multiple: false, defaultPath: draft.outputDir });
      if (typeof dir === 'string') patch({ outputDir: dir });
    } catch {
      setSaveError([t('settings.chooseFailed')]);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await api.saveSettings(draft);
      onSaved(saved);
    } catch (err) {
      // Show the backend's validation message: it names the offending field.
      const lines = isAppError(err) ? [err.message, ...err.detail] : [String(err)];
      setSaveError([t('settings.saveFailed'), ...lines.filter((l) => l !== '')]);
      setSaving(false);
    }
  }

  const notFound = t('settings.notFound');

  return (
    <dialog
      ref={dialogRef}
      className="settings"
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        // A click on the backdrop lands on the dialog element itself.
        if (e.target === dialogRef.current) onClose();
      }}
    >
      <form className="settings__form" onSubmit={handleSubmit}>
        <header className="settings__header">
          <h2 id={titleId}>{t('settings.title')}</h2>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label={t('settings.close')}
            title={t('settings.close')}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="settings__body">
          <div className="field">
            <label className="field-label" htmlFor={dirId}>
              {t('settings.outputDir')}
            </label>
            <div className="settings__dir">
              <input id={dirId} type="text" value={draft.outputDir} readOnly title={draft.outputDir} />
              <button type="button" className="btn" onClick={() => void chooseFolder()}>
                <FolderOpen size={16} aria-hidden="true" />
                <span>{t('settings.choose')}</span>
              </button>
            </div>
          </div>

          <fieldset className="field">
            <legend className="field-label">{t('settings.profile')}</legend>
            <div className="radio-cards">
              {PROFILES.map((p) => (
                <label key={p} className="radio-card">
                  <input
                    type="radio"
                    name="profile"
                    value={p}
                    checked={draft.profile === p}
                    onChange={() => patch({ profile: p })}
                  />
                  <span className="radio-card__text">
                    <span className="radio-card__title">{t(`profile.${p}` as const)}</span>
                    <span className="radio-card__desc">{t(`profile.${p}Desc` as const)}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="field">
            <legend className="field-label">{t('settings.filename')}</legend>
            <div className="radio-row">
              {PATTERNS.map((p) => (
                <label key={p} className="radio-inline">
                  <input
                    type="radio"
                    name="filenamePattern"
                    value={p}
                    checked={draft.filenamePattern === p}
                    onChange={() => patch({ filenamePattern: p })}
                  />
                  <span>{p === 'title' ? t('settings.filenameTitle') : t('settings.filenameArtistTitle')}</span>
                </label>
              ))}
            </div>
            <p className="hint">{t('settings.filenameHint')}</p>
          </fieldset>

          <div className="field">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={draft.sponsorblock}
                onChange={(e) => patch({ sponsorblock: e.target.checked })}
              />
              <span>
                <span className="checkbox__label">{t('settings.sponsorblock')}</span>
                <span className="hint">{t('settings.sponsorblockHint')}</span>
              </span>
            </label>
          </div>

          <fieldset className="field">
            <legend className="field-label">{t('settings.language')}</legend>
            <div className="radio-row">
              {([null, 'pt-BR', 'en-US'] as const).map((lang: Lang | null) => (
                <label key={lang ?? 'system'} className="radio-inline">
                  <input
                    type="radio"
                    name="language"
                    value={lang ?? 'system'}
                    checked={draft.language === lang}
                    onChange={() => patch({ language: lang })}
                  />
                  <span lang={lang ?? undefined}>
                    {lang === null
                      ? t('settings.languageSystem')
                      : lang === 'pt-BR'
                        ? t('settings.languagePt')
                        : t('settings.languageEn')}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="settings__about">
            <h3 className="field-label">{t('settings.about')}</h3>
            <p className="hint">
              {versions.state === 'loading' && t('settings.versionsLoading')}
              {versions.state === 'failed' && t('settings.versionsFailed')}
              {versions.state === 'ok' &&
                t('settings.versions', {
                  ytDlp: versions.value.ytDlp ?? notFound,
                  ffmpeg: versions.value.ffmpeg ?? notFound,
                  deno: versions.value.deno ?? notFound,
                })}
            </p>
          </div>

          <div aria-live="polite">
            {saveError && (
              <div className="field-error settings__error" role="alert">
                {saveError.map((line, i) => (
                  <p key={i}>{line}</p>
                ))}
              </div>
            )}
          </div>
        </div>

        <footer className="settings__footer">
          <button type="button" className="btn" onClick={onClose}>
            {t('settings.cancel')}
          </button>
          <button type="submit" className="btn btn--primary" disabled={saving}>
            {saving && <Loader2 size={16} className="spin" aria-hidden="true" />}
            <span>{saving ? t('settings.saving') : t('settings.save')}</span>
          </button>
        </footer>
      </form>
    </dialog>
  );
}
