# gjetr

An omarchy-shell (Quickshell 0.3.1) plugin: a herdr dashboard for a secondary touchscreen.

- Project docs live in the vault at `~/hvelv/repos/gjetr/`: `CONTEXT.md` for vocabulary (use its terms in code and docs), `PRD.md` is the spec, `adr/` records hard decisions, `ARCHITECTURE.md` the boundaries, `findings/` the per-ticket notes.
- Work is tracked as GitHub issues in `nytafar/gjetr`. The vault's `tickets/README.md` is the archived T01–T10 work order.
- Logic goes in `lib/*.js`: pure, no Qt imports, `.pragma library` when stateless, tested with `node --test tests/`. `*Policy.js` decides, `*Model.js` transforms.
- QML components render only; state is owned by `Service.qml`.
- The shell sets `omarchyPath`, `shell`, `manifest`, `barWidgetRegistry` and `pluginRegistry` on a service that declares them. Keep those properties writable: a read-only one makes the assignment throw and the service load twice.
- herdr socket: one JSON request per connection; only `events.subscribe` stays open. Match replies on the first line, not the id.
- Never edit `/usr/share/omarchy`. Never write the user's Config. Validate `hyprctl reload` changes with `hyprctl configerrors`.
- Install for testing: symlink the repo to `~/.config/omarchy/plugins/<id>`, then `omarchy-shell shell rescanPlugins`.
- After editing QML or `lib/*.js` of an already loaded plugin, run `omarchy-restart-shell`. `rescanPlugins` and the shell's own plugin reload restart the service but keep the engine's cached types, so the old code keeps running. Check what is live with `qs ipc -n -p "$OMARCHY_PATH/shell" show`.

## Agent skills

### Issue tracker

Issues live as GitHub issues in `nytafar/gjetr`, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, each label string equal to its name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context, with the docs root in the vault at `~/hvelv/repos/gjetr/`: `CONTEXT.md` plus `adr/`. See `docs/agents/domain.md`.
