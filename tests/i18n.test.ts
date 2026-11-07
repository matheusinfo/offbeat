import { describe, expect, it } from 'vitest';
import { enUS } from '../src/i18n/en-US';
import { ptBR } from '../src/i18n/pt-BR';
import { createTranslator, interpolate, placeholders, resolveLang } from '../src/i18n/translate';

describe('i18n', () => {
  it('has the same keys and placeholders in both languages', () => {
    expect(Object.keys(enUS).sort()).toEqual(Object.keys(ptBR).sort());
    for (const [key, value] of Object.entries(ptBR)) {
      expect(placeholders(enUS[key as keyof typeof ptBR]), key).toEqual(placeholders(value));
    }
  });

  it('interpolates params', () => {
    expect(interpolate('{a} and {b} and {c}', { a: 1, b: 'x' })).toBe('1 and x and {c}');
    expect(createTranslator('en-US')('footer.folder', { size: '3 MB' })).toBe('Folder: 3 MB');
    expect(createTranslator('pt-BR')('footer.folder', { size: '3 MB' })).toBe('Pasta: 3 MB');
  });

  it('resolves the language', () => {
    expect(resolveLang('en-US', 'pt-BR')).toBe('en-US');
    expect(resolveLang(null, 'pt-PT')).toBe('pt-BR');
    expect(resolveLang(null, 'PT')).toBe('pt-BR');
    expect(resolveLang(null, 'de-DE')).toBe('en-US');
    expect(resolveLang(null, undefined)).toBe('en-US');
  });
});
