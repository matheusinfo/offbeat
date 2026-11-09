# Desenvolvimento

Galho de [AGENTS.md](../AGENTS.md). Como preparar a máquina, rodar, verificar e empacotar.

## Preparar a máquina (Linux Mint 22 / Ubuntu 24.04)

```bash
# Dependências do Tauri 2 (WebKitGTK 4.1, GTK 3, libsoup 3, OpenSSL).
# Rode o apt update antes: com o índice velho, alguns pacotes dão 404.
sudo apt update
sudo apt install build-essential curl wget file libwebkit2gtk-4.1-dev \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev

# Rust (rustup, em ~/.cargo; o instalador põe ~/.cargo/env no ~/.profile e no ~/.bashrc)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Node 24 e as dependências do front
npm install

# Sidecars: yt-dlp, ffmpeg, ffprobe e Deno (~490 MB, conferidos por SHA-256)
npm run binaries
```

`npm run binaries` roda [scripts/fetch-binaries.sh](../scripts/fetch-binaries.sh), que baixa os releases mais recentes para `src-tauri/binaries/` com o sufixo da plataforma (`yt-dlp-x86_64-unknown-linux-gnu` etc.). A pasta é ignorada pelo git. Binários já presentes são mantidos. Ele também salva as licenças das versões instaladas e gera o `THIRD-PARTY-LICENSES.txt` (veja [Empacotamento](#empacotamento)). Use `--force` para baixar tudo de novo, por exemplo quando o YouTube quebrar o yt-dlp atual.

O `tauri-build` falha se algum arquivo de `externalBin` (em `tauri.conf.json`) faltar, então rode o script antes do primeiro `cargo build`.

## Comandos

```bash
npm run tauri dev        # app com recarga do front (Vite em 127.0.0.1:1420)
npm run typecheck        # tsc
npm test                 # vitest: tests/ (lógica pura do front)
npm run build            # tsc + vite build (dist/)
npm run tauri build      # AppImage, .deb e .rpm em src-tauri/target/release/bundle/
npm run tauri build -- --bundles appimage   # só o AppImage
npm run install-desktop  # instala o AppImage para o usuário (menu + comando offbeat)

cd src-tauri
cargo test               # testes do backend (argumentos, URLs, pré-visualização)
cargo clippy --all-targets -- -D warnings
cargo fmt --check
```

## Verificação obrigatória antes do commit

```bash
npm run typecheck && npm test && npm run build
(cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test)
```

- Sem erros nem warnings novos, nos dois lados.
- Mudança visual ou de fluxo: rode `npm run tauri dev` e teste com um vídeo curto e uma playlist pequena. Se não deu para testar, diga isso ao usuário em vez de afirmar que funciona.

## Depurar o WebView

O WebKitGTK expõe um inspetor remoto. Rode o binário com a variável abaixo e abra `http://127.0.0.1:9223` num navegador baseado em WebKit (Epiphany), ou converse com o WebSocket `ws://127.0.0.1:9223/socket/1/1/WebPage` (protocolo do Web Inspector: `Runtime.evaluate`, `Console.enable`).

```bash
npm run dev &   # Vite em 127.0.0.1:1420
WEBKIT_INSPECTOR_HTTP_SERVER=127.0.0.1:9223 ./src-tauri/target/debug/offbeat
```

Para testar sem tocar nas suas configurações nem na sua pasta Música, rode com `XDG_CONFIG_HOME` e `XDG_CACHE_HOME` apontando para pastas temporárias e escolha uma saída temporária.

## Onde o app guarda as coisas

| Caminho | O quê |
| --- | --- |
| `~/.config/offbeat/settings.json` | Configurações (pasta, perfil, nome do arquivo, SponsorBlock, idioma) |
| `~/.cache/offbeat/tmp/<id>/` | Arquivos temporários de cada download. Apagada ao terminar, ao cancelar e ao abrir o app |
| `~/Música/Offbeat/` (padrão) | Saída: a pasta de música do sistema (`XDG_MUSIC_DIR`, que pode ser `~/Músicas` ou `~/Music`) + `Offbeat` |
| `~/.local/share/offbeat/playlists.json` | Playlists salvas (`[{url, title}]`) |
| `~/.local/share/offbeat/history.txt` | Histórico de downloads, no formato do `--download-archive` do yt-dlp (`youtube <id>` por linha) |

## Empacotamento

`npm run tauri build` gera AppImage, .deb e .rpm. Para uso próprio, o AppImage basta, instalado com `npm run install-desktop` ([scripts/install-desktop.sh](../scripts/install-desktop.sh)):

| Caminho | O quê |
| --- | --- |
| `~/Applications/Offbeat.AppImage` | o app |
| `~/.local/bin/offbeat` | link para o comando no PATH |
| `~/.local/share/applications/offbeat.desktop` | entrada no menu (`StartupWMClass=offbeat`, a classe da janela do Tauri) |
| `~/.local/share/icons/hicolor/{32x32,128x128,256x256}/apps/offbeat.png` | ícones |

`bash scripts/install-desktop.sh --remove` desfaz tudo isso e mantém `~/.config/offbeat`. O AppImage precisa do `libfuse2t64`, que já vem no Mint 22.

- **Tempo:** a compilação de release leva ~1,5 min; o empacotamento do AppImage leva vários minutos a mais, porque o `linuxdeploy` copia as bibliotecas do GTK/WebKit e comprime ~490 MB de sidecars. Não está travado. Na primeira vez, o Tauri baixa o `linuxdeploy` para `~/.cache/tauri/`.
- **Tamanho:** o AppImage da 0.1.0 tem 282 MB.

- Os sidecars vão juntos (~490 MB descompactados; o ffmpeg estático sozinho tem ~177 MB). O .deb da 0.1.0 ficou com 222 MB, muito acima dos ~10 MB estimados no planejamento, que não contavam os binários.
- No .deb, o Tauri instala os sidecars em `/usr/bin` com os nomes `yt-dlp`, `ffmpeg`, `ffprobe` e `deno`, o que conflita com os pacotes do sistema de mesmo nome. Prefira o AppImage até isso ser resolvido.
- **Licenças nos pacotes:** `bundle.resources` do [tauri.conf.json](../src-tauri/tauri.conf.json) instala `LICENSE`, `NOTICE` e os textos de `src-tauri/binaries/` (`THIRD-PARTY-LICENSES.txt`, `YT-DLP-*`, `FFMPEG-LICENSE.txt`, `FFMPEG-SOURCE.txt`, `DENO-LICENSE.md`) na pasta `licenses/` dos recursos do app. O `npm run binaries` baixa e gera esses arquivos; sem eles nem o `cargo build` passa. O `beforeBuildCommand` roda `npm run licenses` para refazer o `THIRD-PARTY-LICENSES.txt` a partir do `Cargo.lock` e do `package-lock.json`.

### Publicar uma release com binários

Subir só o código não distribui nenhum binário e não tem obrigação extra. Ao anexar AppImage, .deb ou .rpm a uma release do GitHub, o app passa a distribuir o ffmpeg (GPL) e as bibliotecas do sistema (LGPL), então:

1. Rode `npm run binaries -- --force` e `npm run tauri build` na mesma hora, para as licenças e o `FFMPEG-SOURCE.txt` baterem com os binários.
2. Anexe à mesma release o código-fonte do ffmpeg empacotado (a GPL pede que ele fique disponível enquanto o binário estiver):

```bash
C=$(sed -n 's#.*ffmpeg.git/commit/##p' src-tauri/binaries/FFMPEG-SOURCE.txt)
git clone --filter=blob:none https://git.ffmpeg.org/ffmpeg.git /tmp/ffmpeg-src
git -C /tmp/ffmpeg-src archive --prefix="ffmpeg-$C/" "$C" | xz > "ffmpeg-source-$C.tar.xz"
git clone --depth 1 https://github.com/yt-dlp/FFmpeg-Builds /tmp/ffmpeg-builds
tar -C /tmp -cJf ffmpeg-builds-scripts.tar.xz --exclude=.git ffmpeg-builds
```

3. Confira que `licenses/` aparece dentro do pacote (no .deb, em `/usr/lib/Offbeat/licenses/`; no AppImage, extraia com `--appimage-extract` e procure a pasta `licenses`).

## Ícone

A fonte é [src-tauri/icons/app-icon.svg](../src-tauri/icons/app-icon.svg). Para regenerar os PNGs:

```bash
npx tauri icon src-tauri/icons/app-icon.svg -o src-tauri/icons
```

Mantenha só os arquivos listados em `bundle.icon` do `tauri.conf.json` e apague os de Windows, macOS, iOS e Android.
