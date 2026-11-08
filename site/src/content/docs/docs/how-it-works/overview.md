---
title: How it works
description: The pieces of Tessera, how they talk to each other, and which machine runs each one.
---

Tessera has one shared state: a SpacetimeDB database on Maincloud. Every screen, every phone, the GPU worker and the message bridge read and write the same rows. Nothing else sits between them.

## The pieces

```
 planner browsers          scout phone            text threads and calls
 Simple and Studio         camera, GPS, compass   iMessage, Telegram, SMS,
 React + three.js          /s/<code>              WhatsApp, email, voice
        |  websocket             |  websocket             |
        |                        |                  Photon (events in over Socket.IO,
        |                        |                  HTTP API out; SIP to ElevenLabs)
        |                        |                        |
        v                        v                        v
 +------------------------------------------------------------------+
 |  Maincloud: database `shotmatch` (one TypeScript module)        |
 |  tables, reducers, views, schedules, procedures, HTTP routes    |
 +------------------------------------------------------------------+
        ^  websocket (crew identity)        |  inter-database calls
        |                                   v
 +---------------------------+      +-------------------------------+
 |  crew (Node, Vultr VM)    |      |  Maincloud: `shotmatch-library` |
 |  claims jobs, agent loop, |      |  public props and shared shots  |
 |  renders, Photon bridge,  |      +-------------------------------+
 |  photos, HTTP API, Caddy  |
 +---------------------------+
     |              |                    |
  solver         NVIDIA hosted APIs    Vultr Serverless Inference
  (Python,       Nemotron, TRELLIS,    Content Safety, Nano Omni,
  127.0.0.1:     Parakeet, Magpie,     Qwen-Image, Whisper
  8791)          cuOpt, embeddings
     |
  lens model (vLLM on a Brev A100, through an ssh tunnel)
```

- **Simple and Studio** are one Vite and React app. Studio draws the set with three.js. The crew serves the built app, so the public URL is one origin.
- **The scout page** (`/s/<code>`) opens on a phone, shows the camera with the original photo as a ghost, and writes the phone's GPS and compass to the database. See [Scout to the mark](/docs/guides/scout-to-the-mark/).
- **The module** (`module/src/index.ts`) holds every session, photo, solve job, scene object, render job, message and version. Row-level security sends each session's rows only to its members and the crew. See [Live sync](/docs/how-it-works/live-sync/).
- **The crew** (`crew/`) is one Node process connected to SpacetimeDB under its own privileged identity. It claims solve and render jobs, runs the Nemotron workflows, bridges Photon, stores photos and serves the HTTP API in [HTTP API](/docs/reference/http-api/).
- **The solver** (`solver/`, Python with pycolmap and hloc) localizes a photo against a spot's 3D model. It listens on localhost only. See [Solve](/docs/how-it-works/solve/).
- **`shotmatch-library`** is a second database that holds the public library of generated props and finished shots, fed from every session through inter-database outboxes.

## Which machine runs what

| Piece | Runs on |
|---|---|
| SpacetimeDB modules `shotmatch` and `shotmatch-library` | SpacetimeDB Maincloud |
| Caddy (HTTPS), crew, solver, web app | One Vultr VM in Dallas: 12 vCPUs, 24 GB, Ubuntu 24.04 |
| Nemotron 3.5 Bolt for the offline path | Ollama on the same Vultr VM's CPU |
| Photos, previews and generated props | Vultr Object Storage, plus the VM's disk |
| Nemotron Content Safety, Nemotron 3 Nano Omni, Qwen-Image 2.1, Whisper | Vultr Serverless Inference |
| Nemotron 3.5 Super VL, Lightning and Embed, the VL reranker, TRELLIS, FLUX.1-dev, Parakeet, Magpie, cuOpt | NVIDIA hosted APIs |
| The fine-tuned lens model (Nemotron Nano 12B v2 VL plus our LoRA) | vLLM on a Brev A100 80 GB, reached through an ssh tunnel from the VM |
| Spot builds and the lens dataset pull | linuxbox (CPU) |
| Messaging | Photon's hosted API; the phone call's voice agent on ElevenLabs |

Vultr refused a GPU instance twice (no account credit, then the monthly fee limit), so the GPU work moved to Brev, paid from the HackUTD NVIDIA credit.

## One request, end to end

1. You drop a photo in Simple. The browser posts it to `POST /api/upload`, then calls `createSession` and `addPhoto`. `addPhoto` queues a `solve_job` row.
2. The crew sees the queued row, calls `claimJob` (it now holds a 60 s lease), screens the photo with Nemotron Content Safety, reads the lens and calls the solver.
3. The solver streams progress lines. The crew writes each one with `reportProgress`, which renews the lease. Your screen shows them as they arrive.
4. The crew calls `finishJob` with the pose. Every member's screen moves the camera to the mark at the same moment. If the shoot is still called "Untitled shoot", a procedure inside the database asks Nemotron 3.5 Lightning for a title.
5. If the crew dies mid-solve, the `sweep` schedule finds the expired lease within 10 s and puts the job back in the queue.
