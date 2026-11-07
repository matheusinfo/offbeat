# Roadmap

Critério: valor para quem leva música ao relógio × esforço, mantendo o app **local e privado**. A ordem original e a motivação estão no [planejamento](docs/planning.md#roadmap).

## Feito ✅

- Esqueleto Tauri 2 + React + TS com sidecars (yt-dlp, ffmpeg, ffprobe, Deno) e `--version` funcionando
- Download único com progresso e arquivo salvo na pasta escolhida
- Playlist e fila: pré-visualização com `-J`, progresso por faixa, cancelamento
- Perfis de tamanho (Original, Equilibrado, Econômico), capa reduzida e quadrada, SponsorBlock e total da pasta
- YouTube Music: playlists, álbuns (`browse/…`) e links com `&list=`, com tags de álbum e número da faixa
- Interface em pt-BR e en-US; tema claro/escuro seguindo o sistema
- AppImage instalável para o usuário, com atalho no menu (`npm run install-desktop`)

## Pendente

**Antes de tudo: prova no relógio.** Mandar 3 faixas do perfil Original (M4A) e 3 do Equilibrado (MP3) pelo Huawei Health e conferir se tocam, se mostram título e capa e quanto ocupam. Se o GT 5 tocar M4A, o Original vira o perfil padrão.

| Ideia | Por quê | Esforço |
|---|---|---|
| Opção "só esta faixa" para links `watch?v=…&list=…` | Hoje traz a lista inteira; quem copia uma música tocada de um álbum quer só ela | Baixo |
| Arquivo de histórico (`--download-archive`) | Não baixar de novo o que já existe; base da sincronização | Baixo |
| Playlists salvas: um clique para buscar só as faixas novas | Sincronizar uma playlist que cresce | Médio |
| Cookies do navegador (`--cookies-from-browser`) | Playlists privadas e "Músicas curtidas" do YouTube Music | Médio |
| Atualizar o yt-dlp pelo app (`~/.local/share/offbeat/bin/`, conferindo `SHA2-256SUMS`) | O YouTube quebra versões antigas em semanas | Médio |
| Normalização de volume (`loudnorm`) na mesma codificação | Volume uniforme para treinar com fone | Baixo |
| Perfil Econômico mono | ~2 MB por música, para quem usa um fone só | Baixo |
| Aviso de espaço: comparar o total da pasta com o espaço livre do relógio | Evitar transferências que não cabem | Baixo |
| Release: AppImage publicado, ícone final, sidecars sem conflito no .deb | Distribuir sem compilar | Médio |
| AppImage menor: ffmpeg só com o necessário (áudio, mp3, mjpeg) em vez do build estático completo | Hoje são 282 MB, quase tudo ffmpeg e ffprobe | Médio |
