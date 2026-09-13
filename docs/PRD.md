# gjetr PRD

Vocabulary is defined in [CONTEXT.md](../CONTEXT.md). Decisions with lasting
cost live in [docs/adr/](adr/). Background research, protocol notes and prior
art analysis: `~/scratch/omarchy-strip/docs/` (docs 11 supersedes earlier ones).

## Problem

herdr's sidebar is the only place to see and switch agents, and it costs space
on the main screen. A touchscreen sits beside the desk. gjetr takes over the
sidebar's role from outside herdr, on that Display or docked beside the work.

## Environment

| Fact | Value |
|---|---|
| Host | Omarchy 4.0.2, Quickshell 0.3.1, Hyprland (Lua config) |
| herdr | 0.8.2; one request per socket connection, one long-lived `events.subscribe` |
| Touchscreen | `HDMI-A-2`, 1024x600, touch bound in `~/.config/hypr/input.lua` |
| Cache timers | `~/.local/state/herdr/plugins/cache-ttl/timers.json`, keyed by pane id |
| Theme | Omarchy `qs.Commons` Style, palette in `~/.local/state/omarchy/current/theme/colors.toml` |

## MVP

An omarchy-shell plugin (ADR 0001) that shows the Agent List, portrait, on the
touchscreen.

### Must

| # | Requirement |
|---|---|
| M1 | A full-output surface on the Display named in Config, layer Bottom, never takes keyboard focus, survives hotplug |
| M2 | One Card per Agent; panes without an agent are excluded |
| M3 | Sort modes mirror herdr's agent panel exactly: `spaces` (herdr's order), `priority` (herdr's attention queue: blocked > done > working > idle > unknown, most recent state change first), `cache` (the cache-ttl plugin's view: warmest first, cold after live, no timer last; then attention, then recency) |
| M4 | Default Sort mode from Config; tapping the list header cycles it as an Override |
| M5 | Agent name: terminal title, then renamed tab label, then workspace label, then cwd basename |
| M6 | Card Fields chosen by named preset: status, kind icon, name, workspace › tab, Cache timer |
| M7 | Cache timer for kinds with a prompt cache (claude): `42m` ok, `m:ss` in warn and critical, `cold` expired; level colours from theme |
| M8 | Tap focuses the exact pane; Focus behaviour (herdr only, or also switch to and focus the most recent hosting window) from Config, togglable as an Override |
| M9 | Attention: Card pulses from `blocked`/`done` until the Agent is focused; tab badge on other Layouts containing it |
| M10 | Offline: last Cards greyed, "herdr offline, retrying", backoff 500 ms to 30 s |
| M11 | Live updates from `events.subscribe`; `pane.updated` collapsed before reaching the UI |
| M12 | Follows the Omarchy theme; background pure black by default, wallpaper and transparency configurable |
| M13 | Config is TOML in `~/.config/gjetr/`, one file per Layout, hot-reloaded, never written by gjetr |
| M14 | Overrides persist in `~/.local/state/gjetr/state.json` |
| M15 | Deck: tabs on a short edge, swipe between Layouts, tab bar hidden with one Layout |
| M16 | A Layout declares orientation; selecting it rotates the Display at runtime when the Display allows rotation, without editing `monitors.lua` |
| M17 | Leaves room for the Omarchy bar's strip on the Display |
| M18 | Recap Field for Claude Agents: latest `away_summary` from the session transcript herdr names; per Module `recap = off / inline / expand`, expand by a disclosure area or long press, opening in the Card (growing it; several at once, open state per pane, not persisted) or an overlay per `recap_open = card / overlay`; plain text only |
| M19 | Touch input rotates with a runtime rotation (per named device, or the global touchdevice transform) |
| M20 | A Layout draws every `[[module]]`: side by side as equal columns in landscape, stacked in portrait, with an optional per-Module `weight`; each Module keeps its own settings, Overrides and session state under `<layout>#<index>` |

### Status

As of v0.1.0. "Live" means checked on the real panel and recorded in
`docs/findings/`; "tests" means covered by `node --test` only.

| # | Status | Evidence |
|---|---|---|
| M1 | Done, live | T02: layer, focus, hotplug |
| M2 | Done, live | T03, T05 |
| M3 | Done, live | Priority order matched herdr on 21 real Agents; cache and spaces by tests |
| M4 | Done, live | T06 |
| M5 | Done, live | T04 |
| M6 | Done, live | T05 (detailed on screen; compact in T09 screenshots) |
| M7 | Done, live | T04 |
| M8 | Done, live | T05 herdr focus; T07 window focus switched workspace and window |
| M9 | Done, live | T08 pulse with a fake herdr; T09 badges. A real agent transition not yet seen |
| M10 | Done, live | T03 |
| M11 | Done, live | T03 |
| M12 | Done, live | T02 black; T09 wallpaper and tint |
| M13 | Done, partly live | Validation by tests; hot reload seen on a temporary Config (T09) |
| M14 | Done, live | T06, T09 |
| M15 | Done, partly live | Tabs, badges and selection live; swipe gesture by tests and IPC only |
| M16 | Done, live | T09 rotation and re-apply after reload |
| M17 | Done, live | T02, T09 |
| M18 | Done, partly live | Recaps read for 17 of 21 real Claude Agents; Recap opened in a Card via IPC `toggleRecap` on the panel; neither Card nor overlay opened by touch |
| M19 | Done, partly live | Touch transform follows rotation (`getoption`); tap accuracy in portrait to be confirmed on the panel |
| M20 | Done, partly live | Two Agent Lists (priority, cache) side by side on the panel; `cycleSort` changed only `split#0`. Portrait stacking and weights by tests |

### Next

Docked surface on the main monitor, reserving space across workspaces.

### Later

Workspace List, usage Module, tiled window, Client mode, long-press actions,
a core daemon (ADR 0001).

### Out

Notifications (herdr owns them). Multi-server discovery (duplicate Modules per
server by hand). Replacing the Omarchy bar.

## Architecture

```
manifest.json        kinds: service; keepLoaded
Service.qml          owns Display selection, herdr connection, Config, Overrides, IPC
DeckSurface.qml      PanelWindow per Display, re-registers across hotplug
modules/AgentList/   presentation only
lib/*.js             pure, no Qt imports, node-tested:
  HerdrModel.js        snapshot + events -> Agents, collapsing
  SortPolicy.js        Sort modes
  NamePolicy.js        Agent name fallback
  CacheTimerModel.js   timers.json -> Cache timer + level
  AttentionModel.js    status transitions + focus -> Attention
  ConfigModel.js       TOML -> validated Deck/Layout/Module config
  LayoutPolicy.js      bar inset, Module rectangles, Card placement
  vendor/toml.js       bundled parser
tests/               node for lib, qmltestrunner for components
```

Rules: one writer per piece of state, and the UI is never it. Config values that
reach a process command go through an allowlist. Hardware acceptance on the
real panel gates each milestone.

## Risks

| Risk | Reduced by |
|---|---|
| Touch does not follow a runtime rotation | Spike T01 |
| Socket stream awkward in QML | Spike T01 |
| Shell reload during development restarts the bar | Accepted cost, ADR 0001 |
| herdr protocol drift | All protocol in `HerdrModel.js` |
