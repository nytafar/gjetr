# Set up gjetr with a coding agent

For a coding agent (Claude Code, Codex, ...) asked to set up gjetr on an
Omarchy machine. Work through the steps in order, run each command and read
its output. Ask the user where a step says so.

## Never

- Never edit `/usr/share/omarchy` or the plugin's own files.
- Never write `~/.config/gjetr/` by hand where `installConfig` can, and never
  delete the `*.bak.*` files it keeps.
- Never edit `~/.local/state/gjetr/state.json`; `resetOverrides` clears it.
- Never change herdr's config for gjetr, and never run `herdr update`.
- Never leave a Hyprland config change unchecked: run `hyprctl configerrors`
  after every save and expect no output.

## 1. Check that gjetr runs

```bash
omarchy-shell nytafar.gjetr state | jq '.config.dir, .config.source'
```

No answer: install it with
`omarchy plugin add https://github.com/nytafar/gjetr.git --enable` and try
again.

## 2. Look at the machine

```bash
hyprctl monitors -j | jq -r '.[] | "\(.name) \(.width)x\(.height) focused=\(.focused)"'
hyprctl devices -j | jq -r '.touch[].name'
grep -n 'hl.device' ~/.config/hypr/input.lua
herdr status server
omarchy-shell nytafar.gjetr state | jq '.detect, .herdr.socket, .herdr.online'
```

- A touchscreen listed under `.touch` without an
  `hl.device({ name = ..., output = ... })` rule in `input.lua` lands its taps
  on the wrong monitor. Ask the user which output it is, add the rule (both
  names if the device also appears with a `-1` suffix), save, and run
  `hyprctl configerrors`.
- `.detect.preset` is what gjetr shows without a Config, and `.detect.reason`
  says why.
- `.herdr.online` must be `true`. If `herdr status server` names another socket
  than `.herdr.socket`, note it for step 4.

## 3. Choose a preset

```bash
omarchy-shell nytafar.gjetr presets
```

| Preset | For |
|---|---|
| `panel` | A touchscreen beside the desk: the Agent List beside usage |
| `sidebar` | No touchscreen: a Dock on the left of the main monitor, doing the job of herdr's sidebar |
| `panel-sidebar` | Both |
| `minimal` | One Agent List on a touchscreen, every key explained, to build on |

Take the detected one unless the user asked for something else. Ask when
there is a touchscreen and it is unclear whether they also want the Dock.

## 4. Install it

```bash
omarchy-shell nytafar.gjetr installConfig <preset>
```

Read the summary it prints:

- `created`, `unchanged`, or `replaced (...), yours kept as <file>.bak.<epoch>`:
  tell the user the backup names.
- `set the surface's name` or `set the Dock's name`: edit that `name` in
  `~/.config/gjetr/gjetr.toml` to an output from step 2.
- If herdr serves another socket (step 2), add `socket = "<path>"` at the top of
  `gjetr.toml`.

## 5. Adjust the Layouts

The installed Layouts are in `~/.config/gjetr/layouts/`. Edit them for what the
user asked, with the keys in
[CONFIGURATION.md](CONFIGURATION.md#layoutsnametoml): `density`, `sort`,
`preset`, `recap`, `indicator`, `focus`, `weight`, and `pin = "end"` on a Usage
Module. A Layout named in a Deck but missing from `layouts/` comes from the
plugin's `presets/layouts/`; copy it from there before changing it. Changes
apply on save.

## 6. Validate

```bash
omarchy-shell nytafar.gjetr state | jq '.config.errors'
omarchy-shell nytafar.gjetr state | jq '[.displays[] | {name, kind, shown, present, layout: .deck.active}]'
```

`config.errors` must be `[]`; each error names the file, line and key to fix.
Every Display must be `present`. Ask the user to confirm it looks right.

## 7. Bind the Dock toggle

Only with a Dock (`sidebar`, `panel-sidebar`). Find a free key, then add a
binding to `~/.config/hypr/bindings.lua` with the Dock's output:

```bash
omarchy menu keybindings --print | grep -i "SUPER + CTRL + G"
```

```lua
o.bind("SUPER + CTRL + G", "Toggle gjetr dock", "omarchy-shell nytafar.gjetr toggleDock DP-1")
```

Save, run `hyprctl configerrors` (no output), and check that
`omarchy-shell nytafar.gjetr toggleDock DP-1` prints `hidden` and then `shown`.

## 8. Report

Tell the user which preset you installed, the files written and backed up, the
outputs used, and the keybinding. Point them at
[CONFIGURATION.md](CONFIGURATION.md) for everything else.
