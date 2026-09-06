#!/usr/bin/env bash
# Builds and packages a private-build .ehpk for Even Hub.
#
# This script only does the LOCAL, automatable half of a release. The rest —
# uploading the .ehpk and installing it on a phone — is a manual web/app flow
# with no CLI equivalent (confirmed against hub.evenrealities.com/docs: pack
# is CLI-only, upload is portal-only). See CLAUDE.md's "Even Hub プライベート
# ビルド登録手順" for the full checklist, including that manual half.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./app.json').version")
OUT_DIR="releases"
OUT_FILE="${OUT_DIR}/chorus-prompter-v${VERSION}.ehpk"

mkdir -p "$OUT_DIR"

if [ -f "$OUT_FILE" ]; then
  echo "error: ${OUT_FILE} already exists." >&2
  echo "Even Hub requires the version to increase on every re-upload (semver, in app.json)." >&2
  echo "Bump \"version\" in app.json before releasing again." >&2
  exit 1
fi

echo "==> Building (version ${VERSION})"
npm run build

SDK_VERSION=$(node -p "require('./package.json').dependencies['@evenrealities/even_hub_sdk'].replace(/^[^0-9]*/, '')")

echo "==> Packaging (pinned against SDK ${SDK_VERSION} — see package.json)"
npx evenhub pack app.json dist -o "$OUT_FILE" --sdk-ver "$SDK_VERSION"

echo ""
echo "==> Done: ${OUT_FILE}"
echo ""
echo "Next (manual, in a browser + on the phone):"
echo "  1. https://hub.evenrealities.com/login — sign in, open this app's project"
echo "  2. \"Private builds\" tab — upload ${OUT_FILE}"
echo "  3. On the phone: Even Realities app → Even Hub tab (Developer Mode) →"
echo "     Me → Apps → Private builds — find this version and tap Install"
