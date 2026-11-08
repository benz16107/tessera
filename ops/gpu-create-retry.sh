#!/bin/bash
# Retry creating the shotmatch-gpu A40 every 10 min until Vultr raises the monthly fee limit.
# Exits 0 with the instance JSON in ~/.config/shotmatch/gpu_instance.json (mode 600, holds the root password).
set -u
set -a; . ~/.config/calhacks13/env; set +a
V(){ curl -s -H "Authorization: Bearer $VULTR_API_KEY" -H "Content-Type: application/json" "$@"; }
out=~/.config/shotmatch/gpu_instance.json
for i in $(seq 1 30); do
  if V "https://api.vultr.com/v2/instances?label=shotmatch-gpu" | grep -q '"label":"shotmatch-gpu"'; then
    echo "$(date +%H:%M) shotmatch-gpu already exists; not creating another"; exit 0
  fi
  r=$(V -X POST https://api.vultr.com/v2/instances -d '{"region":"lax","plan":"vcg-a40-24c-120g-48vram","os_id":2284,"label":"shotmatch-gpu","hostname":"shotmatch-gpu","sshkey_id":["c798cc9a-7287-44d7-a708-95856e72c460"],"firewall_group_id":"1e1555f1-e275-4f73-90e3-2e70ec9578ed","enable_ipv6":false}')
  if echo "$r" | grep -q '"instance"'; then
    (umask 077; echo "$r" > "$out"); echo "$(date +%H:%M) created: $(echo "$r" | python3 -c 'import json,sys;i=json.load(sys.stdin)["instance"];print(i["id"], i["plan"], i["region"])')"; exit 0
  fi
  err=$(echo "$r" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("error",""))' 2>/dev/null || echo "$r" | head -c 200)
  echo "$(date +%H:%M) attempt $i: $err"
  case "$err" in *"monthly fee limit"*|*"additional credit"*) sleep 600 ;; *) exit 1 ;; esac
done
exit 2
