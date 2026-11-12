# Tessera on Vultr

**Torn down on November 11, 2026.** The VM, the Object Storage bucket, the Serverless Inference subscription and the firewall groups below were deleted; nothing runs on Vultr now. The rest of this page records how it ran.

Facts read from the Vultr API on Sunday, November 8, 2026 at 10:58 AM CT.

## The VM

| | |
|---|---|
| Name | `shotmatch-app` |
| Plan | `vhp-12c-24gb-amd`: 12 vCPU, 24 GB memory, 469 GB disk |
| Region | `dfw` (Dallas) |
| Price | $0.197 an hour, $144 a month |
| OS | Ubuntu 24.04.5 |

What runs on it:

- **Caddy**, HTTPS with automatic certificates for `tesseraphoto.com`, `www.tesseraphoto.com` and `app.tesseraphoto.com` (plus the old sslip.io names). See `ops/Caddyfile` and `ops/DOMAIN.md`.
- **The crew** (Node, `127.0.0.1:8790`): serves the app, claims jobs, calls the models, bridges messages. Deployed by `ops/deploy-vultr.sh`.
- **The solver** (Python FastAPI, `127.0.0.1:8791`, never public).
- **Ollama with Nemotron 3.5 Bolt**, the offline command path on the CPU.
- **The site**, static files in `/var/www/shotmatch-site`, deployed by `ops/deploy-site.sh`.

## Server-only folders

`/var/www/shotmatch-site/reels/` (the ten vertical reels, https://tesseraphoto.com/reels/) and `/var/www/shotmatch-site/videos/` (the self-hosted track videos and their posters, https://tesseraphoto.com/videos/) are uploaded outside the build. `ops/deploy-site.sh` passes `--exclude=/reels/ --exclude=/videos/` to `rsync --delete`, so a site deploy keeps them. Nothing for them goes in `site/public`.

## Object Storage

Bucket `shotmatch` in `atl` (Atlanta), endpoint `atl2.vultrobjects.com`: photos, previews and generated props.

## Serverless Inference

Nemotron 3.5 Content Safety, Nemotron 3 Nano Omni (speech-to-text fallback), Qwen-Image 2.1 (the render generator) and Whisper large v3 turbo. See `docs/NVIDIA.md`.

## No GPU on Vultr

Vultr refused the GPU instance (no credit, then the monthly fee limit), so Vultr GPU spend is $0 and the lens fine-tune ran on a Brev A100. See `lens/COST.md`.
