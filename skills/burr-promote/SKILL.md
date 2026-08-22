---
name: burr-promote
description: Lift a leftover project-only Burr playbook into the shared user store. Use when the user says /burr-promote or an old playbook still lives under this project's .burr/memory/playbooks.
---

# Burr promote

1. New captures and resolves already write to `~/.burr/memory/`. Use promote only for an old playbook still sitting in this project's `.burr/memory/playbooks/`.
2. Never promote a signal.
3. Redact again. Write `~/.burr/memory/playbooks/<same-filename>.md` only if
   missing or identical. If a different file already has that name, preserve
   both by adding an 8-character content-hash suffix to the promoted filename.
4. Append usage.jsonl verb `promote` with the user-store path.
