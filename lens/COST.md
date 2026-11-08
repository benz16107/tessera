# GPU cost log

Budget: $50 for the whole hackathon, including serving through Sunday noon CT.

| Time (CT) | Event | Instance id | Plan | Region | $/h | Running total |
|---|---|---|---|---|---|---|
| Sat Nov 7, evening | Create attempt for `shotmatch-gpu` failed. Vultr said: "Server add failed: Your account does not have any additional credit - please add funds!" (HTTP 400). Account balance 0, pending charges 0. | none | vcg-a40-24c-120g-48vram | lax | about 1.71 ($1250/month) | $0.00 |

Created and free: Vultr firewall group `shotmatch-gpu` (id 1e1555f1-e275-4f73-90e3-2e70ec9578ed) allowing tcp 22 and 8000 from 204.244.157.82/32 only. Reuse it with `firewall_group_id` when creating the instance.
No instance exists.

| Sat Nov 7, 8:04 PM CT | Second create attempt failed (credit was added). Vultr said: "Server add failed: You have reached the maximum monthly fee limit for this account. To deploy additional services, please request a limit increase." (HTTP 400). | none | vcg-a40-24c-120g-48vram | lax | about 1.71 | $0.00 |

## Brev (NVIDIA GPU cloud), from Sat Nov 7, 9:27 PM CT

Account: Ben's Brev org `benz16107-4e84e4-rvkd`, $60.00 credit from the HackUTD NVIDIA code, no card. Hard cap $55 through Sunday Nov 8, 1 PM CT. The Vultr GPU above was never created, so Vultr GPU spend stays $0.

| Time (CT) | Event | Instance | Type | $/h | Running total |
|---|---|---|---|---|---|
| Sat 9:27 PM | Created (A100 80 GB, 28 vCPU, 120 GB RAM, 850 GB disk). Picked over the $1.06 L40S because vLLM serving and the splat training share one GPU, and 80 GB trains without gradient checkpointing | shotmatch-gpu (kx9bf97u4) | hyperstack_A100_80G | 1.62 | running |
