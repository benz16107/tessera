# Devpost submission form answers (HackUTD 2026: ZeroDay)

Field ids from the Devpost MCP's get_submission_requirements. The lead submits these with submit_project once the open items are in.

| Field | Required | Answer |
|---|---|---|
| 29865 Public GitHub repository link | yes | https://github.com/benz16107/shotmatch (**open: Ben makes it public**) |
| 29405 Technology experience and feedback | yes | see below |
| 29406 Schools of every team member | yes | University of Toronto (**open: Ben confirms teammates and their schools**) |
| 29407 Domains registered with GoDaddy this hackathon | no | tesseraphoto.com (registered through GoDaddy on Nov 8; a .com, so not a GoDaddy Registry domain) |
| 29408 Track limit confirmation | yes | true (sponsor tracks: NVIDIA, Spacetime, Photon; HackUTD: Virality; MLH: Best Use of Vultr) |
| 29409 GenAI tools used this weekend | no | Claude, Codex |
| 29410 How and why we used them | no | see below |
| 29840 AI tools used this weekend | yes | Anthropic, OpenAI, Hugging Face, ElevenLabs, Vultr, Other (NVIDIA Nemotron and NIM) |
| 29841 Did you implement a generative AI model or API? | yes | see below |
| 29882 HackUTD track | yes | Virality |

## 29405 Technology experience and feedback

SpacetimeDB was the best part of the weekend. The whole shared set is one TypeScript module: every person, prop, light and camera is a row, and a drag in one browser shows up everywhere from the subscription with no server of ours. Row-level security, schedules, procedures with outbound HTTP and inter-database calls all worked on Maincloud. What cost us time: a database that other databases have called can't be deleted and recreated, so we lost our dev database once, and after any column change the old bindings fail to decode until every client redeploys. NVIDIA's hosted Nemotron models were fast and reliable for tool calling (Lightning routes a command in 0.23 s). TRELLIS and FLUX.1-dev returned HTTP 500 for much of the night, and one burst hit HTTP 429, so we added fallbacks and retries. Brev made the LoRA fine-tune easy (44 minutes on an A100). Photon's 2.0 beta Socket.IO stream with replay cursors was solid. Two things tripped us: idempotency keys can't contain spaces, and the managed lines need numbers and DNS set up by hand before they go live. Vultr's VM and Object Storage were simple, but the account's monthly cap blocked a GPU instance. Agentic coding (Claude Code across parallel threads) let one person build and test across seven folders at once. The lesson was to give each agent one folder and one person who runs deploys.

## 29410 How and why we used GenAI tools

Claude Code (Opus) did most of the building, in parallel threads, each owning one part of the repo: the SpacetimeDB module, the crew service, Studio, Simple, geodata, the site, and dedicated threads for a UI audit and a feature test that clicked every control on production. Codex helped plan early on. We chose them because one builder had a day: parallel agents let us build, test and fix across the stack at once, while a single lead thread reviewed every change and ran every deploy.

## 29841 Generative AI in the product

Yes. NVIDIA Nemotron runs the set as tool-calling workflows. Lightning routes commands. Super plans scene edits with reasoning on, turning words into placed objects through the shot camera. Super VL reads the user's photo: it places stand-ins where its people and cars are, reads the light, critiques renders, and names where a photo was taken from its signs and landmarks. Nano Omni and Content Safety screen inputs. Embed and Rerank power the prop and shot library. Bolt runs edits offline on CPU. We fine-tuned Nemotron Nano 12B v2 VL (LoRA) to read a photo's lens. The AI render composites the user's people and props into their own photo with Qwen-Image 2.1 on Vultr Serverless Inference (FLUX.1-dev returned errors), and Nemotron checks each object's light, shadow and scale before the user sees it. Props from words or photos come from TRELLIS. The phone agent uses ElevenLabs, with NVIDIA Parakeet and Magpie for speech. Every render is labelled "AI interpretation", and coordinates never come from a model: they come from GPS, our solver, or OpenStreetMap's geocoder.
