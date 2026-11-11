#!/usr/bin/env bash
# Builds the web UI and packs server/ into dist/phpmyflow-<version>.zip,
# ready to upload to any PHP host (like phpMyAdmin).
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(sed -n "s/^const PMF_VERSION = '\(.*\)';/\1/p" server/src/bootstrap.php)
NAME="phpmyflow-${VERSION}"

rm -rf server/assets server/index.html "dist/${NAME}" "dist/${NAME}.zip"
(cd web && npm ci && npm run build)

mkdir -p "dist/${NAME}"
cp -R server/. "dist/${NAME}/"
rm -f "dist/${NAME}/config.php"
cp README.md "dist/${NAME}/README.md"

(cd dist && zip -qr "${NAME}.zip" "${NAME}")
rm -rf "dist/${NAME}"
echo "Built dist/${NAME}.zip"
