#!/usr/bin/env bash
# Installs the built AppImage for the current user, with no sudo:
#   ~/Applications/Offbeat.AppImage      the app
#   ~/.local/bin/offbeat                 command on the PATH
#   ~/.local/share/icons/hicolor/...     icons
#   ~/.local/share/applications/offbeat.desktop   menu entry
#
#   npm run tauri build -- --bundles appimage
#   bash scripts/install-desktop.sh            # or: npm run install-desktop
#   bash scripts/install-desktop.sh --remove   # uninstall (settings stay)
#
# The .deb is not used: it puts yt-dlp and ffmpeg in /usr/bin, which clashes
# with the distro packages of the same name.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APPS="$HOME/Applications"
BIN="$HOME/.local/bin"
ICONS="$HOME/.local/share/icons/hicolor"
DESKTOP="$HOME/.local/share/applications/offbeat.desktop"

refresh() {
  update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
  gtk-update-icon-cache -q "$ICONS" 2>/dev/null || true
}

if [[ "${1:-}" == "--remove" ]]; then
  rm -f "$APPS/Offbeat.AppImage" "$BIN/offbeat" "$DESKTOP" \
    "$ICONS/256x256/apps/offbeat.png" "$ICONS/128x128/apps/offbeat.png" "$ICONS/32x32/apps/offbeat.png"
  refresh
  echo "Offbeat removed. Settings in ~/.config/offbeat were kept."
  exit 0
fi

APPIMAGE="$(ls -t "$ROOT"/src-tauri/target/release/bundle/appimage/Offbeat_*.AppImage 2>/dev/null | head -1 || true)"
if [[ -z "$APPIMAGE" ]]; then
  echo "No AppImage found. Build it first: npm run tauri build -- --bundles appimage" >&2
  exit 1
fi

mkdir -p "$APPS" "$BIN" "$(dirname "$DESKTOP")" \
  "$ICONS/256x256/apps" "$ICONS/128x128/apps" "$ICONS/32x32/apps"

install -m 755 "$APPIMAGE" "$APPS/Offbeat.AppImage"
ln -sf "$APPS/Offbeat.AppImage" "$BIN/offbeat"
install -m 644 "$ROOT/src-tauri/icons/128x128@2x.png" "$ICONS/256x256/apps/offbeat.png"
install -m 644 "$ROOT/src-tauri/icons/128x128.png" "$ICONS/128x128/apps/offbeat.png"
install -m 644 "$ROOT/src-tauri/icons/32x32.png" "$ICONS/32x32/apps/offbeat.png"

# StartupWMClass matches the window class Tauri sets ("offbeat"), so the
# running window groups under this menu entry.
cat > "$DESKTOP" <<EOF
[Desktop Entry]
Type=Application
Name=Offbeat
GenericName=Audio downloader
GenericName[pt_BR]=Baixador de áudio
Comment=Download YouTube and YouTube Music audio as small files for your watch
Comment[pt_BR]=Baixe o áudio do YouTube e do YouTube Music em arquivos pequenos para o relógio
Exec=$APPS/Offbeat.AppImage
Icon=offbeat
Terminal=false
Categories=AudioVideo;Audio;
Keywords=youtube;music;mp3;m4a;watch;huawei;
StartupWMClass=offbeat
EOF
refresh

echo "Installed $(basename "$APPIMAGE")"
echo "  menu:    Offbeat"
echo "  command: offbeat  (needs ~/.local/bin on the PATH)"
