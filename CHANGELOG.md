# Changelog

All notable changes to gjetr. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Kind logos: Pi, Gemini, Cursor, Cline, OpenCode, GitHub Copilot, Kimi, Qwen
  Code, Devin, Antigravity, Mastra Code, Kiro, Amp, Grok, Hermes, Kilo Code,
  Qoder and Oh My Pi draw their logo instead of a letter, from one-colour SVGs
  shipped in `assets/kinds/` and drawn in the theme's muted colour (and in
  their status with `indicator = "icon"`). Claude and Codex keep Omarchy's
  brand-colour marks; Droid, Maki and Muse keep their letter. Sources and
  licences (Simple Icons, CC0 1.0; Lobe Icons and oh-my-pi, MIT) are in
  `assets/kinds/LICENSES.md`; a test checks every shipped SVG is a plain
  currentColor shape with nothing that runs or loads. `state` → `cards[].kindMark`
  names the SVG file for these kinds.
- Status indicator: `indicator = "glyph" | "icon" | "both"` on Agent Lists and
  Workspace Lists, default `glyph` as before. With `icon` the kind mark
  (Omarchy's SVG or the letter mark) is drawn in its Agent's status: working in
  the accent and moving with `working_effect` (`sweep`, the default: a slow
  gradient; `breathe`: brightness and a soft glow every 1.5 s; `hue`: a cycle
  through the theme's colours; `shimmer`: a highlight passing every 2 s), idle
  dim, blocked urgent with a sharp flash, done green and pulsing until seen,
  unknown faded. The glyph is hidden where a mark carries the state and the
  status word stays; `both` keeps the glyph. Drawn with a small shader over
  the mark, and MultiEffect for the breathe and flash glow; marks move only while on screen and
  their Display is shown. Both settings cascade through `[defaults]`. `state`
  reports each Module's `indicator` and `workingEffect`, and `theme.palette`.
- Defaults: Module settings given once in `gjetr.toml`. `[defaults]` applies a
  setting to every Module type that takes the key, `[defaults.<type>]` to one
  type (`agent-list`, `workspace-list`, `usage`); the order is built-in default,
  `[defaults]`, `[defaults.<type>]`, the `[[module]]`'s own key, then an
  Override. Every Module setting cascades (`density`, `sort`, `preset`,
  `focus`, `recap`, `recap_open`, `highlight_workspace`, `tap`, `show`,
  `providers`, `refresh_seconds`). Errors name `gjetr.toml` and the table;
  unknown keys and tables are logged and ignored; a bad `[[module]]` value
  falls back to the defaults. `[display.defaults]` is refused, since a Layout
  is the same Modules on every Display. `state` → `config.defaults`.
- Every agent kind herdr 0.8.2 and 0.9.0 can report (23: Pi, Claude, Codex,
  Gemini, Cursor, Devin, Antigravity, Cline, Oh My Pi, Mastra Code, OpenCode,
  GitHub Copilot, Kimi, Kiro, Droid, Amp, Grok, Hermes, Kilo Code, Qoder, Qwen
  Code, Maki, Muse) has a written label and a mark: Omarchy's SVG for Claude
  and Codex, a distinct letter in a thin theme-coloured frame for the rest. An
  unknown kind shows its first letter, never a blank. herdr's aliases for a
  kind (`claude-code`, `antigravity_cli`, ...) resolve to it. Workspace List
  rows name the kind by its label; `state` cards carry `kind`, `kindLabel`
  and `kindMark`.
- herdr version and protocol: gjetr pings herdr once per connection and
  reports `version`, `protocol`, the `supported` set (herdr 0.8.2, protocol
  20; 0.9.0, protocol 22) and `protocolMismatch` under `state` → `herdr`.
  Outside that set it keeps working and Agent Lists and Workspace Lists show a
  quiet `untested herdr <version> (protocol <n>)` line. A request herdr answers
  with `unknown variant` switches off only that feature (`herdr.unsupported`):
  a refused subscription type is dropped and gjetr subscribes again at once
  instead of reconnecting on the backoff.
- herdr 0.9.0 (protocol 22) is supported beside 0.8.2. Its schema and agent
  kinds are recorded in `tests/fixtures/herdr-0.9.0/`, and
  `scripts/gen-herdr-schema.mjs` generates `lib/HerdrSchema.js` (event names,
  subscription types, methods, request params and the snapshot, agent, pane,
  tab and workspace fields, per build) from the fixtures; `--capture` records
  a herdr binary, `--check` fails when the table is stale or the installed
  herdr differs from its fixture. Node tests hold the herdr model to both
  schemas. The protocol 20 to 22 changes gjetr meets are the muse agent kind
  and subscriptions no longer replaying history, which subscribing before the
  snapshot already covers.

- Comfortable Cards draw a thin bar under a live Cache timer that drains as
  the cache ages, in its level's colour (green, accent, urgent); their size
  and touch targets are unchanged. A compact row's location line shows the
  repository and branch before workspace › tab.
- `density` per Module: `"auto"` (the default, chosen from size and input as
  before), `"compact"` or `"full"`. Full Agent List Cards are sized to be read
  leaning back from a 4K Dock: an 18 px name, the status glyph with its word,
  the repository and branch (else a short path), dimmed workspace › tab when
  it fits, the Cache timer as a large number over a bar draining in its level's
  colour, and the Recap's first two lines; a click opens the whole Recap in the
  Card on an accent-tinted panel. About 9 Agents fit a 360x714 Agent part.
  Workspace Lists and Usage draw comfortable with `"full"`. `state` lists each
  Module's density; IPC `toggleRecapIn <pane> <module-key>` opens a Recap in a
  given Agent List.
- Repo: each Agent's git repository and branch, from its cwd, else a short
  path (`~/…/a/b`). gjetr runs `git -C <cwd> rev-parse --show-toplevel
  --abbrev-ref HEAD` once per distinct cwd, when it appears and again every
  30 s while an Agent List is shown; the cwd is checked first and the answer is
  cleaned of control characters. `state` reports it per Card and in `repos`.
- Density: Agent Lists and Workspace Lists choose it from their size and
  whether the Display is used by touch (a surface) or the mouse (a Dock).
  Touch keeps the comfortable Cards; a Dock and touch columns under 360 px get
  compact rows without boxes: status glyph, small kind mark, name and Cache
  timer on one line, a dim second line with the Recap clamped to one line or
  workspace › tab when there is room, the theme's own type sizes, hover
  highlight. Rows keep some padding, a small gap between the name and the
  second line, a faint hairline between rows and an inset from both edges, so a
  1080-high Dock shows about 16 Agents instead of 6 and stays calm to read;
  compact Usage lines are spaced to match. Density is separate from `preset`.
- Compact Usage limits: one line per limit, with the provider's mark, a short
  window code (`5h`, `7d`, `F7d`), a thin meter in its level colour with a tick
  for the time gone in the window (accent when usage runs ahead of it), the
  percent as a number and a short reset time (`3h`); hovering shows the full
  label. Chosen by the same density; comfortable keeps the meters as they were.
- With Focus behaviour `window`, a click on a Dock puts the mouse pointer back
  where it was after focusing herdr's window (read with `hyprctl -j
  cursorpos`, moved with the Lua `hl.dsp.cursor.move` dispatch); keyboard focus
  stays on herdr. Touch surfaces never move the pointer. IPC `pointerFocus
  <pane-id>` focuses as such a click does; `state` → `windowFocus.cursor`.
- On a compact row, clicking an inline Recap line opens the whole Recap
  under the row; IPC `toggleRecap` accepts `recap = "inline"` too.

- Docks: `kind = "dock"` on a `[[display]]` puts gjetr along one `edge` of an
  output (`left`, the default, `right`, `top` or `bottom`; any other value
  skips the Dock),
  `size` logical pixels deep (default 360, at most half the output), with its
  own Deck. It sits on the Top layer, reserves its strip so windows tile
  beside it on every workspace, never takes keyboard focus, and survives
  hotplug. Its orientation comes from its edge; it never rotates its output.
- Every `[[display]]` is drawn, each with its own Deck, active Layout and
  surface, so the touchscreen and a Dock run at once. An output holds one
  Display.
- IPC `toggleDock <output>`, `showDock <output>` and `hideDock <output>` (`""`
  for the first Dock); the choice is an Override per output
  (`displays.<output>.visible`), and Config `visible` sets the start. `state` →
  `displays` describes every Display.
- `examples/gjetr/layouts/dock.toml`: Agents over usage, portrait, and a
  commented Dock in `examples/gjetr/gjetr.toml`.

- A Layout draws every `[[module]]`, not only the first Agent List: side by
  side as equal columns on a landscape Display, stacked on a portrait one, with
  a hairline between them. A per-Module `weight` (default 1) sets its share.
  Each Module keeps its own settings, Overrides (`<layout>#<index>`) and open
  Recaps, so two Agent Lists with different Sort modes can sit side by side.
- `state` → `modules` lists the active Layout's Modules with key, type, weight
  and rectangle.
- The Workspace List Module, `type = "workspace-list"`: herdr's workspaces,
  tabs and panes as a tree that expands in place, panes without an agent
  included. Rows show rolled-up status, labels, tab and pane counts or the
  single pane's agent kind, and pulse while a pane below them is in Attention.
  `tap = "expand"` (default) opens rows and focuses panes; `tap = "focus"`
  focuses the workspace, tab or pane and expands from a chevron. Per-Module
  `focus = "herdr" | "window"` with its Override. Expansion is kept per Module
  for the session, survives updates without moving the scroll position, and
  is never written.
- `highlight_workspace` per Agent List, default `true`: Cards of Agents in
  herdr's Focused workspace get a subtle tint. The list is never filtered.
- IPC `toggleExpand <node>` and `tapRow <node> <zone>`; `state` → `workspaces`,
  and `inFocusedWorkspace` on each Card.
- `examples/gjetr/layouts/workspaces.toml`.
- The Usage Module, `type = "usage"`: each AI provider's rate limits and usage
  from Omarchy's usage records. `show` picks `limits` (meters with percent and
  time to reset, accent from 75% and urgent from 90%), `today` (tokens,
  prompts, sessions), `recent_days` (bars per day) and `models` (today's tokens
  by model); `providers` filters and orders them. gjetr runs
  `omarchy-agent-usage-update` itself every `refresh_seconds` (900 by default,
  from the Module or the Display), one run at a time, and watches the records.
  Providers that are not ready, and stale numbers, are shown quietly. A tap on
  the header refreshes.
- IPC `refreshUsage`; `state` → `usage`.
- `examples/gjetr/layouts/usage.toml`.
- `recap_open = "card" | "overlay"` per Agent List, default `card`: with
  `recap = "expand"` the full Recap opens inside its Card, under the Fields,
  and the Card grows. Several Cards can be open at once; open Cards follow
  their Agents through re-sorts and updates without moving the scroll
  position, and are not persisted. `overlay` keeps the previous behaviour.
- IPC `toggleRecap <pane-id>`, and `recap.open`, `recap.openCards` and
  `recap.overlay` in `state`.
- `scripts/perf-sample.sh` measures the Omarchy shell's CPU (the median of
  runs, per thread group with `-t`); `scripts/build-shaders.sh` compiles
  `shaders/*.frag` to the `.qsb` Qt Quick loads (`--check` for a stale one).

### Changed

- Motion costs a fraction of what it did. The working glyph's turn, the
  Attention pulse and the kind mark's effects are drawn from one clock at 20
  frames a second instead of at the display's rate, and only on Cards and rows
  in view: with 20 Agents on a Dock and the panel the whole shell went from 48%
  of a core to 10–12% with the glyph, from 26–67% to 7–8% with an effect, and
  to nothing with nothing moving or with the moving Agents scrolled out of
  view. Sweep, hue and shimmer marks are drawn by a small shader and no longer
  take twice the frames. Motions now share one phase instead of each starting
  apart. See Performance in docs/CONFIGURATION.md.
- `state`'s top-level `display`, `surface`, `modules` and `deck`, and the IPC
  functions that name no Display, describe the primary Display (the first
  surface). Functions that act on the first Agent List or Workspace List fall
  back to a shown Dock's.
- List headers narrower than 480 pixels show their sort, tap and focus values
  without captions, and the count elides instead of running under them.

### Fixed

- An Agent named in herdr (`herdr agent start <name>`, `agents[].name` in the
  snapshot) shows that name on its Card and Workspace List row, ahead of the
  pane label and terminal title. Unnamed Agents are named as before.
- With `recap = "inline"`, Cards without a Recap no longer reserve two empty
  lines under their name.

- Status reads without colour. Cards and Workspace List rows show a glyph
  instead of a thin coloured line: working ◌ (turning, accent), idle ○
  (slightly dimmed, no colour), blocked ▲ (urgent), done ✓ (the theme's green)
  and unknown · (muted). Detailed Cards add the word; the compact preset and
  rows keep the glyph only. Blocked and done still pulse in Attention.
- The `cache` Sort mode is soonest-expiring first: live Cache timers by time
  left, shortest first, then expired (`cold`) ones, then Agents without a
  timer; ties by state (blocked, done, working, idle, unknown), then recency.
  It deliberately no longer follows the cache-ttl plugin's warmest-first view.
- gjetr also subscribes to herdr's `workspace.focused` and `tab.focused`, to
  follow the Focused workspace. They collapse unless the focus really moves.
- Deck tab badges count on Layouts with a Workspace List too.
- IPC `cycleSort`, `toggleFocus` and `toggleRecap` act on the first Agent List
  of the active Layout, and say `no agent list` when it has none.
- The Agent List places Cards by measured height instead of a uniform grid,
  so a Card can grow.

## [0.1.0] - 2026-09-13

First release: an Omarchy shell plugin that replaces herdr's sidebar on a
secondary touchscreen.

### Added

- A full-output surface on a configured Display: Bottom layer, never takes
  keyboard focus, steps out of the Omarchy bar, survives hotplug.
- Live herdr connection with snapshot-driven Agents, event collapsing, and an
  Offline state that keeps the last Cards greyed while retrying (500 ms to 30 s).
- The Agent List: one Card per Agent with status, kind mark, Agent name,
  workspace › tab and Cache timer, in `detailed` or `compact` presets.
- Sort modes `spaces`, `priority` and `cache` that match herdr's own agent
  panel and the cache-ttl plugin. Tap the header to cycle.
- Tap to focus the exact pane; Focus behaviour `window` also switches to and
  focuses the terminal window hosting herdr. Tap `focus` in the header to flip it.
- Attention: Cards pulse from `blocked` or `done` until the Agent is focused.
- The Deck: several Layouts per Display with tabs on a short edge, swipe between
  them, Attention badges on hidden tabs.
- Layout orientation, with runtime rotation of a `rotatable` Display and its
  touch input; fixed Displays skip Layouts that do not fit.
- Recap Field: each Claude Agent's latest session recap, inline or on request.
- TOML Config in `~/.config/gjetr/`, validated per key and hot-reloaded; never
  written by gjetr.
- Overrides for Sort mode, Focus behaviour and the active Layout in
  `~/.local/state/gjetr/state.json`.
- Backgrounds `black`, `theme`, `wallpaper`, `transparent` and hex colours with
  alpha.
- IPC on target `nytafar.gjetr` for state, focus, sorting, Layouts and resets.

[0.1.0]: https://github.com/nytafar/gjetr/releases/tag/v0.1.0
