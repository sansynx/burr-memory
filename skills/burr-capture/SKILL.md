---
name: burr-capture
description: Save a reusable failure as a redacted Burr signal. Use when the user says /burr-capture or the failure will recur for another agent.
---

# Burr capture

1. Collect error, stack summary, command, exit code, attempted fixes. Bound sizes (12k text, 20 attempts).
2. Run admission. Discard ephemeral local junk (missing assets, busy ports, down dev servers, unset env, flaky network) unless a generalizable cause is present.
3. If discarded, append usage.jsonl verb `discard` with reason. Do not write a memory file.
4. If retained, redact every field. Write `.burr/memory/signals/<signature-or-slug>.md`.
5. Append usage.jsonl verb `capture` with path.
6. Never dump source trees or `.env` contents.
