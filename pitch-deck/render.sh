#!/bin/bash
# Render every slides/*.html to render/NN.png at 2x via headless Chrome.
set -e
BD="$HOME/archdisc-deck"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
cd "$BD"
mkdir -p render
shopt -s nullglob
args=("$@")
files=()
if [ ${#args[@]} -gt 0 ]; then for a in "${args[@]}"; do files+=("slides/$a"); done
else files=(slides/*.html); fi
for f in "${files[@]}"; do
  base=$(basename "$f" .html)
  out="$BD/render/$base.png"
  rm -f "$out"
  "$CHROME" --headless=new --hide-scrollbars --disable-gpu --no-sandbox \
    --force-device-scale-factor=2 --window-size=1280,720 \
    --default-background-color=fafafaff \
    --virtual-time-budget=9000 \
    --screenshot="$out" "file://$BD/$f" >/dev/null 2>&1
  if [ -f "$out" ]; then
    dim=$(sips -g pixelWidth -g pixelHeight "$out" 2>/dev/null | awk '/pixel/{printf "%s ",$2}')
    echo "OK  $base.png  [$dim]"
  else
    echo "FAIL $base"
  fi
done
