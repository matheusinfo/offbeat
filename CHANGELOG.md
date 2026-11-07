# Notas de versão

## 0.1.0 (não publicada)

Primeira versão: o MVP do [planejamento](docs/planning.md).

### Funcionalidades

- **Colar e visualizar.** Cole um link do YouTube, do YouTube Music ou do youtu.be e veja capa, título, canal, duração, número de faixas e o tamanho estimado antes de baixar. Ao clicar no campo vazio, o link da área de transferência é colado sozinho.
- **Álbuns e playlists, inclusive do YouTube Music.** Links de playlist, de álbum (`browse/…`) e de música tocada dentro de uma lista viram uma fila com uma faixa por item, numeradas no nome do arquivo (`01 - `) e na tag de faixa.
- **Fila com progresso.** Dois downloads por vez, com barra, porcentagem, velocidade, tempo restante e "Convertendo…" enquanto o ffmpeg trabalha. Cancele uma faixa ou todas, tente de novo as que falharem, limpe as concluídas.
- **Perfis de tamanho.** Original (AAC copiado como M4A, sem recodificar), Equilibrado (MP3 V5, padrão) e Econômico (MP3 V7).
- **Tags e capa.** Título, artista, álbum e número da faixa embutidos, com capa quadrada de 300 px (sem as barras laterais das capas do YouTube Music).
- **Configurações.** Pasta de destino, perfil, padrão de nome ("Título" ou "Artista - Título"), SponsorBlock opcional para cortar trechos sem música e idioma (Sistema, Português (Brasil) ou English (US)).
- **Pasta.** Total da pasta no rodapé e botão "Abrir pasta" ao fim da fila.
- **Mensagens de erro claras** para bloqueio do YouTube, conteúdo privado, vídeo indisponível, falta de internet e HTTP 403, com os detalhes originais à mão.
- Tema claro e escuro seguindo o sistema.
