# Desenvolvimento

Galho de [AGENTS.md](../AGENTS.md). Como preparar a máquina, rodar, verificar e empacotar.

## Preparar a máquina (Linux Mint 22 / Ubuntu 24.04)

```bash
# Dependências do Tauri 2 (WebKitGTK 4.1, GTK 3, libsoup 3, OpenSSL)
sudo apt install build-essential curl wget file libwebkit2gtk-4.1-dev \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev

# Rust (rustup, em ~/.cargo)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Node 24 e as dependências do front
npm install

# Sidecars: yt-dlp, ffmpeg, ffprobe e Deno (~490 MB, conferidos por SHA-256)
npm run binaries
```

`npm run binaries` roda [scripts/fetch-binaries.sh](../scripts/fetch-binaries.sh), que baixa os releases mais recentes para `src-tauri/binaries/` com o sufixo da plataforma (`yt-dlp-x86_64-unknown-linux-gnu` etc.). A pasta é ignorada pelo git. Binários já presentes são mantidos. Use `--force` para baixar tudo de novo, por exemplo quando o YouTube quebrar o yt-dlp atual.

O `tauri-build` falha se algum arquivo de `externalBin` (em `tauri.conf.json`) faltar, então rode o script antes do primeiro `cargo build`.

## Comandos

```bash
npm run tauri dev        # app com recarga do front (Vite em 127.0.0.1:1420)
npm run typecheck        # tsc
npm test                 # vitest: tests/ (lógica pura do front)
npm run build            # tsc + vite build (dist/)
npm run tauri build      # AppImage, .deb e .rpm em src-tauri/target/release/bundle/

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
| `~/.local/share/offbeat/` | Reservado para o histórico (`--download-archive`) e o yt-dlp atualizado, ainda não usados |

## Empacotamento

`npm run tauri build` gera AppImage, .deb e .rpm. Para uso próprio, o AppImage basta.

- Os sidecars vão juntos (~490 MB descompactados; o ffmpeg estático sozinho tem ~177 MB). O .deb da 0.1.0 ficou com 222 MB, muito acima dos ~10 MB estimados no planejamento, que não contavam os binários.
- No .deb, o Tauri instala os sidecars em `/usr/bin` com os nomes `yt-dlp`, `ffmpeg`, `ffprobe` e `deno`, o que conflita com os pacotes do sistema de mesmo nome. Prefira o AppImage até isso ser resolvido.
- O ffmpeg é GPL: se publicar o app, inclua `src-tauri/binaries/FFMPEG-LICENSE.txt` e o link do código-fonte (veja [NOTICE](../NOTICE)).

## Ícone

A fonte é [src-tauri/icons/app-icon.svg](../src-tauri/icons/app-icon.svg). Para regenerar os PNGs:

```bash
npx tauri icon src-tauri/icons/app-icon.svg -o src-tauri/icons
```

Mantenha só os arquivos listados em `bundle.icon` do `tauri.conf.json` e apague os de Windows, macOS, iOS e Android.
