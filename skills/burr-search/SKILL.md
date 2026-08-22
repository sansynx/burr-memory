---
name: burr-search
description: Search Burr memory for a similar error before guessing a fix. Use when the user says /burr-search or @burr-search, or before a non-trivial debug if mode is on or strict.
---

# Burr search

1. Take the error, stack, command, and short context. Clip to 12k characters.
2. Redact secrets and private paths before using the text as a query.
3. Search `~/.burr/memory/playbooks` and `~/.burr/memory/signals` first (shared across projects and sessions). Then leftover files in this project's `.burr/memory` if any exist. Filename, YAML frontmatter, and token overlap. No embeddings. No network.
4. Append this project's usage.jsonl: verb `search`, then `hit` or `miss`.
5. If hits, show the top few paths, the source (`global` or `project`), and the useful excerpt (root cause / fix). Then use them.
6. If miss, say so and continue. In strict mode, still do not patch until this search ran.
