#!/bin/bash
# Publishes the module with its environment (secrets) read from ~/.config/shotmatch, never from source.
# Usage: scripts/publish.sh [database]   (default shotmatch). Publishing keeps stored values, so plain
# `npm run publish` is enough once these are set. The CLI's error URLs carry a token, so output is redacted.
set -euo pipefail
db=${1:-shotmatch}
S=~/.config/shotmatch
cd "$(dirname "$0")/.."
NVIDIA_API_KEY="$(cat $S/nvidia_key)" ELEVENLABS_WEBHOOK_SECRET="$(cat $S/elevenlabs_webhook_secret)" \
  spacetime publish --server maincloud "$db" -y 2>&1 | sed -E 's/token=[^& ]*/token=REDACTED/g'
