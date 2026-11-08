# GPU cost log

Budget: $50 for the whole hackathon, including serving through Sunday noon CT.

| Time (CT) | Event | Instance id | Plan | Region | $/h | Running total |
|---|---|---|---|---|---|---|
| Sat Nov 7, evening | Create attempt for `shotmatch-gpu` failed. Vultr said: "Server add failed: Your account does not have any additional credit - please add funds!" (HTTP 400). Account balance 0, pending charges 0. | none | vcg-a40-24c-120g-48vram | lax | about 1.71 ($1250/month) | $0.00 |

Created and free: Vultr firewall group `shotmatch-gpu` (id 1e1555f1-e275-4f73-90e3-2e70ec9578ed) allowing tcp 22 and 8000 from 204.244.157.82/32 only. Reuse it with `firewall_group_id` when creating the instance.
No instance exists.
