#!/bin/bash
# Installs Ollama for the user on the Vultr VM (no sudo), runs it as a user service and pulls Nemotron 3.5 Bolt E4B.
# Run on the VM: bash ~/Code/hackathons/shotmatch/ops/ollama.sh
set -euo pipefail
dir=$HOME/.local/ollama
if [ ! -x "$dir/bin/ollama" ]; then
  mkdir -p "$dir"
  curl -fsSL https://ollama.com/download/ollama-linux-amd64.tar.zst | zstd -d | tar -x -C "$dir"
fi
mkdir -p ~/.config/systemd/user
ln -sf ~/Code/hackathons/shotmatch/ops/shotmatch-ollama.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now shotmatch-ollama
for i in $(seq 1 20); do curl -sf http://127.0.0.1:11434/api/version >/dev/null && break; sleep 1; done
OLLAMA_HOST=127.0.0.1:11434 "$dir/bin/ollama" pull nemotron-3.5-bolt:e4b
OLLAMA_HOST=127.0.0.1:11434 "$dir/bin/ollama" list
