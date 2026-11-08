# Domain: tesseraphoto.com (done)

Done Sunday Nov 8, 2026, about 4:40 AM CT. Ben bought `tesseraphoto.com` at GoDaddy ($9.19). It is a .com, not a
GoDaddy Registry domain, so the project does not enter MLH's "Best Domain Name from GoDaddy Registry".

| Name | What | Served by |
|---|---|---|
| https://tesseraphoto.com | the site and docs | Caddy, static files in `/var/www/shotmatch-site` |
| https://www.tesseraphoto.com | the same site | Caddy, same block |
| https://app.tesseraphoto.com | the app and its API | Caddy, proxied to the crew on `127.0.0.1:8790` |

All three are the Vultr VM `shotmatch-app` (104.238.146.229, Dallas). The old names still work from the same Caddy
blocks: https://104-238-146-229.sslip.io for the app and https://site.104-238-146-229.sslip.io for the site.

## DNS (GoDaddy)

| Type | Name | Value |
|---|---|---|
| A | `@` | 104.238.146.229 |
| A | `app` | 104.238.146.229 |
| CNAME or A | `www` | `tesseraphoto.com`, which resolves to 104.238.146.229 |

Check: `dig +short tesseraphoto.com www.tesseraphoto.com app.tesseraphoto.com` prints 104.238.146.229 for each.

## Where the names live

- `ops/Caddyfile`: the app block and the site block, each with its sslip.io name kept. Install with
  `scp ops/Caddyfile root@104.238.146.229:/etc/caddy/Caddyfile`, then on the box
  `caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile && systemctl reload caddy`.
- The public URL in links the crew sends (`/api/config` `publicUrl`, invites, call sheets):
  `crew/src/config.ts` (`PUBLIC_URL`, default `https://app.tesseraphoto.com`) and `module/src/index.ts`
  (`DEFAULT_PUBLIC_URL`).
- The site: `site/src/site.ts` (`SITE_URL`, `APP_URL`). They set canonical links, `og:image`, the sitemap, llms.txt
  and every "Open the app" button. `ops/deploy-site.sh` builds, uploads and curls both new names.
- Links in `README.md`, `DEVPOST.md` (Try it live, gallery and inline images at `https://tesseraphoto.com/devpost/`)
  and `docs/*.md`. `docs/FEATURE-TEST.md` and `docs/UI-AUDIT.md` keep the sslip.io address, because that is where
  those dated audits ran.

## Undo

Remove the tesseraphoto.com names from `ops/Caddyfile` and reload Caddy, then set `SITE_URL` and `APP_URL` back to the
sslip.io names and run `ops/deploy-site.sh`. The sslip.io names never stopped working.
