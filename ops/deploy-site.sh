#!/bin/bash
# Builds the docs site (site/) and pushes it to the Vultr box, where Caddy serves it at the site hostname.
# Leaves the app alone: no crew or solver restart. Pass --caddy to also install ops/Caddyfile and reload Caddy.
set -euo pipefail
IP=104.238.146.229
cd "$(dirname "$0")/.."
(cd site && npm run build)
rsync -a --delete --chmod=D755,F644 site/dist/ "ben@$IP:/var/www/shotmatch-site/"
if [ "${1:-}" = --caddy ]; then
  scp -q ops/Caddyfile "root@$IP:/etc/caddy/Caddyfile.new"
  ssh "root@$IP" 'caddy validate --config /etc/caddy/Caddyfile.new --adapter caddyfile 2>&1 | tail -1 &&
    cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.prev && mv /etc/caddy/Caddyfile.new /etc/caddy/Caddyfile && chmod 644 /etc/caddy/Caddyfile && systemctl reload caddy'
fi
curl -s -o /dev/null -w 'site %{http_code}\n' https://site.104-238-146-229.sslip.io/
curl -s -o /dev/null -w 'app %{http_code}\n' https://104-238-146-229.sslip.io/
