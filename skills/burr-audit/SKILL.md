---
name: burr-audit
description: Summarize Burr usage from the local ledger. Use when the user says /burr-audit or asks if memory is actually being used.
---

# Burr audit

1. Read `.burr/usage.jsonl`. If missing, say Burr has no usage yet.
2. Count verbs: search, hit, miss, capture, resolve, promote, discard.
3. Show last few hits and last few discards with reasons.
4. No server. No charts. A short list is enough.
