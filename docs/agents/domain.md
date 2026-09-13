# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Docs root

Domain docs live outside the repo, in the vault, at **`~/hvelv/repos/gjetr/`**. Every path below is relative to that docs root, not the repo root. Never create `CONTEXT.md`, `adr/` or other reference docs inside the repo.

## Before exploring, read these

- **`CONTEXT.md`** at the docs root, or
- **`CONTEXT-MAP.md`** at the docs root if it exists: it points at one `CONTEXT.md` per context. Read each one relevant to the topic.
- **`adr/`**: read ADRs that touch the area you're about to work in. In multi-context repos, also check `<context>/adr/` for context-scoped decisions.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

Single-context repo (most repos):

```
~/hvelv/repos/gjetr/
├── gjetr.md                 ← vault folder note (the only file with frontmatter)
├── CONTEXT.md
├── adr/
│   ├── 0001-omarchy-shell-plugin-without-daemon.md
│   └── 0002-usage-behind-a-source-seam.md
└── PRD.md, ARCHITECTURE.md, findings/, …
```

Multi-context repo (presence of `CONTEXT-MAP.md` at the docs root):

```
~/hvelv/repos/<repo>/
├── CONTEXT-MAP.md
├── adr/                     ← system-wide decisions
├── ordering/
│   ├── CONTEXT.md
│   └── adr/                 ← context-specific decisions
└── billing/
    ├── CONTEXT.md
    └── adr/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders), but worth reopening because…_
