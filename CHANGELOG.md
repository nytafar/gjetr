# Changelog

All notable changes to gjetr. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- `recap_open = "card" | "overlay"` per Agent List, default `card`: with
  `recap = "expand"` the full Recap opens inside its Card, under the Fields,
  and the Card grows. Several Cards can be open at once; open Cards follow
  their Agents through re-sorts and updates without moving the scroll
  position, and are not persisted. `overlay` keeps the previous behaviour.
- IPC `toggleRecap <pane-id>`, and `recap.open`, `recap.openCards` and
  `recap.overlay` in `state`.

### Changed

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
