---
name: burr-help
description: One-screen Burr command reference. Use when the user says /burr-help or asks how Burr works.
---

# Burr help

Print this and stop:

Burr keeps debugging memory in ~/.burr/memory/ on this machine.

/burr [on|strict|off] status or set mode
/burr-search search shared memory (all your projects)
/burr-capture save a reusable failure
/burr-resolve write a playbook after a verified fix
/burr-promote lift an old project-only playbook into shared memory
/burr-audit usage from usage.jsonl
/burr-help this screen

Codex: @burr-search (and the other names). `burr init`/`burr global` installs native hooks; review new definitions in `/hooks`.
Pi: /skill:burr-search (and the other names).
Cursor and Windsurf: always-on rule only; no slash commands.

Mode on = search before non-trivial fixes. strict = do not patch until a search ran. off = silent.
