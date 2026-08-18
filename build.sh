#!/bin/sh
# Rebuilds the three site pages from src/.
#
# Each page in src/ is plain HTML with a single @@CSS@@ placeholder in its
# <head>. This script minifies src/style.css and pastes it into that spot, so
# the published pages carry their CSS inline -- no extra stylesheet request,
# which is what keeps the Core Web Vitals scores where they are.
#
# Edit files in src/, run `sh build.sh`, then commit the generated .html files.
set -e
cd "$(dirname "$0")"

CSS=$(tr '\n' ' ' < src/style.css \
  | sed -e 's/  */ /g' -e 's/ *\([{};:,>]\) */\1/g' -e 's/;}/}/g')

for page in index sky-scramble tetragrade; do
  awk -v css="$CSS" '{ gsub(/@@CSS@@/, css); print }' "src/$page.html" > "$page.html"
  echo "built $page.html"
done
