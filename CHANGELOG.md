# Changelog

All notable changes to gjetr. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Docks: `kind = "dock"` on a `[[display]]` puts gjetr along one `edge` of an
  output (`left`, `right`, `top`, `bottom`; a Dock without one is skipped),
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

### Changed

- `state`'s top-level `display`, `surface`, `modules` and `deck`, and the IPC
  functions that name no Display, describe the primary Display (the first
  surface). Functions that act on the first Agent List or Workspace List fall
  back to a shown Dock's.
- List headers narrower than 480 pixels show their sort, tap and focus values
  without captions, and the count elides instead of running under them.

### Fixed

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
