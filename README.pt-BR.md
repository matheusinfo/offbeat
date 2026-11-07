# Offbeat 🎧

**Português** · [English](README.md)

**Cole um link do YouTube ou do YouTube Music e receba arquivos de áudio pequenos, com tags e capa, prontos para o relógio.**

O Offbeat é um app desktop pequeno para Linux, feito para uma tarefa: levar música para o relógio (ele foi pensado para o Huawei GT 5) e correr ou treinar sem o celular. Cole o link de uma música, playlist ou álbum, e o Offbeat salva cada faixa como um MP3 ou M4A compacto, com título, artista, álbum, número da faixa e capa quadrada. Depois é só mandar a pasta para o relógio pelo app Huawei Health.

Tudo roda no seu computador. Sem conta, sem servidor, sem telemetria.

![Offbeat baixando um álbum](docs/images/main-pt.png)

---

## O que dá para fazer

| | Recurso | |
|---|---|---|
| 🔗 | **Colar e visualizar** | Links do YouTube, YouTube Music e youtu.be. Veja capa, título, duração, número de faixas e o tamanho estimado antes de baixar. Ao clicar no campo vazio, o link da área de transferência é colado sozinho. |
| 💿 | **Álbuns e playlists** | Cada faixa vira um item da fila, numerada (`01 - `) no nome do arquivo e na tag de faixa. Funciona com álbuns e playlists do YouTube Music. |
| 📶 | **Fila com progresso** | Dois downloads por vez, com progresso, velocidade e tempo restante. Cancele uma faixa ou todas, e tente de novo as que falharem. |
| 🗜️ | **Arquivos pequenos** | Três perfis de tamanho (abaixo). A capa é recortada quadrada e reduzida para 300 px (~25 KB em vez de 100–300 KB por faixa). |
| 📁 | **Sua pasta** | Os arquivos vão para `~/Música/Offbeat` por padrão (a pasta de música do sistema). O rodapé mostra o total da pasta, e *Abrir pasta* aparece quando a fila termina. |
| 🌐 | **Dois idiomas** | Português (Brasil) e English (US), seguindo o sistema ou escolhido nas Configurações. Tema claro e escuro seguem o sistema. |

## Perfis de tamanho

O YouTube já entrega o áudio a cerca de 128–160 kbps. Converter isso para MP3 de 320 kbps só deixa o arquivo 2,5× maior, sem ganhar qualidade. Por isso o Offbeat copia o áudio original ou codifica uma única vez, numa taxa parecida.

| Perfil | O que faz | Música de 4 min | Faixas por 1 GB |
| --- | --- | --- | --- |
| **Original** | Copia o áudio AAC como M4A, sem recodificar | ~3,8 MB | ~260 |
| **Equilibrado** (padrão) | MP3 VBR V5, ~130 kbps | ~3,9 MB | ~255 |
| **Econômico** | MP3 VBR V7, ~100 kbps | ~3,0 MB | ~340 |

O Original não perde nada, mas exige um relógio que toque M4A. O Equilibrado funciona em qualquer um.

![Configurações](docs/images/settings-pt.png)

## Como usar

1. Copie o link de uma música, álbum ou playlist do YouTube ou do YouTube Music.
2. Clique no campo de link do Offbeat (ele cola sozinho) e aperte **Visualizar**.
3. Confira a pré-visualização e aperte **Baixar** (ou **Baixar N faixas**).
4. Quando a fila terminar, aperte **Abrir pasta**.
5. Mande os arquivos para o relógio pelo app **Huawei Health** no celular (essa parte o Offbeat não faz: o Huawei Health não tem API pública).

**Dica:** um link do YouTube Music com `&list=` (uma música tocada de dentro de um álbum ou playlist) traz a lista inteira. Para baixar só aquela música, apague o trecho `&list=…`.

## Instalar

Ainda não há pacotes prontos. Para gerar no Linux Mint 22 / Ubuntu 24.04:

```bash
sudo apt install build-essential curl file libwebkit2gtk-4.1-dev libxdo-dev \
  libssl-dev libayatana-appindicator3-dev librsvg2-dev
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh   # Rust
npm install
npm run binaries        # baixa yt-dlp, ffmpeg, ffprobe e Deno (conferidos por SHA-256)
npm run tauri build     # AppImage, .deb e .rpm em src-tauri/target/release/bundle/
```

O AppImage é o mais simples: um arquivo só, sem instalação. Detalhes em [docs/development.md](docs/development.md).

## Privacidade

- O Offbeat não faz nenhuma chamada de rede própria. Só o yt-dlp acessa o YouTube, e o `sponsor.ajay.app` se você ligar o **SponsorBlock** nas Configurações (ele corta as partes sem música dos clipes).
- As configurações ficam em `~/.config/offbeat/settings.json`. Os arquivos temporários vão para `~/.cache/offbeat/tmp/` e são apagados após cada download.
- Sem telemetria, relatório de falhas ou conta.

## Aviso legal

Baixar do YouTube fora dos apps oficiais viola os Termos de Serviço do YouTube, mesmo para assinantes Premium. **Você é responsável pelo que baixa.** O Offbeat não tem relação com o YouTube nem com o Google.

## Feito com

[Tauri 2](https://tauri.app), React e TypeScript, com [yt-dlp](https://github.com/yt-dlp/yt-dlp), [FFmpeg](https://ffmpeg.org) e [Deno](https://deno.com) empacotados como sidecars. Veja as licenças deles em [NOTICE](NOTICE).

Para desenvolvedores e agentes de IA: comece pelo [AGENTS.md](AGENTS.md).

## Licença

[MIT](LICENSE) © 2026 Matheus Andrade
