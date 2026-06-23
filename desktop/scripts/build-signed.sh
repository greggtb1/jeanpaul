#!/usr/bin/env bash
#
# Build + signature Developer ID + notarisation Apple de l'agent desktop.
#
# Prérequis (variables d'environnement, JAMAIS commitées) :
#   APPLE_SIGNING_IDENTITY  "Developer ID Application: Ton Nom (TEAMID)"
#   APPLE_ID                ton@email.com
#   APPLE_PASSWORD          mot de passe d'application (appleid.apple.com)
#   APPLE_TEAM_ID           TEAMID (ex. A1B2C3D4E5)
#
# Optionnel :
#   VITE_API_ORIGIN         origine API (def. https://blowmyjob.fr)
#
# Usage :
#   export APPLE_SIGNING_IDENTITY="Developer ID Application: ... (TEAMID)"
#   export APPLE_ID="..." APPLE_PASSWORD="..." APPLE_TEAM_ID="..."
#   bash desktop/scripts/build-signed.sh
#
set -euo pipefail

DESKTOP="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DESKTOP"

: "${VITE_API_ORIGIN:=https://blowmyjob.fr}"

missing=()
for var in APPLE_SIGNING_IDENTITY APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID; do
  if [[ -z "${!var:-}" ]]; then missing+=("$var"); fi
done
if (( ${#missing[@]} )); then
  echo "❌ Variables manquantes : ${missing[*]}" >&2
  echo "   Renseigne-les (voir l'entête de ce script) puis relance." >&2
  exit 1
fi

echo "==> Identité de signature : $APPLE_SIGNING_IDENTITY"
echo "==> API origin            : $VITE_API_ORIGIN"

# 1. Sidecar Python
echo "==> Build du sidecar…"
bash "$DESKTOP/scripts/build-sidecar.sh"

# 2. Build Tauri (signe + notarise + staple automatiquement quand ces env sont présentes)
echo "==> Build Tauri + notarisation…"
VITE_API_ORIGIN="$VITE_API_ORIGIN" \
APPLE_SIGNING_IDENTITY="$APPLE_SIGNING_IDENTITY" \
APPLE_ID="$APPLE_ID" \
APPLE_PASSWORD="$APPLE_PASSWORD" \
APPLE_TEAM_ID="$APPLE_TEAM_ID" \
  npm run tauri:build

DMG=$(ls -t "$DESKTOP/src-tauri/target/release/bundle/dmg/"*.dmg 2>/dev/null | head -1 || true)
if [[ -n "$DMG" ]]; then
  echo "==> Vérification du staple…"
  xcrun stapler validate "$DMG" || echo "⚠️  Staple non validé (vérifie les logs de notarisation ci-dessus)."
  echo "✅ DMG signé + notarisé : $DMG"
else
  echo "⚠️  Aucun DMG trouvé." >&2
fi
