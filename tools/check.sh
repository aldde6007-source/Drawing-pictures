#!/bin/sh
# JS の構文チェックと JSON のチェック。
# つかいかた: docker compose run --rm dev sh tools/check.sh
set -e
tmp=$(mktemp -d)
for f in js/*.js; do
  cp "$f" "$tmp/$(basename "$f" .js).mjs"
  node --check "$tmp/$(basename "$f" .js).mjs"
  echo "ok  $f"
done
node --check sw.js && echo "ok  sw.js"
python -m json.tool manifest.json > /dev/null && echo "ok  manifest.json"
rm -rf "$tmp"
