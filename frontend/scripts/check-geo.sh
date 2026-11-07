#!/usr/bin/env bash
# Hard rule 7: coordinates are converted ONLY in src/lib/geo.ts.
# Fails if any other source file builds or unpacks a coordinate pair by hand:
#   [x.lon, x.lat]   [p.lat, p.lon]   { lng: ..., lat: ... }   { lat: ..., lon: ... }   .lng / .lon access
# Generated types and tests are excluded. src/panels/ is Varad's folder: hits there are printed as an
# advisory (to tell him) but never fail this check, because we can't edit that folder.
set -u
cd "$(dirname "$0")/.."
PATTERN='\.lon\b|\.lng\b|\blng\s*:|\blon\s*:|\blat\s*:'
hits=$(grep -rnE "$PATTERN" src \
  --exclude=api.ts --exclude='*.test.ts' --exclude='*.test.tsx' --exclude=geo.ts \
  --exclude-dir=panels || true)
panel_hits=$(grep -rnE "$PATTERN" src/panels 2>/dev/null || true)
if [ -n "$panel_hits" ]; then
  echo "advisory (src/panels is Varad's, not enforced here):"
  echo "$panel_hits"
fi
if [ -n "$hits" ]; then
  echo "Hand-built coordinates found outside src/lib/geo.ts. Use the helpers instead:"
  echo "$hits"
  exit 1
fi
echo "geo check OK: no hand-built coordinates outside lib/geo.ts"
