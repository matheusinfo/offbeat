# Integração com o yt-dlp

Galho de [AGENTS.md](../AGENTS.md). Argumentos, perfis, capa e tags, formato das linhas de saída, erros e YouTube Music. O código está em [src-tauri/src/ytdlp.rs](../src-tauri/src/ytdlp.rs) (funções puras, com testes).

## Pré-visualização

```
yt-dlp --ignore-config --no-color -J --flat-playlist [--js-runtimes deno:<caminho>] -- <URL>
```

`parse_preview` lê o JSON:

- `_type == "playlist"` → `kind: "playlist"`, uma entrada por item de `entries[]`. Entradas sem `id`, com id inválido, com `ie_key` diferente de `Youtube` (abas e playlists de páginas de canal) ou do tipo `playlist` são descartadas.
- URL de cada faixa: `url`, senão `webpage_url`, senão `https://www.youtube.com/watch?v=<id>`, sempre revalidada.
- Vídeo único → uma entrada igual a ele. A URL vem de `webpage_url` (o campo `url` pode ser um link direto do googlevideo).
- Capa: `thumbnail`, senão a maior de `thumbnails[]`, senão a da primeira faixa. Só URLs `https://i.ytimg.com/`.
- Duração da playlist: soma das durações conhecidas (ou `null`).

## Download (uma faixa)

```
yt-dlp --ignore-config --no-color --no-playlist --newline --progress --no-simulate
  --progress-template "download:PROG %(progress)j"
  --progress-template "postprocess:POST %(progress.postprocessor)s %(progress.status)s"
  --print "after_move:DONE %(filepath)s"
  --embed-metadata --embed-thumbnail --convert-thumbnails jpg
  --ppa "ThumbnailsConvertor+ffmpeg_o:-vf \"crop='min(iw,ih)':'min(iw,ih)',scale=300:300\" -q:v 5"
  --ffmpeg-location <sidecar ffmpeg> [--js-runtimes deno:<sidecar deno>]
  -P <pasta de saída> -P temp:~/.cache/offbeat/tmp/<id>
  -o <modelo de nome> [--parse-metadata "<n>:(?P<track_number>.+)"]
  <argumentos do perfil> [--sponsorblock-remove music_offtopic]
  -- <URL>
```

- `--print` implica `--quiet` e `--simulate`; `--no-simulate` garante o download e `--progress` mantém o progresso.
- `PYTHONIOENCODING=utf-8` no ambiente, para nomes com acento.
- O yt-dlp acha o `ffprobe` na mesma pasta do `ffmpeg`.

### Perfis

| Perfil | Argumentos | Observação |
| --- | --- | --- |
| `original` | `-f "bestaudio[ext=m4a]/bestaudio" -x --audio-format m4a` | Copia o AAC sem recodificar quando a fonte já é AAC |
| `balanced` (padrão) | `-f bestaudio -x --audio-format mp3 --audio-quality 5` | LAME VBR V5, ~130 kbps |
| `economy` | `-f bestaudio -x --audio-format mp3 --audio-quality 7` | LAME VBR V7, ~100 kbps |

A estimativa de tamanho na pré-visualização usa MB por minuto do planejamento (0,96 / 1,0 / 0,75) em [src/lib/ytdlp.ts](../src/lib/ytdlp.ts). Num álbum de teste de 42:58 no perfil Equilibrado, a estimativa foi 43,0 MB e o resultado real, 41 MB.

### Nome do arquivo

| Padrão | Modelo |
| --- | --- |
| `title` | `%(title)s.%(ext)s` |
| `artist-title` | `%(artist,uploader)s - %(title)s.%(ext)s` |

Faixas de playlist ou álbum ganham o prefixo `01 - ` (dígitos literais, a posição vem do front).

### Capa e tags

- **Capa quadrada de 300 px** (~20–30 KB). O recorte central tira as barras laterais que o YouTube Music põe em volta da arte do álbum (a miniatura é 16:9 com a capa quadrada no meio). Em clipes comuns, corta as laterais do quadro. As aspas em volta do filtro protegem as vírgulas de `min()` no parser de filtros do ffmpeg.
- `--embed-metadata` grava título, artista, álbum (quando o YouTube Music informa) e data.
- **Número da faixa**: como cada faixa é baixada sozinha (`--no-playlist`), o yt-dlp não sabe a posição. O backend grava `track_number` com `--parse-metadata "<n>:(?P<track_number>.+)"`.

## Linhas de progresso

O backend encaminha **as duas streams**. Com `--print`, o yt-dlp fica em modo silencioso e as linhas saem assim (conferido com o yt-dlp 2026.10.26):

| Linha | Stream | Significado |
| --- | --- | --- |
| `PROG {json}` | stdout | dicionário de progresso: `downloaded_bytes`, `total_bytes` ou `total_bytes_estimate`, `speed`, `eta`, `status`. Pode ter `NaN`/`Infinity` |
| `POST <Nome> <status>` | stderr | pós-processador, ex.: `POST ExtractAudio started`. Qualquer `started` → "Convertendo…" |
| `DONE <caminho>` | stdout | caminho final do arquivo (pode ter espaços) |

A ordem entre stdout e stderr não é garantida (um `DONE` pode chegar antes dos últimos `POST`). O item só vira "Concluído" quando o comando `download` resolve com `success`.

## Erros

[src/lib/errors.ts](../src/lib/errors.ts) classifica as últimas linhas do stderr:

| Trecho no stderr | Tipo | Mensagem sugere |
| --- | --- | --- |
| `Sign in to confirm you're not a bot` | `bot_check` | tentar mais tarde, atualizar o yt-dlp |
| `Private video`, `members-only`, `Join this channel` | `private` | conteúdo exige login (ainda não suportado) |
| `ffmpeg not found` | `ffmpeg_missing` | erro de instalação |
| `HTTP Error 403` | `http_403` | atualizar o yt-dlp |
| `This video is unavailable`, `Video unavailable` | `unavailable` | vídeo removido ou bloqueado na região |
| `Unable to download webpage`, `timed out`, falha de DNS | `network` | conferir a internet |

O texto muda entre versões do yt-dlp (o 2026.10.26 escreve "This video is unavailable"). Ao atualizar o yt-dlp, confira as mensagens e acrescente casos em [tests/errors.test.ts](../tests/errors.test.ts).

## YouTube Music

Testado com o yt-dlp 2026.10.26 e um álbum de 10 faixas:

| Link | O que acontece |
| --- | --- |
| `music.youtube.com/playlist?list=OLAK5uy…` (álbum) ou `?list=PL…` (playlist) | Playlist; as faixas vêm como `music.youtube.com/watch?v=…` com `ie_key: Youtube` |
| `music.youtube.com/browse/MPREb…` (página do álbum) | O yt-dlp redireciona para a playlist `OLAK5uy…` do álbum (aviso "YouTube Music is not directly supported" no stderr, inofensivo) |
| `music.youtube.com/watch?v=…&list=…` | **A playlist inteira** (padrão do yt-dlp). A pré-visualização mostra a contagem e o botão "Só esta faixa", que põe na fila só a entrada com o `v=` do link (`focusedVideoId` e `focusedItem` no front), sem número |
| `music.youtube.com/watch?v=…` | Só a faixa |

- As faixas trazem `artist` e `album`, então o padrão "Artista - Título" e as tags saem certos.
- A capa do álbum no nível da playlist vem de `i9.ytimg.com` e a versão grande às vezes é um placeholder de 120×90. Por isso a pré-visualização usa a miniatura da primeira faixa (`i.ytimg.com`), e a CSP continua só com `i.ytimg.com`.
- Playlists que exigem login (como "Músicas curtidas") falham com erro de conteúdo privado, até o suporte a cookies do navegador entrar (veja o [ROADMAP](../ROADMAP.md)).

## Atualizar o yt-dlp

O YouTube muda com frequência. Para o desenvolvimento, `npm run binaries -- --force` baixa o release mais recente. A atualização pelo próprio app (para `~/.local/share/offbeat/bin/`) está no roadmap.
