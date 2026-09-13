# gjetr

An omarchy-shell (Quickshell 0.3.1) plugin: a herdr dashboard for a secondary touchscreen.

- Project docs live in the vault at `~/hvelv/repos/gjetr/`: `CONTEXT.md` for vocabulary (use its terms in code and docs), `PRD.md` is the spec, `adr/` records hard decisions, `ARCHITECTURE.md` the boundaries, `findings/` the per-ticket notes.
- Work is tracked as GitHub issues in `nytafar/gjetr`. The vault's `tickets/README.md` is the archived T01–T10 work order.
- Logic goes in `lib/*.js`: pure, no Qt imports, `.pragma library` when stateless, tested with `node --test tests/`. `*Policy.js` decides, `*Model.js` transforms.
- QML components render only; state is owned by `Service.qml`.
- The shell sets `omarchyPath`, `shell`, `manifest`, `barWidgetRegistry` and `pluginRegistry` on a service that declares them. Keep those properties writable: a read-only one makes the assignment throw and the service load twice.
- herdr socket: one JSON request per connection; only `events.subscribe` stays open. Match replies on the first line, not the id.
- Supported herdr builds are the fixtures in `tests/fixtures/herdr-<version>/` (`schema.json` from `herdr api schema --json`, `agent-kinds.json` from `herdr agent start --help`). `lib/HerdrSchema.js` is generated from them by `node scripts/gen-herdr-schema.mjs`: never edit it by hand. To support a build, capture it (`--capture` for the herdr on PATH, `--capture --binary <path>` for a release binary from `gh release download vX.Y.Z -R herdrdev/herdr -p herdr-linux-x86_64`), regenerate, give any new agent kind a label and letter in `lib/KindPolicy.js`, and review the schema diff. Do not run `herdr update` from an agent session.
- `shaders/*.frag.qsb` are generated from `shaders/*.frag` by `scripts/build-shaders.sh` (qsb from qt6-shadertools): never edit them by hand, and rebuild after changing a `.frag`; `--check` fails when one is stale.
- Gate: `node --test tests/`, `omarchy plugin validate .`, and `node scripts/gen-herdr-schema.mjs --check` (the generated table is current, and the installed herdr matches its fixture when it has one).
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
