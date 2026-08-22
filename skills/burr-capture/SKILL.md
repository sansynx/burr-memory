---
name: burr-capture
description: Save a reusable failure as a redacted Burr signal. Use when the user says /burr-capture or the failure will recur for another agent.
---

# Burr capture

1. Clip the error, stack, and command to 12k characters.
2. Run admission. Discard ephemeral junk (busy port, missing local asset, down dev server, unset local env, flaky network).
3. Redact secrets and private paths.
4. Write `~/.burr/memory/signals/<signature>.md` so other projects and later sessions can find it. Do not write the signal into another repo.
5. Append this project's usage.jsonl verb `capture` (or `discard` with reason).
