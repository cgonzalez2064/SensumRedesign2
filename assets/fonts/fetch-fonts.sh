#!/usr/bin/env bash
# ==============================================================
# Self-host Oswald + Roboto (Sensum Construcciones)
# --------------------------------------------------------------
# Run this from a machine with normal internet access (this could
# not be run inside the build sandbox that produced this repo —
# its network policy blocks fonts.googleapis.com/fonts.gstatic.com
# entirely). It downloads exactly the weights the site uses —
# Oswald 600/700, Roboto 400/500/600/700 — as WOFF2, Latin subset,
# into this folder, ready for assets/fonts/local-fonts.css.
#
# Usage:
#   cd assets/fonts
#   ./fetch-fonts.sh
#
# Requires: curl, and a shell that can parse the Google Fonts CSS2
# response (grep/sed, both POSIX-standard).
# ==============================================================
set -euo pipefail

UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
CSS_URL="https://fonts.googleapis.com/css2?family=Oswald:wght@600;700&family=Roboto:wght@400;500;600;700&display=swap"

echo "Fetching font manifest from Google Fonts..."
curl -sS -A "$UA" "$CSS_URL" -o /tmp/sensum-fonts.css

echo "Downloading WOFF2 files..."
grep -oE 'https://fonts\.gstatic\.com/[^)]+\.woff2' /tmp/sensum-fonts.css | sort -u | while read -r url; do
  # Name files by family+weight using the surrounding @font-face block so
  # they land as oswald-600.woff2, roboto-400.woff2, etc.
  block=$(awk -v u="$url" 'BEGIN{RS="}"} $0 ~ u {print $0"}"}' /tmp/sensum-fonts.css)
  family=$(echo "$block" | grep -oE "font-family: *'[^']+'" | head -1 | sed -E "s/font-family: *'([^']+)'/\1/" | tr '[:upper:]' '[:lower:]')
  weight=$(echo "$block" | grep -oE 'font-weight: *[0-9]+' | head -1 | grep -oE '[0-9]+')
  out="${family}-${weight}.woff2"
  echo "  -> $out"
  curl -sS "$url" -o "$out"
done

echo "Done. Files are in $(pwd)."
echo "Next step: in index.html, replace the Google Fonts <link> block with:"
echo '  <link rel="stylesheet" href="assets/fonts/local-fonts.css">'
echo "(remove the two fonts.googleapis.com/fonts.gstatic.com preconnect tags"
echo "and the fonts.googleapis.com stylesheet link once local-fonts.css is confirmed working)."
