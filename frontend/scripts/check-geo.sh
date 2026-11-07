#!/usr/bin/env bash
# Hard rule 7: coordinates are converted ONLY in src/lib/geo.ts.
# Fails if any other source file builds or unpacks a coordinate pair by hand:
#   [x.lon, x.lat]   [p.lat, p.lon]   { lng: ..., lat: ... }   { lat: ..., lon: ... }   .lng / .lon access
# Generated types and tests are excluded.
set -u
cd "$(dirname "$0")/.."
hits=$(grep -rnE '\.lon\b|\.lng\b|\blng\s*:|\blon\s*:|\blat\s*:' src \
  --exclude=api.ts --exclude='*.test.ts' --exclude='*.test.tsx' --exclude=geo.ts || true)
if [ -n "$hits" ]; then
  echo "Hand-built coordinates found outside src/lib/geo.ts. Use the helpers instead:"
  echo "$hits"
  exit 1
fi
echo "geo check OK: no hand-built coordinates outside lib/geo.ts"
