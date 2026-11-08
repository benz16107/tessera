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
| Sat 9:27 PM | Created (A100 80 GB PCIe, 28 vCPU, 120 GB RAM, 700 GB /ephemeral disk). Picked over the $1.06 L40S because vLLM serving and the splat training share one GPU, and 80 GB trains without gradient checkpointing. Not stoppable on this provider: stopping means deleting | shotmatch-gpu (kx9bf97u4) | hyperstack_A100_80G | 1.62 | $0 |
| Sat 9:36 to 10:23 PM | LoRA fine-tune, first attempt, done (44 min) | same | | 1.62 | $1.55 |
| Sat 10:42 PM | vLLM serving shotmatch-lens on :8000 for the crew, through the VM tunnel | same | | 1.62 | $2.03 |
| Sat 9:43 to 10:45 PM | Splat runs: 1 collapsed, 2 diverged, 3 done in 16 min (10:27 to 10:43) | same | | 1.62 | $2.12 |
| Sat 10:56 PM | Running, serving. Plan: keep it up until Sunday noon CT for judging, then delete. Projected total at noon $23.60, at 1 PM $25.20, under the $55 cap | same | | 1.62 | $2.41 |
| Sat 11:50 PM to Sun 12:55 AM | Difix3D pass on the DUMBO splat (Ben's request), same instance beside vLLM: setup, run 1 11:58 PM to 12:39 AM (42 min), run 2 from 12:44 AM stopped at 12:55 AM when the lead took the splat off the demo. GPU hours already paid for serving, so no extra spend | same | | 1.62 | $3.86 |
| Sun 12:55 AM | Only vLLM (`shotmatch-lens` systemd service) left on the box, serving the crew's lens reads until judging; then `brev delete shotmatch-gpu`. Spent so far $5.62 (3.47 h). Projected total at noon CT $23.57 (14.55 h), under the $55 cap | same | | 1.62 | $5.62 |

Stop everything: `brev delete shotmatch-gpu` from linuxbox (`brev ls` to confirm it is gone). Billing stops on delete; this instance type cannot be stopped and kept.
