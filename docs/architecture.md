# Arquitetura

Galho de [AGENTS.md](../AGENTS.md). Como o front e o backend conversam, onde fica cada coisa e as decisões de segurança.

## Visão geral

```
React (WebView)  ──invoke/Channel──▶  Rust (Tauri)  ──spawn──▶  yt-dlp ──▶ ffmpeg/ffprobe
   tela única                          comandos             │       └──▶ deno (desafios do player)
   fila, i18n                          estado, settings     └──▶ YouTube / YouTube Music
```

O React só fala com o backend por comandos do Tauri e, durante um download, por um `Channel` que recebe as linhas de saída. Só o backend lança processos. Os tipos de ida e volta estão em [src/lib/api.ts](../src/lib/api.ts) e têm um gêmeo `serde` em Rust.

## Comandos

| Comando | Argumentos (JS) | Retorno | O que faz |
| --- | --- | --- | --- |
| `preview` | `{ url }` | `Preview` | `yt-dlp -J --flat-playlist`, timeout de 60 s, devolve título, capa, duração e faixas |
| `download` | `{ request: {id, url, index}, onEvent }` | `DownloadOutcome` | baixa uma faixa e encaminha cada linha de stdout e stderr pelo `Channel` |
| `cancel_download` | `{ id }` | `boolean` | pede o cancelamento; `false` se o id não está rodando |
| `get_settings` / `save_settings` | `{ settings }` | `Settings` | lê ou valida e grava as configurações |
| `open_output_dir` | | | cria a pasta se preciso e abre no gerenciador de arquivos |
| `output_dir_size` | | `number` | soma dos arquivos diretamente na pasta de saída |
| `tool_versions` | | `ToolVersions` | versões de yt-dlp, ffmpeg e Deno (ou `null`) |

Todos rejeitam com `AppError { code, message, detail }`. Os códigos estão em `api.ts` e o front os traduz em [src/lib/errors.ts](../src/lib/errors.ts).

## Fluxo de um download

1. O usuário cola um ou mais links. O front valida (`parseLinks`) e chama `preview` para cada um, dois por vez. O backend valida de novo. O estado de cada link (carregando, pronto ou erro) é um reducer puro ([previews.ts](../src/lib/previews.ts)); respostas de uma colagem antiga são descartadas.
2. Na pré-visualização, "Baixar" põe na fila **uma entrada por faixa**: playlist e álbum viram N itens com `index` = posição (1, 2, …); vídeo único tem `index: null`.
3. O executor da fila ([App.tsx](../src/App.tsx), `useDownloadRunner`) mantém no máximo **2 downloads simultâneos** (`MAX_CONCURRENT` em [queue.ts](../src/lib/queue.ts)).
4. Para cada item, `download` roda um yt-dlp com `--no-playlist` na URL da faixa. Um processo por faixa dá progresso, cancelamento, erro e "tentar de novo" por faixa.
5. As linhas chegam pelo `Channel`; [progress.ts](../src/lib/progress.ts) interpreta `PROG`, `POST` e `DONE` (formato em [ytdlp.md](ytdlp.md#linhas-de-progresso)). As atualizações são agrupadas por quadro de animação.
6. Quando o comando resolve, o item vira `done`, `error` ou `canceled`. Ao esvaziar a fila, o rodapé atualiza o total da pasta e mostra "Abrir pasta".

## Cancelamento e processos

- Todo processo filho (preview, download, versões) roda em **grupo de processos próprio**. O yt-dlp autônomo é um bootloader do PyInstaller que cria outro processo, e o yt-dlp ainda chama ffmpeg e deno: o sinal precisa chegar à árvore inteira.
- `cancel_download` só marca o pedido. A própria tarefa do download manda SIGTERM ao grupo, espera 3 s e manda SIGKILL se ainda estiver vivo. Assim o processo não é colhido antes do sinal, e um id de grupo reaproveitado nunca recebe sinal por engano.
- Cada download usa a pasta temporária `~/.cache/offbeat/tmp/<id>/` (`-P temp:`). Ela é apagada ao terminar, ao cancelar e ao abrir o app. Não sobra `.part` nem `.ytdl` na pasta de saída.
- Ao fechar o app, os downloads em andamento são encerrados.
- No front, um item cancelado mantém sua vaga até o backend confirmar o fim, para não estourar o limite de 2 e receber `busy`.

## Configurações

[settings.rs](../src-tauri/src/settings.rs) guarda em `~/.config/offbeat/settings.json`:

| Campo | Valores | Padrão |
| --- | --- | --- |
| `outputDir` | caminho absoluto | pasta Música do sistema (`XDG_MUSIC_DIR`) + `/Offbeat` |
| `profile` | `original`, `balanced`, `economy` | `balanced` (M4A no GT 5 ainda não foi testado) |
| `filenamePattern` | `title`, `artist-title` | `title` |
| `sponsorblock` | booleano | `false` |
| `normalizeVolume` | booleano (ignorado no perfil `original`) | `false` |
| `language` | `pt-BR`, `en-US`, `null` (sistema) | `null` |

- Leitura campo a campo: um valor inválido volta ao padrão sem zerar o resto.
- Gravação validada (caminho absoluto, sem `..`, diferente de `/`) e atômica (arquivo temporário + rename).
- O backend lê `outputDir` e o perfil do estado salvo na hora do download: o front não manda caminhos.

## Segurança e privacidade

- **Argumentos sempre em lista**, nunca string de shell, com `--ignore-config` (ignora o config do yt-dlp do usuário) e `--` antes da URL.
- **URL validada nos dois lados**: só `http(s)`, hosts `youtube.com`, `www.`, `m.`, `music.youtube.com` e `youtu.be`; sem usuário/senha, porta, espaços ou caracteres de controle. Ids de download: `[A-Za-z0-9_-]{1,64}`.
- **WebView com o mínimo** ([capabilities/default.json](../src-tauri/capabilities/default.json)): `core:default`, `dialog:allow-open` (seletor de pasta) e `clipboard-manager:allow-read-text` (colar o link ao focar). Sem shell, fs ou opener: quem lança processos e abre a pasta é o backend.
- **CSP**: só recursos locais e imagens de `https://i.ytimg.com`. O backend também descarta miniaturas de outros domínios.
- **Rede**: o app não faz chamadas próprias. O yt-dlp acessa o YouTube; com SponsorBlock ligado, também `sponsor.ajay.app`. Sem telemetria, conta ou relatório de falhas.

## Decisões que mudaram em relação ao planejamento

O [planejamento](planning.md) é o documento original e não é atualizado. O que mudou na implementação:

- **Argumentos montados em Rust** ([ytdlp.rs](../src-tauri/src/ytdlp.rs)), não em `src/lib/ytdlp.ts`: o front não controla a linha de comando. O `ytdlp.ts` ficou com a validação de URL e a estimativa de tamanho.
- **Sem `@tauri-apps/plugin-shell` nem `plugin-store`**: o backend lança os processos com `tokio::process` e guarda as configurações em JSON próprio, com validação.
- **Quatro sidecars**: além de yt-dlp e ffmpeg, o `ffprobe` (o yt-dlp precisa dele para extrair o áudio) e o Deno (o yt-dlp atual exige um runtime JS para o YouTube).
- **Um processo por faixa** em vez de um por playlist, para ter controle por faixa. A posição vai no nome (`01 - `) e na tag de faixa.
- **Pasta temporária por download** em `~/.cache/offbeat/tmp/` em vez de apagar `.part`/`.ytdl` na pasta de saída.
