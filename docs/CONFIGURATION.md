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
| `[[module]]` | tables | one Agent List | The Modules, in order. Only the first `agent-list` is drawn today |

A missing Layout file gives the default Agent List, with a logged error.

### `[[module]]` with `type = "agent-list"`

Every Agent across workspaces as a Card.

| Key | Values | Default | Meaning |
|---|---|---|---|
| `type` | `"agent-list"` | required | Module type. Unknown types are skipped |
| `sort` | `"spaces"`, `"priority"`, `"cache"` | `"spaces"` | Default Sort mode. Tapping the list header cycles it as an Override |
| `preset` | `"detailed"`, `"compact"` | `"detailed"` | Card Fields: detailed shows status, kind, name, workspace › tab and Cache timer; compact drops workspace › tab |
| `focus` | `"herdr"`, `"window"` | `"herdr"` | Focus behaviour on tap. Tapping `focus` in the header flips it as an Override |
| `recap` | `"off"`, `"inline"`, `"expand"` | `"off"` | Recap Field for Claude Agents |

```toml
orientation = "portrait"

[[module]]
type = "agent-list"
sort = "priority"
preset = "detailed"
focus = "window"
recap = "expand"
```

#### Sort modes

Each Sort mode shows the same order as herdr's own agent panel:

- `spaces`: herdr's workspace, tab and pane order.
- `priority`: herdr's attention queue. Blocked first, then done (finished and
  not yet seen), working, idle, unknown. Within each, the most recent status
  change comes first.
- `cache`: the [cache-ttl](https://github.com/nytafar/herdr-cache-ttl)
  plugin's order, warmest first: most time left, expired (`cold`) timers after
  every live one, Agents without a timer last. Ties go to attention, then
  recency.

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
  a long press on the Card, shows the whole Recap over the list. A tap closes it.

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
accent colour (done) until herdr focuses it or you tap it. Agents that are
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

A Module is keyed by `<layout>#<position>`, a Display by its output name. An
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
| `state` | JSON: Display, bar inset, herdr connection, Config summary and errors, Deck, Overrides, Attention, Recap, every Card |
| `reconnect` | Drop and reopen the herdr connection |
| `focus <pane-id>` | Focus an Agent's pane, as a tap does |
| `cycleSort` | Next Sort mode, as a header tap does |
| `toggleFocus` | Flip Focus behaviour |
| `selectLayout <name>` | Show a Layout of the Deck |
| `nextLayout`, `previousLayout` | The step a swipe takes |
| `resetOverrides` | Clear every Override |
| `useConfigDir <path>` | Read Config from another directory until the shell restarts (testing). `""` goes back |

## Limits

- Config files over 64 KB are refused.
- One herdr server per Config. Watch a second server with a second plugin
  instance or Config later; multi-server discovery is out of scope.
- Only the first `[[display]]` and the first Agent List of a Layout are drawn.
