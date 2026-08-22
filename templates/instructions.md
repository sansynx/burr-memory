# Burr

Burr is local debugging memory for this project. A burr is a seed that hooks on
and rides with the next passerby. Keep useful failures and verified fixes in
`.burr/` so the next session does not guess again.

Read `.burr/config.json`. Mode is `on` (default), `strict`, or `off`.
If `off`, do nothing Burr-related.

## Do this

1. Before a non-trivial fix, search `.burr/memory` (playbooks and signals).
   In `strict` mode, do not patch until that search has run.
2. If the failure is reusable beyond this machine and this moment, capture it
   as a signal under `.burr/memory/signals/`.
3. After a fix is verified, write a playbook under `.burr/memory/playbooks/`.
   No playbook without real verification.
4. Redact secrets, tokens, private keys, JWTs, home paths, emails, and raw
   credentials before any disk write. Never store source trees, `.env` files,
   or customer data.
5. Append one JSON line to `.burr/usage.jsonl` for search, hit, miss, capture,
   resolve, or discard.
6. Follow this project's existing instructions first. Burr does not override them.

## Do not

- Invent extra Burr commands.
- Call a remote memory API.
- Edit AGENTS.md, CLAUDE.md, or foreign rule files to "enable" Burr.
