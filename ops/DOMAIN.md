# Moving ShotMatch to a real domain

Today the app is https://104-238-146-229.sslip.io and the docs site is https://site.104-238-146-229.sslip.io. Both are
the Vultr VM `shotmatch-app` (104.238.146.229, Dallas), and sslip.io resolves any name ending in the IP to the IP, so
Caddy gets certificates for them with no DNS of ours. These are the steps once Ben owns a domain. `example.com` below
stands for it. The plan: the docs site at `example.com` and `www.example.com`, the app at `app.example.com`.

## 1. Buy the domain (Ben)

Through MLH's GoDaddy Registry offer, so the project can enter "Best Domain Name from GoDaddy Registry". If the
domain lands in Ben's GoDaddy account, `gddy` on macserver is signed in to it (always pass `--timeout 40s`; quote
first, then show the price and agreement links before any purchase).

## 2. DNS: three A records to the VM

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `@` | 104.238.146.229 | 600 |
| A | `www` | 104.238.146.229 | 600 |
| A | `app` | 104.238.146.229 | 600 |

Add them in the registrar's DNS page, or with `gddy dns add` on macserver (run `gddy dns add --help` for its flags;
`dns set` fails against an existing record, so delete a parked record first). Remove GoDaddy's default parking A record for `@` if it has one. Check
before going on: `dig +short example.com www.example.com app.example.com` prints 104.238.146.229 three times.

## 3. Caddy: add the new names

Edit `ops/Caddyfile`. Keep the sslip.io names in the same blocks, so old links keep working:

```
app.example.com, 104-238-146-229.sslip.io {
	encode gzip
	reverse_proxy 127.0.0.1:8790
}

example.com, www.example.com, site.104-238-146-229.sslip.io {
	... (the site block as it is)
}
```

Install and reload (Caddy fetches the new certificates on the first request, within seconds):

```sh
scp ops/Caddyfile root@104.238.146.229:/etc/caddy/Caddyfile
ssh root@104.238.146.229 'caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile && systemctl reload caddy'
curl -sI https://app.example.com | head -1; curl -sI https://example.com | head -1
```

## 4. The app's public URL (links in texts, QR codes, emails)

Three places carry the app's address. Change all three to `https://app.example.com`:

1. **Crew:** add `Environment=PUBLIC_URL=https://app.example.com` to `ops/shotmatch-crew.service`, then deploy with
   `ops/deploy-vultr.sh` and on the VM `systemctl --user daemon-reload && systemctl --user restart shotmatch-crew`.
   `GET /api/config` then returns the new `publicUrl`, which the web app uses for share links and QR codes.
2. **SpacetimeDB module:** `PUBLIC_URL` is a database environment variable (`module/src/index.ts`, the `env` block).
   Publish once with it set: `cd module && PUBLIC_URL=https://app.example.com scripts/publish.sh`. Publishing keeps
   stored values afterwards. No column changes, so no crew redeploy is needed for this step.
3. **Defaults in code** (used only when the variables are unset): `crew/src/config.ts` (`PUBLIC_URL`) and
   `module/src/index.ts` (`DEFAULT_PUBLIC_URL`).

Photon: if `crew/PHOTON.md`'s email step used a `mail.<domain>` name, that is a separate DNS setup in Photon's dashboard.

## 5. The docs site

In `site/src/site.ts` set `SITE_URL = 'https://example.com'` and `APP_URL = 'https://app.example.com'` (or pass them as
environment variables to the build), then `ops/deploy-site.sh`. That updates canonical links, the sitemap, llms.txt
and every "Open the app" button.

## 6. Devpost and docs

Replace the sslip.io links in `DEVPOST.md` and on the Devpost page. The track write-ups in `docs/` name the old host in
a few examples; `grep -rn 104-238-146-229 docs site/src DEVPOST.md` lists them.

## Undo

Remove the new names from `ops/Caddyfile` and reload Caddy; the sslip.io names never stopped working.
