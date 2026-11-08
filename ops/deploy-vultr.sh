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
if echo "$out" | grep -q 'ops/shotmatch-crew.service'; then ssh "$HOST" 'systemctl --user daemon-reload'; fi
# The crew drains before it restarts (renders and generations in flight finish, up to 150 s); show the wait.
ssh "$HOST" 'since=$(date "+%Y-%m-%d %H:%M:%S"); systemctl --user restart shotmatch-crew & pid=$!
while kill -0 $pid 2>/dev/null; do
  journalctl --user -u shotmatch-crew --since "$since" --no-pager -o cat | grep -o "waiting for [0-9]* in-flight jobs" | tail -1
  sleep 3
done
sleep 6 && journalctl --user -u shotmatch-crew --no-pager -n 4'
