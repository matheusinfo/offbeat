// Pure translation helpers, kept apart from the React provider so they can
// be unit-tested in node.

import type { Lang } from '../lib/api';
import { enUS } from './en-US';
import { ptBR, type MessageKey } from './pt-BR';

export type Params = Record<string, string | number>;
export type Translate = (key: MessageKey, params?: Params) => string;

const CATALOGS: Record<Lang, Record<MessageKey, string>> = {
  'pt-BR': ptBR,
  'en-US': enUS,
};

/** Replaces {name} with params.name; unknown placeholders are left as is. */
export function interpolate(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

/** The saved language wins; null follows the system (pt* → pt-BR, else en-US). */
export function resolveLang(setting: Lang | null, systemLanguage: string | undefined): Lang {
  if (setting) return setting;
  return systemLanguage?.toLowerCase().startsWith('pt') ? 'pt-BR' : 'en-US';
}

export function createTranslator(lang: Lang): Translate {
  const catalog = CATALOGS[lang];
  return (key, params) => interpolate(catalog[key], params);
}

export function placeholders(template: string): string[] {
  return [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? '').sort();
}

export { CATALOGS };
