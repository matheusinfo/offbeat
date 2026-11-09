import { open } from '@tauri-apps/plugin-dialog';
import { FolderOpen, Loader2, RefreshCw, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useI18n } from '../i18n';
import { errorFromUnknown, type ItemError } from '../lib/errors';
import { ErrorNote } from './ErrorNote';
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
type Update =
  | { state: 'idle' }
  | { state: 'running' }
  | { state: 'done'; updated: boolean; version: string }
  | { state: 'failed'; error: ItemError };
type History = { state: 'loading' } | { state: 'failed' } | { state: 'ok'; count: number; cleared: boolean };

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
  const [history, setHistory] = useState<History>({ state: 'loading' });
  const [update, setUpdate] = useState<Update>({ state: 'idle' });

  // No close() on cleanup: it fires an async "close" event, and under
  // StrictMode (mount, unmount, mount) that event lands after the remount and
  // calls onClose, so the modal shut itself as soon as it opened. Unmounting
  // removes the dialog from the page, which already ends the modal state.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  // Set again on every mount: StrictMode mounts, unmounts and mounts again.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  function loadVersions() {
    api
      .toolVersions()
      .then((value) => alive.current && setVersions({ state: 'ok', value }))
      .catch(() => alive.current && setVersions({ state: 'failed' }));
  }

  useEffect(loadVersions, []);

  async function updateYtdlp() {
    setUpdate({ state: 'running' });
    try {
      const outcome = await api.updateYtdlp();
      if (!alive.current) return;
      setUpdate({ state: 'done', ...outcome });
      loadVersions();
    } catch (e: unknown) {
      if (alive.current) setUpdate({ state: 'failed', error: errorFromUnknown(e) });
    }
  }

  useEffect(() => {
    let alive = true;
    api
      .historyCount()
      .then((count) => alive && setHistory({ state: 'ok', count, cleared: false }))
      .catch(() => alive && setHistory({ state: 'failed' }));
    return () => {
      alive = false;
    };
  }, []);

  // Takes effect at once: the history is not one of the saved settings.
  async function clearHistory() {
    try {
      await api.clearHistory();
      setHistory({ state: 'ok', count: 0, cleared: true });
    } catch {
      setHistory({ state: 'failed' });
    }
  }

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

          <div className="field">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={draft.normalizeVolume && draft.profile !== 'original'}
                disabled={draft.profile === 'original'}
                onChange={(e) => patch({ normalizeVolume: e.target.checked })}
              />
              <span>
                <span className="checkbox__label">{t('settings.normalize')}</span>
                <span className="hint">
                  {draft.profile === 'original' ? t('settings.normalizeOriginal') : t('settings.normalizeHint')}
                </span>
              </span>
            </label>
          </div>

          <div className="field">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={draft.skipDownloaded}
                onChange={(e) => patch({ skipDownloaded: e.target.checked })}
              />
              <span>
                <span className="checkbox__label">{t('settings.skipDownloaded')}</span>
                <span className="hint">{t('settings.skipDownloadedHint')}</span>
              </span>
            </label>
            <div className="settings__history" aria-live="polite">
              <p className="hint">
                {history.state === 'loading' && t('settings.historyLoading')}
                {history.state === 'failed' && t('settings.historyFailed')}
                {history.state === 'ok' &&
                  (history.cleared ? t('settings.historyCleared') : t('settings.historyCount', { count: history.count }))}
              </p>
              {history.state === 'ok' && history.count > 0 && (
                <button type="button" className="btn btn--ghost" onClick={() => void clearHistory()}>
                  {t('settings.historyClear')}
                </button>
              )}
            </div>
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
            <div className="settings__update">
              <button
                type="button"
                className="btn"
                onClick={() => void updateYtdlp()}
                disabled={update.state === 'running'}
              >
                {update.state === 'running' ? (
                  <Loader2 size={16} className="spin" aria-hidden="true" />
                ) : (
                  <RefreshCw size={16} aria-hidden="true" />
                )}
                <span>{update.state === 'running' ? t('settings.updating') : t('settings.update')}</span>
              </button>
              <p className="hint" aria-live="polite">
                {update.state === 'idle' && t('settings.updateHint')}
                {update.state === 'running' && t('settings.updatingHint')}
                {update.state === 'done' &&
                  (update.updated
                    ? t('settings.updated', { version: update.version })
                    : t('settings.upToDate', { version: update.version }))}
              </p>
            </div>
            {update.state === 'failed' && <ErrorNote error={update.error} />}
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
