# Receitas

Galho de [AGENTS.md](../AGENTS.md). Passo a passo de tarefas que se repetem. Todas terminam com a [verificação](development.md#verificação-obrigatória-antes-do-commit), o commit e a documentação.

## Atualizar o app instalado

O app do usuário é o AppImage em `~/Applications/Offbeat.AppImage`, com atalho no menu. Depois de mudanças que ele vai usar:

```bash
npm run tauri build -- --bundles appimage   # ~1,5 min compilando + vários minutos empacotando
npm run install-desktop                     # substitui o AppImage instalado
```

- **Avise antes que leva cerca de 10 minutos.** A compilação é rápida; o `linuxdeploy` copia as bibliotecas do GTK/WebKit e comprime ~490 MB de sidecars, sem mostrar progresso. Não está travado. Para conferir, veja se `linuxdeploy`, `appimagetool` ou `mksquashfs` estão rodando (`ps -eo etime,pcpu,cmd | grep -E "linuxdeploy|appimagetool|mksquashfs"`).
- Rode o build em segundo plano e espere ele terminar, sem consultar a saída a toda hora: o `tauri build` só escreve no fim.
- Se o app estiver aberto, o `install` substitui o arquivo mesmo assim. A versão nova vale na próxima vez que o app for aberto.
- Não use o `.deb` (conflita com os pacotes `yt-dlp` e `ffmpeg` do sistema).

## Comandos que precisam de sudo

O agente não tem `sudo`. Peça ao usuário para rodar o comando no prompt com `!` na frente (ex.: `! sudo apt install …`), que a saída volta para a sessão. Não tente contornar extraindo pacotes à mão: as bibliotecas soltas quebram o empacotamento do AppImage (o plugin GTK do `linuxdeploy` falha).

## Depois do teste no relógio (M4A no GT 5)

Pendência do [ROADMAP](../ROADMAP.md): mandar faixas do perfil Original (M4A) e do Equilibrado (MP3) pelo Huawei Health e ver se tocam, se mostram título e capa e quanto ocupam.

**Se o GT 5 tocar M4A**, o Original vira o padrão:

1. Em [settings.rs](../src-tauri/src/settings.rs), `Settings::defaults`: troque `Profile::Balanced` por `Profile::Original` e atualize o comentário acima dele. Acrescente um teste no mesmo arquivo que confira o perfil padrão (hoje não há um).
2. Quem já tem `settings.json` mantém o perfil salvo; só instalações novas mudam. Não force a troca.
3. Mova a marca "(padrão)"/"(default)" nas tabelas de perfis de [README.md](../README.md), [README.pt-BR.md](../README.pt-BR.md), [ytdlp.md](ytdlp.md#perfis) e [architecture.md](architecture.md#configurações), e ajuste a frase "Original … exige um relógio que toque M4A".
4. Registre o resultado do teste (o que tocou, se mostrou capa e título, tamanho real) em [ytdlp.md](ytdlp.md), no CHANGELOG e no ROADMAP (tire a pendência).

**Se não tocar**, mantenha o Equilibrado, registre o resultado do mesmo jeito e deixe claro no texto do perfil Original, nas Configurações (`profile.originalDesc` em [pt-BR.ts](../src/i18n/pt-BR.ts) e [en-US.ts](../src/i18n/en-US.ts)), que o GT 5 não toca M4A.

## Atualizar o yt-dlp (quando o YouTube quebrar)

Para o usuário, o botão **Atualizar yt-dlp** nas Configurações resolve sem reinstalar. Para o código e os próximos pacotes:

1. `npm run binaries -- --force` baixa os releases mais recentes, conferidos por SHA-256.
2. Teste uma pré-visualização e um download no `npm run tauri dev`, com um vídeo e um álbum do YouTube Music.
3. Confira se as mensagens de erro mudaram de texto (ex.: "Video unavailable" virou "This video is unavailable" no 2026.10.26) e acrescente os casos em [errors.ts](../src/lib/errors.ts) e [tests/errors.test.ts](../tests/errors.test.ts).
4. Atualize o app instalado (receita acima). Atualize também a versão citada em [ytdlp.md](ytdlp.md).

## Adicionar um texto traduzido

1. Acrescente a chave em [pt-BR.ts](../src/i18n/pt-BR.ts) e em [en-US.ts](../src/i18n/en-US.ts). Sem ela no en-US, não compila.
2. Use `t('area.chave')` ou `t('area.chave', { nome })` com `{nome}` nos dois textos (um teste confere).

## Adicionar um comando do backend

1. Escreva o tipo e a função em [src/lib/api.ts](../src/lib/api.ts).
2. Crie o `#[tauri::command]` em Rust com o `serde` em camelCase igual ao TS, e registre-o em `lib.rs` (`generate_handler!`).
3. Lógica pura vai para `ytdlp.rs` (ou um módulo novo) com testes. Valide toda entrada que vier do front.
4. Não dê permissões novas ao WebView em [capabilities/default.json](../src-tauri/capabilities/default.json) se o backend puder fazer o trabalho.
5. Documente na tabela de comandos de [architecture.md](architecture.md#comandos).

## Testar a interface de verdade

Para testar sem tocar nas configurações, no histórico nem na pasta de música do usuário: rode o app com `XDG_CONFIG_HOME`, `XDG_CACHE_HOME` e `XDG_DATA_HOME` temporários e uma pasta de saída temporária. Se o app fechar com "Could not create GBM EGL display", rode com `WEBKIT_DISABLE_DMABUF_RENDERER=1`. Para encerrar só a instância de teste, use `pkill -f '^\./target/debug/offbeat$'`: o app instalado também se chama `offbeat`, e um padrão solto encerra o próprio comando. Para inspecionar a página: `WEBKIT_INSPECTOR_HTTP_SERVER=127.0.0.1:9223` (veja [development.md](development.md#depurar-o-webview)). No WebSocket, espere o evento `Target.targetCreated` e mande cada comando embrulhado em `Target.sendMessageToTarget` (`{targetId, message: "<JSON do comando>"}`); as respostas chegam em `Target.dispatchMessageFromTarget`. `Runtime.evaluate` não espera promessas, então rode código síncrono e consulte de novo até o estado mudar. Para clicar e digitar, é mais confiável fazer pelo próprio JS da página (`button.click()`, o setter de `value` do `HTMLInputElement` + evento `input`, `form.requestSubmit()`) do que pelo `xdotool`. `Page.snapshotRect` `{x: 0, y: 0, width: 560, height: 720, coordinateSystem: "Viewport"}` devolve um PNG da página em `dataURL`. Cliques e teclas com `xdotool` funcionam em X11. Use coordenadas absolutas (`xwininfo`), porque a posição relativa do `xdotool getwindowgeometry` desconta a decoração da janela errado. Capture a tela com `ffmpeg -f x11grab`, porque o `xwd` sai em branco com o WebKit.
