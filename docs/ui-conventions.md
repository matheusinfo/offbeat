# Convenções de UI

Galho de [AGENTS.md](../AGENTS.md). Componentes, textos, cores, acessibilidade e capturas de tela.

## Estrutura

Uma tela só, em uma coluna (janela de 560×720, mínimo 420 de largura):

| Componente | Papel |
| --- | --- |
| [UrlInput](../src/components/UrlInput.tsx) | campo + "Visualizar". Valida com `isSupportedUrl`; ao focar o campo vazio, cola da área de transferência se for link suportado |
| [Preview](../src/components/Preview.tsx) | capa, título, canal, duração, nº de faixas (lista recolhível), tamanho estimado e "Baixar" |
| [Queue](../src/components/Queue.tsx) | itens com barra, %, velocidade e tempo restante; cancelar, tentar de novo, remover, "Cancelar tudo", "Limpar concluídos" |
| [Settings](../src/components/Settings.tsx) | `<dialog>` modal: pasta, perfil, nome do arquivo, SponsorBlock, idioma e versões das ferramentas |
| [ErrorNote](../src/components/ErrorNote.tsx) | mensagem traduzida + "Detalhes" com a linha original do stderr |

- O estado da fila é um reducer puro ([queue.ts](../src/lib/queue.ts)). Componentes recebem dados e callbacks por props e não chamam o backend, exceto `Settings` (salvar, versões, seletor de pasta) e `UrlInput` (área de transferência).
- `Settings` só é montado enquanto aberto. **Não chame `dialog.close()` na limpeza do `useEffect`**: o evento `close` é assíncrono e, com o `StrictMode` (monta, desmonta, monta), chega depois da remontagem e fecha o modal assim que abre.

## Textos (i18n)

- `const { t, lang } = useI18n()`; `t('chave', { param })` substitui `{param}`.
- A chave nasce em [pt-BR.ts](../src/i18n/pt-BR.ts) (`MessageKey` deriva dele) e precisa existir em [en-US.ts](../src/i18n/en-US.ts), tipado como `Record<MessageKey, string>`: faltar chave não compila. Um teste confere que os `{param}` são os mesmos nos dois idiomas.
- Idioma: `settings.language` ou, se `null`, `navigator.language` (`pt*` → pt-BR, senão en-US). Atualiza `document.documentElement.lang`.
- Números, tamanhos, duração e velocidade passam por [format.ts](../src/lib/format.ts) com `Intl` no idioma atual (`3,8 MB` × `3.8 MB`).
- Tom: frases curtas, voz ativa, dizendo o que o usuário pode fazer. Mensagens de erro sugerem a ação.

## Cores e tema

- Tokens em `:root` de [styles.css](../src/styles.css) (`--bg`, `--surface`, `--surface-2`, `--border`, `--text`, `--muted`, `--accent`, `--accent-text`, `--on-accent`, `--danger`, `--success`, `--focus`, `--track`…), redefinidos em `@media (prefers-color-scheme: dark)`. O tema segue o sistema.
- Texto colorido usa `--accent-text`, não `--accent` (o roxo do botão é escuro demais como texto no tema escuro).
- **Contraste mínimo de 4,5:1** em texto, nos dois temas. Os tokens atuais foram medidos (o par mais baixo é branco sobre `--accent` escuro, 5,4:1). Ao criar ou trocar uma cor, meça.
- Use os tokens; não espalhe cores soltas. Cor nova entra nos dois temas.

## Acessibilidade

- Todo campo tem `<label>`. Botões só com ícone têm `aria-label` (e `title`).
- Status e progresso usam `aria-live="polite"`; barras de progresso têm rótulo.
- Foco visível em tudo (`--focus`). `Esc` fecha as Configurações (nativo do `<dialog>`), assim como clicar fora.
- `prefers-reduced-motion` desliga as animações.

## Capturas de tela

As capturas dos READMEs ficam em `docs/images/`: `main-pt.png`, `settings-pt.png` (README.pt-BR) e `main-en.png`, `settings-en.png` (README). Para refazer:

1. Rode o app isolado, com configuração e saída temporárias: `XDG_CONFIG_HOME=/tmp/ob-config XDG_CACHE_HOME=/tmp/ob-cache npm run tauri dev`, e escolha uma pasta de saída temporária nas Configurações (ou crie `settings.json` antes).
2. Use o tema do sistema escuro, a janela no tamanho padrão (560×720) e conteúdo de demonstração (um álbum público), sem dados pessoais.
3. Capture só a janela e reduza para 128 cores, o que deixa cada PNG com ~27 KB:

```bash
ffmpeg -i captura.png -vf "split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=none" docs/images/main-pt.png
```
