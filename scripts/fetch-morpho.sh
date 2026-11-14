#!/usr/bin/env bash
# Fetches and builds the exact upstream Morpho code Ballast deploys on Mezo testnet (pinned tags/commits), for london.
#   morpho-blue      v1.0.0  55d2d99304fb3fb930c688462ae2ccabb1d533ad
#   morpho-blue-irm  v1.0.0  a7d9cce3451b4a106bfd40933ac57a785b5228f3
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .upstream && cd .upstream
[ -d morpho-blue ] || git -c advice.detachedHead=false clone -q --depth 1 --branch v1.0.0 https://github.com/morpho-org/morpho-blue.git morpho-blue
[ -d morpho-blue-irm ] || git -c advice.detachedHead=false clone -q --depth 1 --branch v1.0.0 https://github.com/morpho-org/morpho-blue-irm.git morpho-blue-irm
[ "$(git -C morpho-blue rev-parse HEAD)" = "55d2d99304fb3fb930c688462ae2ccabb1d533ad" ] || { echo "morpho-blue commit mismatch"; exit 1; }
[ "$(git -C morpho-blue-irm rev-parse HEAD)" = "a7d9cce3451b4a106bfd40933ac57a785b5228f3" ] || { echo "morpho-blue-irm commit mismatch"; exit 1; }
mkdir -p morpho-blue-irm/lib/morpho-blue && cp -r morpho-blue/src morpho-blue-irm/lib/morpho-blue/
(cd morpho-blue && FOUNDRY_PROFILE=build forge build --evm-version london --skip test --skip script >/dev/null)
(cd morpho-blue-irm && forge build src/AdaptiveCurveIrm.sol --evm-version london >/dev/null)
echo "built .upstream/morpho-blue/out/Morpho.sol/Morpho.json and .upstream/morpho-blue-irm/out/AdaptiveCurveIrm.sol/AdaptiveCurveIrm.json"
