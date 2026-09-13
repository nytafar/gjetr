# Configuration

gjetr reads its Config from `~/.config/gjetr/` and never writes it. Every file
is TOML and is reloaded live when it changes. A mistyped value falls back to its
default, and a file that does not parse falls back as a whole. Either way gjetr
logs one line naming the file, the key and what it expected:

```bash
journalctl --user -f | grep gjetr
omarchy-shell nytafar.gjetr state | jq .config
```

Choices made on the Display itself (Sort mode, Focus behaviour, the active
Layout, whether a Dock is shown) are **Overrides**. They live in `~/.local/state/gjetr/state.json` and
shadow Config until reset. See [Overrides](#overrides).

Copy [`examples/gjetr/`](../examples/gjetr) to `~/.config/gjetr/` to start. With
no Config at all, gjetr shows one Agent List on `HDMI-A-2`.

```
~/.config/gjetr/
  gjetr.toml            socket and Displays
  layouts/
    agents.toml         one file per Layout
    workspaces.toml
    usage.toml
    dock.toml
```

## `gjetr.toml`

### `socket`

herdr's API socket. Default `~/.config/herdr/herdr.sock`. `~/` expands to your
home. It must be absolute, contain no spaces, and fit a Unix socket path (107
bytes). A named herdr session lives at `~/.config/herdr/sessions/<name>/herdr.sock`.

```toml
socket = "~/.config/herdr/sessions/work/herdr.sock"
```

### `[[display]]`

A place the dashboard is shown. Every `[[display]]` is drawn, each with its own
Deck: for example the touchscreen as a `surface` and a [Dock](#docks) beside
your windows on the main monitor. An output holds one Display; a second
`[[display]]` with the same `name` is skipped with a logged error.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `name` | string | `"HDMI-A-2"` | The output, as `hyprctl monitors` names it. Letters, digits, `.`, `_`, `-`. A Display without a valid name is skipped |
| `kind` | string | `"surface"` | `"surface"`: the whole output. `"dock"`: a strip along one edge, beside windows (see [Docks](#docks)). Any other value skips the Display |
| `deck` | list of Layout names | `["agents"]` | The Deck: Layouts to tab through, in order. Each is `layouts/<name>.toml`. Names use letters, digits, `-` and `_`, at most 32 characters. Duplicates are dropped |
| `rotatable` | boolean | `false` | Surface only. May gjetr rotate the output to fit the active Layout's orientation |
| `touch_devices` | list of device names | `[]` | Surface only. Touchscreens that rotate with the Display (see [Rotation and touch](#rotation-and-touch)) |
| `background` | string | `"black"` | `"black"`, `"theme"` (Omarchy theme background), `"wallpaper"` (the Omarchy wallpaper shows through), `"transparent"` (same as wallpaper), `"#rrggbb"`, or `"#aarrggbb"` to tint the wallpaper |
| `refresh_seconds` | whole number, 60 to 86400 | `900` | Seconds between usage refreshes for the Usage Modules in this Display's Deck. Out of range clamps, with a logged error |

```toml
[[display]]
name = "HDMI-A-2"
deck = ["agents", "wide"]
rotatable = true
touch_devices = ["wch.cn-usb2iic_ctp_control", "wch.cn-usb2iic_ctp_control-1"]
background = "#c0000000"
```

A surface sits on the Bottom layer, so ordinary windows cover it and the
Omarchy bar stays on top. Content steps out of the bar's strip on its own.

## Docks

A Dock is a Display along one edge of an output, beside your windows. It stays
on every workspace and reserves its strip (a layer-shell exclusive zone), so
windows tile beside it instead of under it. It never takes keyboard focus, and
mouse clicks and the scroll wheel work on it like taps and swipes on a
touchscreen.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `kind` | string | | `"dock"` |
| `name` | string | | The output, e.g. `"DP-1"` |
| `edge` | string | `"left"` | `"left"`, `"right"`, `"top"` or `"bottom"`. Any other value skips the Dock, with a logged error |
| `size` | whole number, 120 to 2000 | `360` | Logical pixels: the width of a left or right Dock, the height of a top or bottom one. Out of range clamps, with a logged error. A Dock never takes more than half of its output |
| `visible` | boolean | `true` | Shown when gjetr starts. `toggleDock` keeps its choice as an Override |
| `deck`, `background`, `refresh_seconds` | | | As for any Display |

`rotatable` and `touch_devices` do not apply to a Dock and are ignored with a
logged error; `edge`, `size` and `visible` are ignored on a surface the same
way.

```toml
[[display]]
name = "HDMI-A-2"
deck = ["wide", "usage"]

[[display]]
kind = "dock"
name = "DP-1"
size = 360
deck = ["dock"]
```

Without `edge` the Dock goes on the left; add `edge = "right"` (or `top`,
`bottom`) to move it.

with `layouts/dock.toml`, Agents over usage:

```toml
orientation = "portrait"

[[module]]
type = "agent-list"
weight = 2
preset = "compact"

[[module]]
type = "usage"
show = ["limits"]
```

**Orientation.** A Dock's shape decides it: left and right Docks are portrait,
top and bottom Docks landscape. Layouts built for the other orientation are
skipped (all are kept if none fits). A Dock never rotates its output or touch
input. Modules stack in a portrait Dock and sit side by side in a landscape
one; with several Layouts, tabs go on the short edge (top of a portrait Dock,
left of a landscape one). Below 480 pixels wide, list headers show their sort,
tap and focus values without the captions.

**Layering.** A Dock sits on the Top layer, the same as the Omarchy bar, so
ordinary windows never cover it; fullscreen windows still do. Its exclusive
zone keeps it beside the bar, never under it. On the same edge as the bar, the
surface mapped first sits at the edge: after a shell start the bar is outside
and the Dock inside it, and showing a hidden Dock puts it inside the bar again.

**Showing and hiding.** Hidden, a Dock is unmapped and reserves nothing, so
windows take the space back. The choice is an Override per output and survives
restarts; `resetOverrides` returns to `visible` from Config.

```bash
omarchy-shell nytafar.gjetr toggleDock DP-1   # or showDock, hideDock
omarchy-shell nytafar.gjetr toggleDock ""     # the first Dock
```

Bind it to a key in `~/.config/hypr/bindings.lua`, with Omarchy's helper:

```lua
o.bind("SUPER + CTRL + G", "Toggle gjetr dock", "omarchy-shell nytafar.gjetr toggleDock DP-1")
```

or with Hyprland's own:

```lua
hl.bind("SUPER + CTRL + G", hl.dsp.exec_cmd("omarchy-shell nytafar.gjetr toggleDock DP-1"), { description = "Toggle gjetr dock" })
```

Pick a key that is free (`omarchy menu keybindings --print`), and check
`hyprctl configerrors` after saving.

**Hotplug.** Like a surface, a Dock goes away with its output and comes back
with it, keeping its Deck and visibility.

**Sharing a Layout.** Module Overrides and session state are keyed by Layout
(`<layout>#<index>`), so a Layout shown on two Displays at once is the same
Modules on both: a Sort mode chosen on one shows on the other, and so do open
Recaps and expanded rows. Give a Dock its own Layout file to keep it separate.

## `layouts/<name>.toml`

A Layout: the Modules on a Display and the orientation they are built for.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `orientation` | string | `"portrait"` | `"portrait"`, `"landscape"` or `"any"` |
| `[[module]]` | tables | one Agent List | The Modules, in order. Every one is drawn |

A missing Layout file gives the default Agent List, with a logged error.

### Several Modules

Every `[[module]]` of a Layout is drawn, in order. On a landscape Display they
sit side by side as columns; on a portrait one they are stacked as rows. By
default each gets an equal share. A hairline separates neighbours.

Each Module is its own: it has its own settings, its own Overrides (a header
tap on one Agent List changes only that one) and its own open Recaps. Two Agent
Lists with different Sort modes side by side are fine.

Keys every `[[module]]` takes, whatever its type:

| Key | Values | Default | Meaning |
|---|---|---|---|
| `type` | `"agent-list"`, `"workspace-list"`, `"usage"` | required | Module type. Unknown types are skipped |
| `weight` | number above 0, at most 100 | `1` | The Module's share of the width (landscape) or height (portrait). `weight = 2` beside a `weight = 1` takes two thirds |

```toml
orientation = "landscape"

[[module]]
type = "agent-list"
sort = "priority"
weight = 2

[[module]]
type = "agent-list"
sort = "cache"
preset = "compact"
```

### `[[module]]` with `type = "agent-list"`

Every Agent across workspaces as a Card.

| Key | Values | Default | Meaning |
|---|---|---|---|
| `sort` | `"spaces"`, `"priority"`, `"cache"` | `"spaces"` | Default Sort mode. Tapping the list header cycles it as an Override |
| `preset` | `"detailed"`, `"compact"` | `"detailed"` | Card Fields: detailed shows status (glyph and word), kind, name, workspace › tab and Cache timer; compact drops workspace › tab and the status word, keeping the glyph |
| `focus` | `"herdr"`, `"window"` | `"herdr"` | Focus behaviour on tap. Tapping `focus` in the header flips it as an Override |
| `recap` | `"off"`, `"inline"`, `"expand"` | `"off"` | Recap Field for Claude Agents |
| `recap_open` | `"card"`, `"overlay"` | `"card"` | With `recap = "expand"`: open the full Recap inside the Card or over the list |
| `highlight_workspace` | `true`, `false` | `true` | Tint the Cards of Agents in herdr's Focused workspace. It never filters the list |

```toml
orientation = "portrait"

[[module]]
type = "agent-list"
sort = "priority"
preset = "detailed"
focus = "window"
recap = "expand"
recap_open = "card"
```

#### Sort modes

`spaces` and `priority` show the same order as herdr's own agent panel;
`cache` is gjetr's own:

- `spaces`: herdr's workspace, tab and pane order.
- `priority`: herdr's attention queue. Blocked first, then done (finished and
  not yet seen), working, idle, unknown. Within each, the most recent status
  change comes first.
- `cache`: soonest-expiring first, so the prompt cache about to go cold is on
  top. Live [cache-ttl](https://github.com/nytafar/herdr-cache-ttl) timers by
  time left, shortest first, then expired (`cold`) timers, then Agents without
  a timer. Ties go to state (blocked, done, working, idle, unknown), then the
  most recent status change. This is the reverse of the cache-ttl plugin's own
  warmest-first view, on purpose.

#### Focus behaviour

- `herdr`: a tap focuses the exact pane in herdr.
- `window`: after herdr accepts the pane focus, gjetr finds the terminal
  window running a herdr client of this socket. It walks the process tree below
  each Hyprland window. It then switches to that window's workspace and focuses
  it. If several windows host a client, the most recently focused one wins.
  Clients started as `herdr`, `herdr --session NAME` and
  `herdr session attach NAME` count. `herdr --remote` and herdr subcommands do
  not.

#### Status

A Card shows its Agent's status as a glyph and a word, so it reads without
colour. While the Agent is working, the glyph turns:

| Status | Glyph | Colour |
|---|---|---|
| working | ◌, turning | accent |
| idle | ○ | none; the glyph and the Card's text are slightly dimmed |
| blocked | ▲ | urgent |
| done | ✓ | the theme's green (`green` in its `colors.toml`), else accent |
| unknown | · | muted |

The `compact` preset shows the glyph without the word. Blocked and done Cards
also pulse while their Agent is in Attention.

#### Recap

The latest session recap Claude Code wrote for a Claude Agent. herdr reports
the Agent's session id; gjetr finds `~/.claude/projects/*/<session-id>.jsonl`,
checks its modification time every 5 seconds, and reads its `away_summary`
lines only when it changed. The text is untrusted: control characters are
removed, it is capped at 1200 characters and always shown as plain text.

- `off`: nothing is read.
- `inline`: two lines under the Card's Fields; Cards grow to fit.
- `expand`: Cards with a Recap get a `recap` area at their edge. Tapping it, or
  a long press on the Card, opens the whole Recap. Where is up to `recap_open`:
  - `card` (default): under the Card's Fields. The Card grows and pushes the
    Cards below it down. Tapping the Recap, the `recap` area or a long press
    closes it again. Several Cards can be open at once.
  - `overlay`: over the list. A tap anywhere closes it.

Which Recaps are open is kept per Module and pane for as long as the shell
runs. It follows each Agent through re-sorts and updates, is forgotten when the
pane goes away, and is never written to Config or `state.json`. A Card opening
above the part of the list you are looking at does not move what is on screen.

### `[[module]]` with `type = "workspace-list"`

herdr's workspaces, tabs and panes as a tree that expands in place. Unlike the
Agent List it includes panes without an agent, so it is the way to reach a
plain shell from the Display.

| Key | Values | Default | Meaning |
|---|---|---|---|
| `tap` | `"expand"`, `"focus"` | `"expand"` | What a tap on a row does (below) |
| `focus` | `"herdr"`, `"window"` | `"herdr"` | Focus behaviour for this Module's taps, as for the Agent List. Tapping `focus` in the header flips it as an Override |

```toml
orientation = "landscape"

[[module]]
type = "workspace-list"
tap = "expand"
focus = "window"

[[module]]
type = "agent-list"
```

Rows, from the top of the tree down:

- **Workspace**: status glyph, label (its number when it has none), tab count.
- **Tab**, indented: status glyph, label or number, and its pane count. A tab with
  a single pane shows that pane's agent kind instead (`shell` without an
  agent) and does not expand, since it would only repeat itself.
- **Pane**, indented again: status glyph, agent kind mark, name, and the kind
  (`shell` without an agent). Names follow the Agent name rules.

A workspace's or tab's status is the one herdr reports for it, else the most
urgent status below it (blocked, done, working, idle). Glyphs, colours and the
turning working glyph are the same as on a Card, without the word. The Focused workspace,
tab and pane are drawn selected. A row pulses while a pane in it is in
Attention.

Taps:

- `expand`: tapping a workspace or tab opens or closes it. Tapping a pane, or
  a tab with one pane, focuses that pane.
- `focus`: tapping a row focuses its workspace, tab or pane in herdr. A
  separate chevron area at the right edge of a workspace or tab opens or
  closes it.

Which rows are open is kept per Module for as long as the shell runs, and never
written anywhere. It survives updates without moving the scroll position; rows
of workspaces and tabs that close are forgotten.

### Focused workspace

herdr has one Focused workspace. With `highlight_workspace = true` (the
default), an Agent List tints the Cards of Agents in it; the Workspace List
draws its row selected. Neither ever hides anything.

### `[[module]]` with `type = "usage"`

Each AI provider's rate limits and usage, from the records Omarchy's usage
collectors write to `~/.local/state/omarchy/agents/usage/` (one JSON file per
provider). gjetr reads them, watches each file, and runs
`omarchy-agent-usage-update` itself every `refresh_seconds`, so the numbers
stay fresh without Omarchy's agents bar widget. Only one run goes at a time.
Tap the Module's header to refresh now.

| Key | Values | Default | Meaning |
|---|---|---|---|
| `show` | list of `"limits"`, `"today"`, `"recent_days"`, `"models"` | `["limits"]` | What each provider shows, in this order. Unknown items are skipped with an error |
| `providers` | list of provider ids | every ready provider | Which providers, in this order. A named provider that is not ready, or has no record yet, is shown quietly |
| `refresh_seconds` | whole number, 60 to 86400 | the Display's, else `900` | Seconds between refreshes. With several Usage Modules in the Deck, the smallest wins |

```toml
orientation = "landscape"

[[module]]
type = "agent-list"

[[module]]
type = "usage"
show = ["limits", "today", "recent_days", "models"]
providers = ["claude", "codex"]
```

Items:

- `limits`: a meter per limit window (such as a 5-hour session or a week) with
  the share used and the time to reset. The meter turns the theme's accent
  colour from 75% and urgent from 90%.
- `today`: today's tokens, prompts and sessions.
- `recent_days`: tokens per day over the last 7 days as small bars, today in
  accent.
- `models`: today's tokens by model, largest first, up to 5.

A provider whose collector reports it is not ready (signed out, unreachable)
shows only its name and status line, muted. Numbers older than two refreshes
show when they were last updated.

## Rotation and touch

With `rotatable = true`, selecting a Layout whose orientation differs from the
output's turns the output at runtime:

```
hyprctl eval 'hl.monitor({ output = "HDMI-A-2", mode = "preferred", position = "1920x0", scale = 1, transform = 1 })'
```

Position and scale are read back from `hyprctl monitors` first. gjetr never
edits `monitors.lua`. A `hyprctl reload` restores the configured orientation;
gjetr applies the Layout's orientation again half a second later.

Hyprland does not rotate touch input with a runtime transform, so gjetr gives
touch the same transform:

- With `touch_devices`, each named device gets
  `hl.device({ name = ..., output = ..., transform = N })`.
- Without it, gjetr sets the global `input.touchdevice.transform`, which covers
  every touchscreen that has no transform of its own.

Find device names with `hyprctl devices -j | jq .touch`.

With `rotatable = false`, Layouts built for the other orientation are skipped.
If that would skip every Layout, all of them are kept.

## The Deck

With more than one Layout, tabs appear on a short edge of the Display: the one
opposite the bar when the bar sits on a short edge, otherwise the left edge in
landscape and the top in portrait. Tap a tab, or swipe sideways over the
content, to change Layout; towards the left shows the next one. A tab carries a
red badge with the number of Agents in Attention while its Layout is not shown.

## Attention

An Agent enters Attention when it moves to `blocked` or `done` while herdr does
not have it focused. Its Card pulses in the theme's urgent colour (blocked) or
accent colour (done) until herdr focuses it or you tap it. In a Workspace
List, its pane row and the tab and workspace rows above it pulse too. Agents that are
already blocked or done when gjetr starts do not pulse. gjetr sends no
notifications; herdr owns those.

## Overrides

`~/.local/state/gjetr/state.json`, written only by gjetr:

```json
{
  "version": 1,
  "modules": { "agents#0": { "sort": "priority", "focus": "window" } },
  "displays": { "HDMI-A-2": { "layout": "wide" }, "DP-1": { "visible": false } }
}
```

A Module is keyed by `<layout>#<position>` (its place among the Layout's valid
Modules, from 0), shared by every Display that shows the Layout. A Display is
keyed by its output name and keeps its active `layout` and, for a Dock,
`visible`. An Agent List keeps `sort` and `focus`; a Workspace List keeps
`focus`. An
Override equal to the Config value removes itself, so a later Config edit applies
again. Reset every Override with:

```bash
omarchy-shell nytafar.gjetr resetOverrides
```

## Other files gjetr reads

| File | Owner | Used for |
|---|---|---|
| `~/.local/state/herdr/plugins/cache-ttl/timers.json` | cache-ttl herdr plugin | Cache timers |
| `~/.config/herdr/plugins/config/cache-ttl/config.json` | cache-ttl herdr plugin | Warn and critical thresholds |
| `~/.claude/projects/*/<session-id>.jsonl` | Claude Code | Recap (only when `recap` is not `off`) |
| `$OMARCHY_PATH/shell/plugins/agents/assets/*.svg` | Omarchy | Agent kind marks |
| `~/.local/state/omarchy/current/theme/colors.toml` | Omarchy theme | `green`, the colour of `done` |
| `~/.local/state/omarchy/agents/usage/*.json` | `omarchy-agent-usage-update` | Usage Module (only while a Usage Module is in the Deck) |

## IPC

Every function is on target `nytafar.gjetr`:

```bash
omarchy-shell nytafar.gjetr <function> [argument]
```

| Function | Does |
|---|---|
| `state` | JSON: `displays` (every Display: kind, edge, size, shown, surface with layer and exclusive zone, Deck, Modules). The rest describes the primary Display, the first surface: Display, bar inset, herdr connection, Config summary and errors, the active Layout's `modules` (key, type, weight, rectangle), `workspaces` (Focused workspace, expansion and rows of the first Workspace List), Deck, Overrides, Attention, Recap, every Card. `sortMode`, `focusMode`, `recap` and `cards` describe the first Agent List |
| `reconnect` | Drop and reopen the herdr connection |
| `focus <pane-id>` | Focus an Agent's pane, as a tap does |
| `toggleRecap <pane-id>` | Open or close an Agent's full Recap in the first Agent List, as a tap on `recap` does. Prints `open`, `closed`, or why nothing happened (`unknown pane`, `no agent list`, `no recap`, `recap is inline, not expand`). `state` → `recap.openCards` lists the open Cards |
| `cycleSort` | Next Sort mode of the first Agent List, as a header tap does |
| `toggleFocus` | Flip Focus behaviour of the first Agent List |
| `selectLayout <name>` | Show a Layout of the primary Display's Deck |
| `nextLayout`, `previousLayout` | The step a swipe takes, on the primary Display |
| `toggleDock <output>` | Show or hide the Dock on an output (`""` for the first Dock), kept as an Override. Prints `shown`, `hidden`, or why nothing happened (`no dock DP-9`, `HDMI-A-2 is not a dock`) |
| `showDock <output>`, `hideDock <output>` | The same, one way |
| `toggleExpand <node>` | Open or close a workspace (`w:<id>`) or tab (`t:<id>`) in the first Workspace List. Prints `expanded`, `collapsed`, `unknown node` or `no workspace list`. `state` → `workspaces.rows` lists the rows drawn |
| `tapRow <node> <zone>` | Tap a row (`w:<id>`, `t:<id>`, `p:<id>`) of the first Workspace List in zone `row` or `chevron`, as a finger does. Prints what it did |
| `refreshUsage` | Run `omarchy-agent-usage-update` now, as a tap on a Usage header does. Prints `started`, `already running` or `no usage module`. `state` → `usage` shows records, errors, runs and each provider's age |
| `resetOverrides` | Clear every Override |
| `useConfigDir <path>` | Read Config from another directory until the shell restarts (testing). `""` goes back |

## Limits

- Config files over 64 KB are refused.
- One herdr server per Config. Watch a second server with a second plugin
  instance or Config later; multi-server discovery is out of scope.
- One Display per output. Functions that name no Display (`selectLayout`,
  `cycleSort`, `toggleExpand`, ...) act on the primary Display, then on shown
  Docks for Modules it does not have.
