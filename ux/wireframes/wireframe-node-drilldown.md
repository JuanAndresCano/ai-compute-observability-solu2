# Wireframe: Forensic Node Inspector Drawer (`ws-gpu-22`)
## Surface: Slide-Over Inspection Drawer
**Target Persona:** Liam (Lead Cloud Engineer)  
**Format:** Structured ASCII Layout & Component Inspection Spec

```text
+-----------------------------------------------------------------------------------------------+
| FORENSIC NODE INSPECTION: ws-gpu-22                                           [X Close (Esc)] |
| Status: [⏱ SILENT - NO HEARTBEAT (18.2s)]                                     [Export JSON]   |
+-----------------------------------------------------------------------------------------------+
| HARDWARE SPECIFICATION:                                                                       |
| Node Type: Workstation Tier-1       Host: lab-room-302-ws22.local.campus                      |
| GPU: 1x NVIDIA RTX 4090 (24 GB)     CPU: AMD Ryzen 9 7950X (32 vCPU) | RAM: 64 GB DDR5        |
+-----------------------------------------------------------------------------------------------+
| METRIC DEGRADATION TIMELINE (Last 15 Minutes):                                                |
|                                                                                               |
| 19:10:00 [NORMAL]     Temp: 62°C | VRAM: 14.2 GB | Util: 65% | Node Healthy                   |
| 19:12:30 [JOB START]  Job: job-cs480-lora-run-84 submitted by student-mateo (CS-480)          |
| 19:13:45 [WARNING]    Temp: 86°C | VRAM: 23.1 GB (96%) | Thermal throttling active            |
| 19:14:02 [CRITICAL]   Temp: 89°C | VRAM: 23.8 GB (99%) | LAST VALID HEARTBEAT RECEIVED        |
| 19:14:17 [TIMEOUT]    Watchdog expired (15.0s elapsed). Node transitioned to SILENT.          |
+-----------------------------------------------------------------------------------------------+
| LAST KNOWN JOB PROFILE (At moment of failure):                                                |
| - Job ID:          job-cs480-lora-run-84                                                      |
| - Owner:           student-mateo (Entitled Student)                                           |
| - Academic Subject CS-480 NLP Deep Learning                                                   |
| - Target Model:    Llama-3-8B-Instruct-FP16 (Weights: 16.0 GB + Context KV Cache: 7.8 GB)     |
| - Launch Command:  python3 train_lora.py --batch_size 16 --context_len 8192                   |
+-----------------------------------------------------------------------------------------------+
| KERNEL & DRIVER STDERR TAIL (Last 50 Lines):                                                  |
|                                                                                               |
| [19:13:52.401] kernel: [8120.441] nvidia: GPU 0000:01:00.0 temperature 87C exceeds threshold |
| [19:13:58.120] kernel: [8126.160] NVRM: GPU at PCI:0000:01:00.0 has fallen off the bus.      |
| [19:13:58.122] kernel: [8126.162] NVRM: Xid (PCI:0000:01:00.0): 62, GPU has fallen off bus   |
| [19:13:59.042] nvml-agent: Error: NVML_ERROR_GPU_IS_LOST (Unable to query temperature/memory)|
| [19:14:01.890] vllm-worker: PyTorch CUDA execution failed: device-side assert triggered     |
| [19:14:02.105] systemd[1]: nvml-telemetry.service: Main process exited, code=killed          |
| [19:14:17.000] watchdog: Heartbeat missing for 3 consecutive intervals (15.0s). State=SILENT  |
+-----------------------------------------------------------------------------------------------+
| RECOMMENDED TRIAGE ACTIONS:                                                                   |
| [Cordon Node in Scheduler]   [Copy Full Log Stack]   [Notify CS-480 TA]   [Clear Cache]       |
+-----------------------------------------------------------------------------------------------+
```
