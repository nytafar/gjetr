# gjetr

An omarchy-shell (Quickshell 0.3.1) plugin: a herdr dashboard for a secondary touchscreen.

- Read `CONTEXT.md` for vocabulary and use its terms in code and docs.
- `docs/PRD.md` is the spec; `docs/tickets/README.md` is the work order; `docs/adr/` records hard decisions.
- Logic goes in `lib/*.js`: pure, no Qt imports, `.pragma library` when stateless, tested with `node --test tests/`. `*Policy.js` decides, `*Model.js` transforms.
- QML components render only; state is owned by `Service.qml`.
- herdr socket: one JSON request per connection; only `events.subscribe` stays open. Match replies on the first line, not the id.
- Never edit `/usr/share/omarchy`. Never write the user's Config. Validate `hyprctl reload` changes with `hyprctl configerrors`.
- Install for testing: symlink the repo to `~/.config/omarchy/plugins/<id>`, then `omarchy-shell shell rescanPlugins`.
- After editing QML or `lib/*.js` of an already loaded plugin, run `omarchy-restart-shell`. `rescanPlugins` and the shell's own plugin reload restart the service but keep the engine's cached types, so the old code keeps running. Check what is live with `qs ipc -n -p "$OMARCHY_PATH/shell" show`.
