#!/usr/bin/env bash
# Downloads the sidecars Tauri bundles with the app (externalBin in
# src-tauri/tauri.conf.json) into src-tauri/binaries/, named with the target
# triple suffix Tauri expects. Every download is checked against the SHA-256
# list published in the same release.
#
#   bash scripts/fetch-binaries.sh            # skip binaries already present
#   bash scripts/fetch-binaries.sh --force    # download everything again
#
# Sources:
#   yt-dlp   github.com/yt-dlp/yt-dlp           standalone build, no Python needed
#   ffmpeg   github.com/yt-dlp/FFmpeg-Builds    static GPL build with libmp3lame
#   ffprobe  same archive as ffmpeg             yt-dlp needs it to read the codec
#   deno     github.com/denoland/deno           JS runtime yt-dlp uses for YouTube
#
# It also saves the license texts of the installed versions, which the
# packages ship (bundle.resources in tauri.conf.json), and regenerates
# THIRD-PARTY-LICENSES.txt for the Rust crates and npm packages.
set -euo pipefail

FORCE=0
[[ "${1:-}" == "--force" ]] && FORCE=1

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/src-tauri/binaries"
mkdir -p "$DEST"

case "$(uname -m)" in
  x86_64)
    TRIPLE=x86_64-unknown-linux-gnu
    YTDLP_ASSET=yt-dlp_linux
    FFMPEG_ASSET=ffmpeg-master-latest-linux64-gpl
    DENO_ASSET=deno-x86_64-unknown-linux-gnu
    ;;
  aarch64)
    TRIPLE=aarch64-unknown-linux-gnu
    YTDLP_ASSET=yt-dlp_linux_aarch64
    FFMPEG_ASSET=ffmpeg-master-latest-linuxarm64-gpl
    DENO_ASSET=deno-aarch64-unknown-linux-gnu
    ;;
  *)
    echo "Unsupported architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# A real binary is several MB; anything smaller is a build placeholder.
needs() {
  local f="$DEST/$1-$TRIPLE"
  [[ $FORCE == 1 || ! -f "$f" || $(stat -c %s "$f") -lt 1000000 ]]
}

fetch() {
  echo "  ↓ $1"
  curl -fL --proto '=https' --tlsv1.2 --retry 3 -sS -o "$2" "$1"
}

# Checks $file against the line for $name in a "<hash>  <name>" list.
verify() {
  local file="$1" name="$2" sums="$3" expected actual
  expected="$(awk -v n="$name" '{ f=$2; sub(/^\*/, "", f) } f == n { print $1; exit }' "$sums")"
  if [[ -z "$expected" ]]; then
    echo "No checksum for $name" >&2
    exit 1
  fi
  actual="$(sha256sum "$file" | awk '{ print $1 }')"
  if [[ "$expected" != "$actual" ]]; then
    echo "Checksum mismatch for $name" >&2
    exit 1
  fi
  echo "  ✓ sha256 $name"
}

install_bin() {
  install -m 755 "$1" "$DEST/$2-$TRIPLE"
  echo "  → src-tauri/binaries/$2-$TRIPLE"
}

if needs yt-dlp; then
  echo "yt-dlp"
  base=https://github.com/yt-dlp/yt-dlp/releases/latest/download
  fetch "$base/$YTDLP_ASSET" "$WORK/$YTDLP_ASSET"
  fetch "$base/SHA2-256SUMS" "$WORK/yt-dlp.sums"
  verify "$WORK/$YTDLP_ASSET" "$YTDLP_ASSET" "$WORK/yt-dlp.sums"
  install_bin "$WORK/$YTDLP_ASSET" yt-dlp
fi

if needs ffmpeg || needs ffprobe; then
  echo "ffmpeg + ffprobe"
  base=https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest
  fetch "$base/$FFMPEG_ASSET.tar.xz" "$WORK/$FFMPEG_ASSET.tar.xz"
  fetch "$base/checksums.sha256" "$WORK/ffmpeg.sums"
  verify "$WORK/$FFMPEG_ASSET.tar.xz" "$FFMPEG_ASSET.tar.xz" "$WORK/ffmpeg.sums"
  tar -xJf "$WORK/$FFMPEG_ASSET.tar.xz" -C "$WORK" \
    "$FFMPEG_ASSET/bin/ffmpeg" "$FFMPEG_ASSET/bin/ffprobe" "$FFMPEG_ASSET/LICENSE.txt"
  install_bin "$WORK/$FFMPEG_ASSET/bin/ffmpeg" ffmpeg
  install_bin "$WORK/$FFMPEG_ASSET/bin/ffprobe" ffprobe
  # The GPL asks us to ship the license with the binary.
  install -m 644 "$WORK/$FFMPEG_ASSET/LICENSE.txt" "$DEST/FFMPEG-LICENSE.txt"
fi

if needs deno; then
  echo "deno"
  base=https://github.com/denoland/deno/releases/latest/download
  fetch "$base/$DENO_ASSET.zip" "$WORK/$DENO_ASSET.zip"
  fetch "$base/$DENO_ASSET.zip.sha256sum" "$WORK/deno.sums"
  verify "$WORK/$DENO_ASSET.zip" "$DENO_ASSET.zip" "$WORK/deno.sums"
  unzip -q -o "$WORK/$DENO_ASSET.zip" deno -d "$WORK"
  install_bin "$WORK/deno" deno
fi

echo
echo "Versions:"
"$DEST/yt-dlp-$TRIPLE" --version | sed 's/^/  yt-dlp  /'
"$DEST/ffmpeg-$TRIPLE" -version | head -1 | sed 's/^/  /'
"$DEST/deno-$TRIPLE" --version | head -1 | sed 's/^/  /'

# Licenses always follow the installed versions, so they are fetched every
# time (a few KB). The packages must carry them next to the binaries.
echo
echo "Licenses"
YTDLP_VERSION="$("$DEST/yt-dlp-$TRIPLE" --version)"
DENO_VERSION="$("$DEST/deno-$TRIPLE" --version | awk 'NR == 1 { print $2 }')"
raw=https://raw.githubusercontent.com
fetch "$raw/yt-dlp/yt-dlp/$YTDLP_VERSION/LICENSE" "$DEST/YT-DLP-LICENSE.txt"
fetch "$raw/yt-dlp/yt-dlp/$YTDLP_VERSION/THIRD_PARTY_LICENSES.txt" "$DEST/YT-DLP-THIRD-PARTY-LICENSES.txt"
fetch "$raw/denoland/deno/v$DENO_VERSION/LICENSE.md" "$DEST/DENO-LICENSE.md"

# The GPL asks for the exact source of the ffmpeg we ship. The version line
# names the FFmpeg commit (N-<n>-g<hash>-<date>).
FFMPEG_VERSION="$("$DEST/ffmpeg-$TRIPLE" -version | awk 'NR == 1 { print $3 }')"
FFMPEG_COMMIT="$(sed -nE 's/^N-[0-9]+-g([0-9a-f]+).*/\1/p' <<<"$FFMPEG_VERSION")"
cat >"$DEST/FFMPEG-SOURCE.txt" <<SRC
ffmpeg and ffprobe $FFMPEG_VERSION ($FFMPEG_ASSET)
Static GPL build by https://github.com/yt-dlp/FFmpeg-Builds

FFmpeg source of this build:
  https://git.ffmpeg.org/gitweb/ffmpeg.git/commit/${FFMPEG_COMMIT:-$FFMPEG_VERSION}
Build scripts and the versions of the libraries linked into it:
  https://github.com/yt-dlp/FFmpeg-Builds
The full source is also available from the Offbeat release that shipped
this binary (ffmpeg-source-*.tar.xz).
SRC
echo "  ✓ FFMPEG-SOURCE.txt ($FFMPEG_VERSION)"
node "$ROOT/scripts/third-party-licenses.mjs"
