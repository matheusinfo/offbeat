# Offbeat: guia para agentes de IA

Tronco da documentação. Leia este arquivo inteiro primeiro e depois só o galho de `docs/` ligado à sua tarefa (veja o mapa abaixo).

Offbeat é um app desktop para Linux (Tauri 2 + React 19 + TypeScript, backend em Rust) que baixa o áudio de vídeos, playlists e álbuns do YouTube e do YouTube Music com o yt-dlp e salva arquivos pequenos, com tags e capa, prontos para ir ao relógio (Huawei GT 5) pelo Huawei Health. Tudo roda na máquina: sem servidor, conta ou telemetria. A interface tem pt-BR e en-US.

## Regras de trabalho

1. **Toda funcionalidade ou correção termina com um commit e a documentação atualizada**, no mesmo commit:
   - [README.md](README.md) (inglês) e [README.pt-BR.md](README.pt-BR.md): páginas para usuários. Atualize as duas. Se a tela mudou visivelmente, atualize as capturas em `docs/images/` (veja [docs/ui-conventions.md](docs/ui-conventions.md#capturas-de-tela)).
   - [CHANGELOG.md](CHANGELOG.md): o item, em linguagem de usuário, na seção da próxima versão.
   - [ROADMAP.md](ROADMAP.md): marque o que foi feito e remova da lista de pendências.
   - O galho de `docs/` afetado. Se surgir um conceito novo, crie um galho e registre-o no mapa abaixo.
2. Commits em inglês, no estilo conventional commits do histórico (`feat:`, `fix:`, `build:`, `docs:`, `chore:`): título curto e corpo com bullets. Um commit por funcionalidade. **Sem linha de co-autoria.**
3. **Verifique antes de commitar**: os comandos de [docs/development.md](docs/development.md#verificação-obrigatória-antes-do-commit), sem erros nem warnings novos. Lógica nova testável ganha teste (`tests/` no front, `#[cfg(test)]` no Rust).
4. Mudança visual ou de fluxo pede teste no app (`npm run tauri dev`) com um vídeo curto e uma playlist pequena. Se não deu para testar, diga isso claramente em vez de afirmar que funciona.
5. Não quebre a promessa de privacidade: nenhuma chamada de rede própria do app. Os únicos acessos são os do yt-dlp: ao YouTube, ao SponsorBlock (quando o usuário liga) e ao GitHub (só no clique em "Atualizar yt-dlp"). Veja [docs/architecture.md](docs/architecture.md#segurança-e-privacidade).
6. **O usuário usa o app instalado** (AppImage em `~/Applications`, atalho no menu). Depois de mudanças que ele vai usar, atualize a instalação ([docs/recipes.md](docs/recipes.md#atualizar-o-app-instalado)) e **avise antes que o empacotamento leva cerca de 10 minutos**, para não parecer travado.
7. O agente não tem `sudo`: peça ao usuário para rodar esses comandos com `!` no prompt ([docs/recipes.md](docs/recipes.md#comandos-que-precisam-de-sudo)).

## Estado atual

- **Versão 0.1.0** (MVP do planejamento + YouTube Music), instalada como AppImage na máquina do usuário. Testada no app com vídeo, álbum do YouTube Music, cancelamento, erros e troca de idioma.
- Depois do MVP (ainda na 0.1.0, não publicada): vários links de uma vez, "Só esta faixa", volume igual, capítulos em faixas, histórico (pular já baixadas), playlists salvas com sincronização, atualizar o yt-dlp pelo app e notificação de fila concluída. Testados numa instância isolada com o álbum CC de Kevin MacLeod e um vídeo CC com 20 capítulos. A atualização de fato do yt-dlp só foi vista pela linha de comando (no app, a versão já era a mais recente).
- **Teste no relógio (9/11/2026):** as 119 faixas MP3 do perfil Equilibrado, baixadas com o app instalado, tocaram no GT 5. O Equilibrado continua o padrão. **Falta só testar M4A** (perfil Original): se tocar, ele pode virar o padrão ([docs/recipes.md](docs/recipes.md#depois-do-teste-no-relógio-m4a-no-gt-5)).
- Próximas ideias, em ordem, no [ROADMAP.md](ROADMAP.md).

## Comandos

```bash
npm run binaries          # baixa yt-dlp, ffmpeg, ffprobe e Deno para src-tauri/binaries/
npm run tauri dev         # app com recarga do front
npm run typecheck         # tsc
npm test                  # vitest (tests/)
npm run build             # tsc + vite build
npm run tauri build       # AppImage, .deb e .rpm
npm run install-desktop   # instala o AppImage para o usuário (menu + comando offbeat)
cd src-tauri && cargo test && cargo clippy --all-targets -- -D warnings && cargo fmt --check
```

## Mapa do código

```
src/lib/api.ts              contrato com o backend: tipos e comandos (espelhados em Rust)
src/App.tsx                 tela única, carga das configurações, executor da fila (2 downloads por vez)
src/components/             UrlInput, Preview (+ LinkStatus), SavedPlaylists, Queue, Settings (modal), ErrorNote
src/lib/                    lógica pura e testada: ytdlp (URL, estimativa), progress (linhas PROG/POST/DONE),
                            queue (reducer da fila), previews (links colados → itens da fila),
                            errors (classifica o stderr), format (Intl)
src/i18n/                   pt-BR.ts (fonte das chaves), en-US.ts, translate.ts, index.tsx (provider)
src/styles.css              tokens de cor claro/escuro (segue o sistema)
src-tauri/src/lib.rs        builder do Tauri, plugins, estado, limpeza da pasta temporária
src-tauri/src/downloads.rs  comandos preview, download, cancel_download, open_output_dir, output_dir_size,
                            history_count, clear_history
src-tauri/src/history.rs    histórico de downloads (~/.local/share/offbeat/history.txt) e id do vídeo pela URL
src-tauri/src/playlists.rs  playlists salvas (playlists.json) e seus comandos
src-tauri/src/updater.rs    atualizar o yt-dlp pelo app (cópia em ~/.local/share/offbeat/bin, yt-dlp -U)
src-tauri/src/notify.rs     notificação do sistema pelo D-Bus quando a fila termina
src-tauri/src/ytdlp.rs      funções puras: validação de URL, argumentos do yt-dlp, leitura do JSON de preview
src-tauri/src/process.rs    processos em grupo próprio, leitura de linhas, timeout e kill
src-tauri/src/settings.rs   ~/.config/offbeat/settings.json (validação e gravação atômica)
src-tauri/src/sidecar.rs    caminhos dos sidecars e tool_versions (do yt-dlp em uso)
src-tauri/tauri.conf.json   janela, CSP, bundle e externalBin
src-tauri/capabilities/     permissões do WebView (mínimas)
scripts/fetch-binaries.sh   baixa e confere (SHA-256) os sidecars e salva as licenças deles
scripts/third-party-licenses.mjs
                            gera THIRD-PARTY-LICENSES.txt (licenças das crates e pacotes npm embutidos)
scripts/install-desktop.sh  instala o AppImage em ~/Applications com atalho no menu (--remove desinstala)
```

## Galhos da documentação

| Galho | Leia quando for… |
|---|---|
| [docs/architecture.md](docs/architecture.md) | mexer no fluxo entre front e backend, comandos, estado, segurança ou caminhos no disco |
| [docs/ytdlp.md](docs/ytdlp.md) | mudar argumentos do yt-dlp, perfis de tamanho, capa/tags, formato das linhas de progresso, erros ou suporte a YouTube Music |
| [docs/ui-conventions.md](docs/ui-conventions.md) | criar ou alterar componentes, textos (i18n), cores, acessibilidade ou capturas de tela |
| [docs/development.md](docs/development.md) | preparar a máquina, rodar, verificar, empacotar ou trocar o ícone |
| [docs/recipes.md](docs/recipes.md) | seguir o passo a passo de tarefas comuns: atualizar o app instalado, agir após o teste no relógio, atualizar o yt-dlp, novo texto, novo comando, testar a interface |
| [docs/planning.md](docs/planning.md) | entender a motivação e as decisões originais (documento de planejamento, não é atualizado) |

## Convenções essenciais

- **O front nunca monta argumentos nem escolhe caminhos.** Ele manda URL, id e posição na playlist; o backend lê as configurações salvas e monta o comando. Argumentos sempre como lista, com `--` antes da URL.
- **Contrato único:** qualquer mudança em comando ou tipo vai em [src/lib/api.ts](src/lib/api.ts) e no `serde` correspondente em Rust, no mesmo commit.
- **Texto visível** sempre vem de `t('chave')`. A chave nasce em [pt-BR.ts](src/i18n/pt-BR.ts) e precisa existir em [en-US.ts](src/i18n/en-US.ts) (senão não compila).
- **Lógica pura** fica em `src/lib/` (front) ou `ytdlp.rs` (Rust) e ganha teste.
- Código, nomes e comentários em inglês. Comentários curtos, explicando o porquê.
- Não adicione dependências sem necessidade clara. A UI usa CSS simples e `lucide-react`.
