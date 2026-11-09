# Convenções de UI

Galho de [AGENTS.md](../AGENTS.md). Componentes, textos, cores, acessibilidade e capturas de tela.

## Estrutura

Uma tela só, em uma coluna (janela de 560×720, mínimo 420 de largura):

| Componente | Papel |
| --- | --- |
| [UrlInput](../src/components/UrlInput.tsx) | campo + "Visualizar". Aceita um ou mais links separados por espaço (`parseLinks`, até `MAX_LINKS` = 20). Ao colar várias linhas, troca as quebras por espaços (o `<input>` as apagaria e grudaria os links). Ao focar o campo vazio, cola da área de transferência se só houver links suportados |
| [Preview](../src/components/Preview.tsx) | capa, título, canal, duração, nº de faixas (lista recolhível), tamanho estimado e "Baixar". `LinkStatus`: cartão de um link ainda carregando ou com erro, quando foram colados vários |
| [Queue](../src/components/Queue.tsx) | itens com barra, %, velocidade e tempo restante; cancelar, tentar de novo, remover, "Cancelar tudo", "Limpar concluídos" |
| [Settings](../src/components/Settings.tsx) | `<dialog>` modal: pasta, perfil, nome do arquivo, SponsorBlock, idioma e versões das ferramentas |
| [SavedPlaylists](../src/components/SavedPlaylists.tsx) | playlists salvas, com "Sincronizar" por linha e "Sincronizar todas"; o estado de cada sincronização (`SyncState`) fica no App |
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

Os READMEs são um passo a passo ilustrado. As capturas ficam em `docs/images/`, uma por passo e idioma (`-en` no README, `-pt` no README.pt-BR):

| Arquivo | Passo |
| --- | --- |
| `paste-{en,pt}.png` | link do YouTube Music colado, pasta vazia (0 B) |
| `preview-{en,pt}.png` | pré-visualização do álbum |
| `downloading-{en,pt}.png` | fila no meio: concluídas, convertendo, iniciando, na fila e total da pasta subindo (também é a imagem do topo) |
| `done-{en,pt}.png` | tudo concluído, com "Abrir pasta" |
| `settings-{en,pt}.png` | Configurações |

Regras, porque o repositório é público:

- **Só música com licença livre.** Use o álbum *Polka! Polka! Polka!* de Kevin MacLeod (CC BY 4.0): `https://music.youtube.com/playlist?list=OLAK5uy_ldvBO5kQR_s6ScaW0-UoV7Nn9kmZHMyog`, com o crédito no fim dos READMEs. Nada de álbum comercial (capa e nome expõem o repositório a DMCA).
- **Nenhum caminho pessoal.** Pasta de saída `/tmp/Offbeat`: aparece nas Configurações.
- Tema escuro do sistema, janela no tamanho padrão (560×720), cursor fora da janela, nenhuma outra janela por cima.

Como refazer:

1. Rode uma instância isolada, que não toca nas configurações nem na pasta de música reais (pode rodar junto com o app instalado): `npm run dev` e, em outro terminal, `XDG_CONFIG_HOME=/tmp/ob-config XDG_CACHE_HOME=/tmp/ob-cache WEBKIT_INSPECTOR_HTTP_SERVER=127.0.0.1:9223 ./src-tauri/target/debug/offbeat`, com `/tmp/ob-config/offbeat/settings.json` apontando `outputDir` para `/tmp/Offbeat` e `language` para o idioma da rodada.
2. Siga o fluxo (colar → Visualizar → Baixar 11 faixas → esperar → Configurações) e capture cada passo. A captura do meio vale quando há ≥ 3 concluídas e ainda há downloads. Antes da rodada do outro idioma, apague os `.mp3` de `/tmp/Offbeat`, senão o yt-dlp pula as faixas e não há progresso para fotografar.
3. Capture só a janela com `ffmpeg -f x11grab` (o `xwd` sai em branco com o WebKit; veja [recipes.md](recipes.md#testar-a-interface-de-verdade)) e reduza para 128 cores, o que deixa cada PNG com 10–28 KB:

```bash
ffmpeg -i captura.png -vf "split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=none" docs/images/downloading-pt.png
```
