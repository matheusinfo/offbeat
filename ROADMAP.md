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
- Vários links de uma vez, com uma pré-visualização para cada e "Baixar tudo"
- "Só esta faixa" para links de música tocada dentro de uma lista (`watch?v=…&list=…`)
- Volume igual em todas as músicas (`loudnorm` na mesma codificação do MP3)
- Vídeos com capítulos divididos em uma faixa por capítulo (`--download-sections`)
- Histórico de downloads: pular o que já foi baixado, "Baixar N novas" e "Baixar de novo"
- Playlists salvas com "Sincronizar", que põe na fila só as músicas novas
- Atualizar o yt-dlp pelo app (cópia em `~/.local/share/offbeat/bin/`, atualizada com `yt-dlp -U`)
- Notificação do sistema quando a fila termina com a janela em segundo plano

## Pendente

**Prova no relógio: MP3 confirmado.** Em 9/11/2026, as 119 faixas MP3 do perfil Equilibrado tocaram no GT 5 pelo Huawei Health. Falta mandar algumas do perfil Original (M4A): se tocarem, o Original pode virar o padrão (passo a passo em [docs/recipes.md](docs/recipes.md#depois-do-teste-no-relógio-m4a-no-gt-5)).

| Ideia | Por quê | Esforço |
|---|---|---|
| Capítulos mais rápidos: baixar o áudio do vídeo uma vez e cortar cada capítulo localmente | Hoje cada capítulo é lido quase em tempo real (mix de 1 h ≈ 20 min) | Médio |
| Cookies do navegador (`--cookies-from-browser`) | Playlists privadas e "Músicas curtidas" do YouTube Music | Médio |
| Perfil Econômico mono | ~2 MB por música, para quem usa um fone só | Baixo |
| Aviso de espaço: comparar o total da pasta com o espaço livre do relógio | Evitar transferências que não cabem | Baixo |
| Release: AppImage publicado, ícone final, sidecars sem conflito no .deb | Distribuir sem compilar | Médio |
| AppImage menor: ffmpeg só com o necessário (áudio, mp3, mjpeg) em vez do build estático completo | Hoje são 282 MB, quase tudo ffmpeg e ffprobe | Médio |
