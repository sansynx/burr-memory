# Burr

Burr is on for every project on this machine. A burr is a seed that hooks on
and rides with the next passerby.

Memory lives in **`~/.burr/memory/`** — playbooks and signals shared across
your projects. The current project's `.burr/` is config, usage, and host
copies. Never write playbooks or signals into another repo.

If this project has no `.burr/`, create the config before capture or resolve:
`.burr/config.json` and `.burr/usage.jsonl`. `npx burr init` also drops host
copies into the project.

Search `~/.burr/memory` first so a compacted session or another project's
agent can reuse a verified fix. Capture and resolve write there.

Read `.burr/config.json`. Mode is `on` (default), `strict`, or `off`.
If `off`, do nothing Burr-related.

## Do this

1. Before a non-trivial fix, search `~/.burr/memory` first, then leftover
   files in this project's `.burr/memory` if any exist.
   In `strict` mode, do not patch until that search has run.
2. If the failure is reusable beyond this machine and this moment, capture it
   as a signal under `~/.burr/memory/signals/`.
3. After a fix is verified, write a playbook under `~/.burr/memory/playbooks/`.
   No playbook without real verification.
4. Redact secrets, tokens, private keys, JWTs, home paths, emails, and raw
   credentials before any disk write. Never store source trees, `.env` files,
   or customer data.
5. Append one JSON line to this project's `.burr/usage.jsonl` for search, hit,
   miss, capture, resolve, promote, or discard.
6. Follow this project's existing instructions first. Burr does not override them.

## Do not

- Invent extra Burr commands.
- Call a remote memory API.
- Edit AGENTS.md, CLAUDE.md, or foreign rule files to "enable" Burr.
- Mix one project's source tree or `.env` into memory.
