---
name: burr
description: Show Burr status (playbook count, signal count, last hit, mode) or set mode to on, strict, or off. Use when the user says /burr or asks whether debugging memory is on.
---

# Burr status

Work in the current project root.

1. Read `.burr/config.json`. If missing, tell the user to run `burr init`.
2. If the user passed `on`, `strict`, or `off`, write that mode to `config.json` and stop.
3. Count markdown files in `~/.burr/memory/playbooks` and `~/.burr/memory/signals`
   (plus leftover files in this project's `.burr/memory` if any).
4. Read `.burr/usage.jsonl` if present. Report last `hit` (timestamp + path) and totals.
5. Reply in a few lines. No dashboard. No extra files.
