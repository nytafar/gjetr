# Architecture

gjetr is an omarchy-shell (Quickshell 0.3.1) service plugin with no daemon
([ADR 0001](adr/0001-omarchy-shell-plugin-without-daemon.md)). Vocabulary is in
[CONTEXT.md](../CONTEXT.md).

Two rules shape every file:

- **Logic is pure JavaScript in `lib/`**, with no Qt imports, tested with
  `node --test tests/`. `*Policy.js` decides; `*Model.js` transforms. QML moves
  bytes, runs timers and draws.
- **One writer per piece of state, and the UI is never it.** Modules and
  surfaces render what `Service.qml` publishes and report taps upward.

## Data flow

```
herdr socket ──► HerdrConnection.qml ──► HerdrModel.js ─┐
cache-ttl files ─► FileView ──────────► CacheTimerModel ─┤
~/.config/gjetr ─► FileView ──────────► ConfigModel ─────┤
state.json ─────► FileView ──────────► OverrideModel ────┼─► Service.qml ─► DeckSurface.qml ─► DeckTabs.qml
~/.claude/projects ► CommandRunner ───► RecapModel ──────┤                                   └► AgentList ─► AgentCard
hyprctl / ps ───► CommandRunner ───► WindowPolicy, DeckPolicy
```

## Files

### `manifest.json`

`kinds: ["service"]`, `keepLoaded: true`, entry `Service.qml`. The shell creates
the service once and injects `omarchyPath`, `shell`, `manifest` and the
registries. Those properties must stay writable (see `AGENTS.md`).

### `Service.qml`

Owns: Display selection, Config and Layout texts, Overrides and the single write
to `state.json`, the herdr connection, Agents in Sort mode, Attention, Recaps,
Cache timers and the display clock, the Deck and the active Layout, runtime
rotation and touch transforms, window focus, and IPC.

Does not own: drawing, gesture interpretation, protocol parsing, or any
decision that can be a pure function. It calls into `lib/` for all of those.

### `HerdrConnection.qml`

Owns: sockets, reconnect timers, the published `agents`, `online`, `attempt`
and focus request counters. One `Socket` object per connection attempt and per
request, because a Quickshell 0.3.1 `Socket` never retries after a failed
connect.

Does not own: the meaning of any line. Every protocol decision is in
`HerdrModel.js`. Events never become state; they only schedule a re-snapshot,
because herdr replays history to every new subscriber.

### `CommandRunner.qml`

Owns: starting processes and collecting `(stdout, exitCode)`. It refuses any
argv that `lib/CommandPolicy.js` does not allow and never uses a shell.

Does not own: which command to run, or what the output means.

### `DeckSurface.qml`

The full-output `PanelWindow` on the Display: Bottom layer, no keyboard focus,
`ExclusionMode.Ignore`. It is created per matching screen by the service's
`Variants`, so it disappears and returns across hotplug while the service keeps
its state. Places the tab bar and content, steps out of the bar, and turns a
sideways drag into `swipeLayout(dx, dy)`.

Does not own: which Layouts exist, which is active, or whether a swipe changes
anything (`DeckPolicy.swipeTarget`).

### `DeckTabs.qml`

Tabs on one edge with badges. Reports a tapped Layout name. Owns nothing.

### `modules/AgentList/AgentList.qml`, `AgentCard.qml`

The Agent List Module: header (Agent count, Sort mode and Focus behaviour
toggles), Offline banner, Cards, and the Recap overlay. Cards live in a
`ListModel` keyed by pane id and updated in place (`ListSyncPolicy`), so updates
keep scroll position and running animations. A Flickable places them with
`LayoutPolicy.cardPlacement` from each Card's measured height, so a Card with
its Recap open grows and pushes the rows below it down; `keepScroll` holds the
view when a Card above it changes height. A Card draws its Fields, its
Attention pulse and its Recap, and reports taps, long presses and the Recap
disclosure.

Does not own: Agents, sorting, Attention or Recap state, colours (theme tokens
come from `CardPolicy`), or what a tap does.

## `lib/`

| File | Decides or transforms | Does not own |
|---|---|---|
| `HerdrModel.js` | Request lines, reply and stream parsing, snapshot to Agents (with herdr's order, `state_change_seq`, session id), whether an event would change what is drawn, reconnect and debounce timing | Sockets, timers |
| `SortPolicy.js` | `spaces`, `priority`, `cache`, matching herdr and cache-ttl | Cache timer arithmetic |
| `NamePolicy.js` | Agent name fallback and the workspace › tab Field | |
| `CacheTimerModel.js` | `timers.json` and plugin thresholds to a Cache timer, level and label | File watching |
| `CardPolicy.js` | Presets and Fields, status and cache tones, touch sizes, kind icons | Colours themselves |
| `AttentionModel.js` | Entering and leaving Attention from Agent lists and taps | Pulse animation |
| `RecapModel.js` | Transcript path checks, stat parsing, the latest `away_summary`, cleaning untrusted text, which Recaps are open per Module and pane | Finding or reading files |
| `ConfigModel.js` | TOML to validated Displays, Decks, Layouts and Module settings, with per-key errors | Loading or watching files |
| `OverrideModel.js` | `state.json` parse, set, clear and stable serialization | Writing the file |
| `LayoutPolicy.js` | Screen by output name, bar inset, content rectangle, columns, Card placement by height, scroll keeping | |
| `DeckPolicy.js` | Available and active Layouts, orientation to transform, `hyprctl monitors` parsing, tab edge and rectangle, swipe step, badges | Running `hyprctl` |
| `WindowPolicy.js` | Process table and window list to the host window of a herdr client | Running `ps` or `hyprctl` |
| `ListSyncPolicy.js` | Remove, move and insert steps between two key orders | The model |
| `CommandPolicy.js` | The complete allowlist of process argv, and builders that return `[]` for any value outside it | Starting processes |
| `vendor/toml.js` | toml.min 1.0.0 (MIT), bundled | |

## Processes gjetr starts

Every one passes `CommandPolicy.allowed` and runs without a shell. Values that
come from Config, herdr or Hyprland are validated against a pattern first.

| Command | When | Validated values |
|---|---|---|
| `ps -e -o pid=,ppid=,comm=,args=` | Focus behaviour `window`, after a tap | none |
| `hyprctl -j clients` | same | none |
| `hyprctl dispatch 'hl.dsp.focus({ window = "address:0x…" })'` | same | hex address |
| `hyprctl -j monitors` | rotatable Display, Layout change or reload | none |
| `hyprctl eval 'hl.monitor({ output, mode = "preferred", position, scale, transform })'` | rotation | output name, integers, scale, transform 0–7 |
| `hyprctl eval 'hl.config({ input = { touchdevice = { transform } } })'` | rotation, no `touch_devices` | transform 0–7 |
| `hyprctl eval 'hl.device({ name, output, transform })'` | rotation, with `touch_devices` | device and output names, transform 0–7 |
| `find ~/.claude/projects -mindepth 2 -maxdepth 2 -type f -name <uuid>.jsonl` | Recap on, new session | UUID, projects path |
| `stat -c "%Y %s %n" -- <transcripts…>` | Recap on, every 5 s | transcript paths |
| `grep -F -- '"subtype":"away_summary"' <transcript>` | Recap on, transcript changed | transcript path |

## State and its single writer

| State | Writer | Persisted |
|---|---|---|
| Agents, online, attempt | `HerdrConnection.qml` | no |
| Config texts | FileViews in `Service.qml` (read only) | user's files, never written |
| Overrides | `Service.writeOverrides` | `~/.local/state/gjetr/state.json` |
| Attention, Recaps, open Recaps (Cards and overlay), rotation and touch status, window focus status | `Service.qml` | no |
| Output transform and touch transform | Hyprland, requested by `Service.applyOrientation` | runtime only, reset by `hyprctl reload` |

## Tests

`node --test tests/` covers every `lib/` file through
`tests/support/loadLib.cjs`, which strips `.pragma library` and resolves
`.import` chains the way QML does. QML is checked with `qmllint` and on the
panel; each ticket's acceptance is recorded in `docs/findings/`.
