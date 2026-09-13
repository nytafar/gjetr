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
Layout) are **Overrides**. They live in `~/.local/state/gjetr/state.json` and
shadow Config until reset. See [Overrides](#overrides).

Copy [`examples/gjetr/`](../examples/gjetr) to `~/.config/gjetr/` to start. With
no Config at all, gjetr shows one Agent List on `HDMI-A-2`.

```
~/.config/gjetr/
  gjetr.toml            socket and Displays
  layouts/
    agents.toml         one file per Layout
    workspaces.toml
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

A place the dashboard is shown. Only the first `[[display]]` is used today.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `name` | string | `"HDMI-A-2"` | The output, as `hyprctl monitors` names it. Letters, digits, `.`, `_`, `-`. A Display without a valid name is skipped |
| `deck` | list of Layout names | `["agents"]` | The Deck: Layouts to tab through, in order. Each is `layouts/<name>.toml`. Names use letters, digits, `-` and `_`, at most 32 characters. Duplicates are dropped |
| `rotatable` | boolean | `false` | May gjetr rotate the output to fit the active Layout's orientation |
| `touch_devices` | list of device names | `[]` | Touchscreens that rotate with the Display (see [Rotation and touch](#rotation-and-touch)) |
| `background` | string | `"black"` | `"black"`, `"theme"` (Omarchy theme background), `"wallpaper"` (the Omarchy wallpaper shows through), `"transparent"` (same as wallpaper), `"#rrggbb"`, or `"#aarrggbb"` to tint the wallpaper |

```toml
[[display]]
name = "HDMI-A-2"
deck = ["agents", "wide"]
rotatable = true
touch_devices = ["wch.cn-usb2iic_ctp_control", "wch.cn-usb2iic_ctp_control-1"]
background = "#c0000000"
```

The surface sits on the Bottom layer, so ordinary windows cover it and the
Omarchy bar stays on top. Content steps out of the bar's strip on its own.

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
| `type` | `"agent-list"`, `"workspace-list"` | required | Module type. Unknown types are skipped |
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
| `preset` | `"detailed"`, `"compact"` | `"detailed"` | Card Fields: detailed shows status, kind, name, workspace › tab and Cache timer; compact drops workspace › tab |
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

- **Workspace**: status bar, label (its number when it has none), tab count.
- **Tab**, indented: status bar, label or number, and its pane count. A tab with
  a single pane shows that pane's agent kind instead (`shell` without an
  agent) and does not expand, since it would only repeat itself.
- **Pane**, indented again: status bar, agent kind mark, name, and the kind
  (`shell` without an agent). Names follow the Agent name rules.

A workspace's or tab's status is the one herdr reports for it, else the most
urgent status below it (blocked, done, working, idle). The Focused workspace,
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
  "displays": { "HDMI-A-2": { "layout": "wide" } }
}
```

A Module is keyed by `<layout>#<position>` (its place among the Layout's valid
Modules, from 0), a Display by its output name. An Agent List keeps `sort` and
`focus`; a Workspace List keeps `focus`. An
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

## IPC

Every function is on target `nytafar.gjetr`:

```bash
omarchy-shell nytafar.gjetr <function> [argument]
```

| Function | Does |
|---|---|
| `state` | JSON: Display, bar inset, herdr connection, Config summary and errors, the active Layout's `modules` (key, type, weight, rectangle), `workspaces` (Focused workspace, expansion and rows of the first Workspace List), Deck, Overrides, Attention, Recap, every Card. `sortMode`, `focusMode`, `recap` and `cards` describe the first Agent List |
| `reconnect` | Drop and reopen the herdr connection |
| `focus <pane-id>` | Focus an Agent's pane, as a tap does |
| `toggleRecap <pane-id>` | Open or close an Agent's full Recap in the first Agent List, as a tap on `recap` does. Prints `open`, `closed`, or why nothing happened (`unknown pane`, `no agent list`, `no recap`, `recap is inline, not expand`). `state` → `recap.openCards` lists the open Cards |
| `cycleSort` | Next Sort mode of the first Agent List, as a header tap does |
| `toggleFocus` | Flip Focus behaviour of the first Agent List |
| `selectLayout <name>` | Show a Layout of the Deck |
| `nextLayout`, `previousLayout` | The step a swipe takes |
| `toggleExpand <node>` | Open or close a workspace (`w:<id>`) or tab (`t:<id>`) in the first Workspace List. Prints `expanded`, `collapsed`, `unknown node` or `no workspace list`. `state` → `workspaces.rows` lists the rows drawn |
| `tapRow <node> <zone>` | Tap a row (`w:<id>`, `t:<id>`, `p:<id>`) of the first Workspace List in zone `row` or `chevron`, as a finger does. Prints what it did |
| `resetOverrides` | Clear every Override |
| `useConfigDir <path>` | Read Config from another directory until the shell restarts (testing). `""` goes back |

## Limits

- Config files over 64 KB are refused.
- One herdr server per Config. Watch a second server with a second plugin
  instance or Config later; multi-server discovery is out of scope.
- Only the first `[[display]]` is drawn.
