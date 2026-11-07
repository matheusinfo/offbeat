import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import type { Lang } from '../lib/api';
import { createTranslator, resolveLang, type Translate } from './translate';

export type { MessageKey } from './pt-BR';
export type { Translate } from './translate';

interface I18nValue {
  t: Translate;
  lang: Lang;
}

const I18nContext = createContext<I18nValue | null>(null);

export function systemLanguage(): string | undefined {
  return typeof navigator === 'undefined' ? undefined : navigator.language;
}

export function I18nProvider({ language, children }: { language: Lang | null; children: ReactNode }) {
  const lang = resolveLang(language, systemLanguage());
  const value = useMemo<I18nValue>(() => ({ lang, t: createTranslator(lang) }), [lang]);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside I18nProvider');
  return value;
}
