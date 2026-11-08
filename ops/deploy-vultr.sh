#!/bin/bash
# Pushes this checkout to the Vultr box (shotmatch-app) and restarts what changed. Run from linuxbox after any change.
# Photos and previews (data/) are not pushed: they live in the bucket and on each box's disk. Secrets are not pushed.
# A changed spot model restarts the solver; anything else restarts only the crew.
set -euo pipefail
HOST=${VULTR_HOST:-ben@104.238.146.229}
cd "$(dirname "$0")/.."
out=$(rsync -ai --exclude .git --exclude node_modules --exclude .venv --exclude __pycache__ --exclude /data \
  --exclude 'spots/*/sfm' --exclude /design --exclude /site ./ "$HOST:Code/hackathons/shotmatch/")
echo "$out" | grep -v '^\.d' || echo "nothing changed"
if echo "$out" | grep -q 'crew/package-lock.json'; then
  ssh "$HOST" 'cd ~/Code/hackathons/shotmatch/crew && PATH=$HOME/.nvm/default-node/bin:$PATH npm ci --no-audit --no-fund'
fi
if echo "$out" | grep -qE 'solver/.*\.py|spots/[^/]+/model/'; then ssh "$HOST" 'systemctl --user restart shotmatch-solver'; echo "solver restarted"; fi
ssh "$HOST" 'systemctl --user restart shotmatch-crew && sleep 6 && journalctl --user -u shotmatch-crew --no-pager -n 4'
