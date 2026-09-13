"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")
const loadLib = require("./support/loadLib.cjs")

const Config = loadLib("lib/ConfigModel.js")

const HOME = "/home/test"

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

test("a missing gjetr.toml yields the defaults without errors", () => {
  const read = Config.readMain(null, HOME)
  assert.deepEqual(Array.from(read.errors), [])
  assert.deepEqual(plain(read.config), {
    socket: "/home/test/.config/herdr/herdr.sock",
    displays: [{ name: "HDMI-A-2", deck: ["agents"], rotatable: false, background: "black", touchDevices: [], refreshSeconds: null }]
  })
})

test("readMain reads displays, deck order and socket", () => {
  const read = Config.readMain(`
socket = "~/run/herdr.sock"

[[display]]
name = "HDMI-A-2"
deck = ["agents", "overview"]
rotatable = true
background = "#101315"

[[display]]
name = "DP-2"
deck = ["agents"]
background = "theme"
`, HOME)
  assert.deepEqual(Array.from(read.errors), [])
  assert.deepEqual(plain(read.config), {
    socket: "/home/test/run/herdr.sock",
    displays: [
      { name: "HDMI-A-2", deck: ["agents", "overview"], rotatable: true, background: "#101315", touchDevices: [], refreshSeconds: null },
      { name: "DP-2", deck: ["agents"], rotatable: false, background: "theme", touchDevices: [], refreshSeconds: null }
    ]
  })
})

test("a TOML syntax error names the file, line and column and falls back", () => {
  const read = Config.readMain('socket = "x\n[[display]]\n', HOME)
  assert.equal(read.errors.length, 1)
  assert.match(read.errors[0], /^gjetr\.toml:1:\d+: /)
  assert.doesNotMatch(read.errors[0], /\n/)
  assert.deepEqual(plain(read.config), plain(Config.readMain(null, HOME).config))
})

test("invalid values fall back per field with a clear error", () => {
  const read = Config.readMain(`
socket = "relative/herdr.sock"

[[display]]
name = "HDMI-A-2"
deck = ["agents", "../../etc/passwd", "agents", 7]
rotatable = "yes"
background = "blue"
colour = "red"
`, HOME)
  const config = plain(read.config)
  assert.equal(config.socket, "/home/test/.config/herdr/herdr.sock")
  assert.deepEqual(config.displays, [{ name: "HDMI-A-2", deck: ["agents"], rotatable: false, background: "black", touchDevices: [], refreshSeconds: null }])
  const text = read.errors.join("\n")
  assert.match(text, /gjetr\.toml: socket: /)
  assert.match(text, /display\[0\]\.deck\[1\]: /)
  assert.match(text, /display\[0\]\.deck\[3\]: /)
  assert.match(text, /display\[0\]\.rotatable: expected true or false/)
  assert.match(text, /display\[0\]\.background: /)
  assert.match(text, /display\[0\]\.colour: unknown key/)
})

test("a duplicate deck entry is dropped quietly", () => {
  const read = Config.readMain('[[display]]\nname = "DP-1"\ndeck = ["a", "b", "a"]\n', HOME)
  assert.deepEqual(Array.from(read.config.displays[0].deck), ["a", "b"])
  assert.deepEqual(Array.from(read.errors), [])
})

test("a display without a valid name is skipped; none left means the default", () => {
  const read = Config.readMain('[[display]]\nname = "HDMI A 2; rm"\ndeck = ["agents"]\n', HOME)
  assert.equal(read.config.displays.length, 1)
  assert.equal(read.config.displays[0].name, "HDMI-A-2")
  assert.match(read.errors.join("\n"), /display\[0\]\.name: /)
  assert.match(read.errors.join("\n"), /no valid display/)
})

test("an empty deck falls back to the default deck", () => {
  const read = Config.readMain('[[display]]\nname = "DP-1"\ndeck = []\n', HOME)
  assert.deepEqual(Array.from(read.config.displays[0].deck), ["agents"])
  assert.match(read.errors.join("\n"), /display\[0\]\.deck: /)
})

test("a single [display] table is accepted as one display", () => {
  const read = Config.readMain('[display]\nname = "DP-1"\n', HOME)
  assert.deepEqual(Array.from(read.errors), [])
  assert.equal(read.config.displays[0].name, "DP-1")
  assert.deepEqual(Array.from(read.config.displays[0].deck), ["agents"])
})

test("unknown top-level keys and wrong shapes are reported", () => {
  const read = Config.readMain('display = "HDMI-A-2"\nthemes = 1\n', HOME)
  assert.match(read.errors.join("\n"), /gjetr\.toml: display: /)
  assert.match(read.errors.join("\n"), /gjetr\.toml: themes: unknown key/)
  assert.equal(read.config.displays[0].name, "HDMI-A-2")
})

test("sockets must be absolute, short enough for a unix socket and free of NUL", () => {
  assert.equal(Config.readMain('socket = "/run/h.sock"', HOME).config.socket, "/run/h.sock")
  const long = "/" + "x".repeat(120)
  assert.equal(Config.readMain(`socket = "${long}"`, HOME).errors.length, 1)
  assert.equal(Config.readMain('socket = "/run/\\u0000h.sock"', HOME).errors.length, 1)
})

test("background accepts black, theme, wallpaper, transparent and hex colours", () => {
  for (const value of ["black", "theme", "wallpaper", "transparent", "#000", "#101315", "#80101315"]) {
    const read = Config.readMain(`[[display]]\nname = "DP-1"\nbackground = "${value}"\n`, HOME)
    assert.deepEqual(Array.from(read.errors), [], value)
    assert.equal(read.config.displays[0].background, value)
  }
  for (const value of ["#12", "#gggggg", "image", "rgb(0,0,0)"]) {
    const read = Config.readMain(`[[display]]\nname = "DP-1"\nbackground = "${value}"\n`, HOME)
    assert.equal(read.errors.length, 1, value)
  }
})

test("layout names are safe file names", () => {
  assert.equal(Config.isLayoutName("agents"), true)
  assert.equal(Config.isLayoutName("side_panel-2"), true)
  for (const bad of ["", "../x", "a/b", ".hidden", "a b", "x".repeat(33), 5, null]) {
    assert.equal(Config.isLayoutName(bad), false, String(bad))
  }
  assert.equal(Config.layoutPath("/home/test/.config/gjetr", "agents"), "/home/test/.config/gjetr/layouts/agents.toml")
  assert.equal(Config.layoutPath("/home/test/.config/gjetr", "../x"), "")
})

test("deckLayoutNames lists every layout the displays use, once", () => {
  const read = Config.readMain('[[display]]\nname = "A"\ndeck = ["x", "y"]\n[[display]]\nname = "B"\ndeck = ["y", "z"]\n', HOME)
  assert.deepEqual(Array.from(Config.deckLayoutNames(read.config)), ["x", "y", "z"])
})

test("readLayout reads orientation and Agent List settings", () => {
  const read = Config.readLayout("agents", `
orientation = "landscape"

[[module]]
type = "agent-list"
sort = "cache"
preset = "compact"
focus = "window"
`)
  assert.deepEqual(Array.from(read.errors), [])
  assert.deepEqual(plain(read.layout), {
    name: "agents",
    orientation: "landscape",
    modules: [{ type: "agent-list", sort: "cache", preset: "compact", focus: "window", recap: "off", recapOpen: "card", weight: 1, highlightWorkspace: true }]
  })
})

test("a missing layout file is the default Agent List, with an error", () => {
  const read = Config.readLayout("agents", null)
  assert.deepEqual(plain(read.layout), {
    name: "agents",
    orientation: "portrait",
    modules: [{ type: "agent-list", sort: "spaces", preset: "detailed", focus: "herdr", recap: "off", recapOpen: "card", weight: 1, highlightWorkspace: true }]
  })
  assert.match(read.errors.join("\n"), /layouts\/agents\.toml: not found/)
})

test("layout values fall back per field", () => {
  const read = Config.readLayout("side", `
orientation = "diagonal"
[[module]]
type = "agent-list"
sort = "alphabetical"
preset = "huge"
focus = "teleport"
extra = true
`)
  assert.deepEqual(plain(read.layout), {
    name: "side",
    orientation: "portrait",
    modules: [{ type: "agent-list", sort: "spaces", preset: "detailed", focus: "herdr", recap: "off", recapOpen: "card", weight: 1, highlightWorkspace: true }]
  })
  const text = read.errors.join("\n")
  for (const key of ["orientation", "module[0].sort", "module[0].preset", "module[0].focus", "module[0].extra"]) {
    assert.match(text, new RegExp("layouts/side\\.toml: " + key.replace(/[[\].]/g, "\\$&") + ": "), key)
  }
})

test("unknown module types are skipped; no modules left means the default", () => {
  const read = Config.readLayout("x", '[[module]]\ntype = "clock"\n')
  assert.deepEqual(plain(read.layout.modules), [{ type: "agent-list", sort: "spaces", preset: "detailed", focus: "herdr", recap: "off", recapOpen: "card", weight: 1, highlightWorkspace: true }])
  assert.match(read.errors.join("\n"), /module\[0\]\.type: /)
  assert.match(read.errors.join("\n"), /no valid module/)
})

test("a layout syntax error names the layout file", () => {
  const read = Config.readLayout("agents", "orientation = \n")
  assert.match(read.errors[0], /^layouts\/agents\.toml:1:\d+: /)
  assert.equal(read.layout.orientation, "portrait")
})

test("agentList finds the first Agent List of a layout, or the defaults", () => {
  const layout = Config.readLayout("agents", '[[module]]\ntype = "agent-list"\nsort = "priority"\n').layout
  assert.equal(Config.agentList(layout).index, 0)
  assert.equal(Config.agentList(layout).settings.sort, "priority")
  assert.equal(Config.agentList(null).settings.sort, "spaces")
  assert.equal(Config.agentList(null).index, -1)
})

test("prototype keys in TOML never reach the config", () => {
  const read = Config.readMain('[__proto__]\npolluted = true\n[[display]]\nname = "DP-1"\n', HOME)
  assert.equal(({}).polluted, undefined)
  assert.match(read.errors.join("\n"), /__proto__: unknown key/)
})

test("huge inputs are refused before parsing", () => {
  const read = Config.readMain("# " + "x".repeat(Config.MAX_BYTES + 1), HOME)
  assert.match(read.errors.join("\n"), /too large/)
  assert.equal(read.config.displays[0].name, "HDMI-A-2")
})

test("isConfigDir accepts absolute directories only", () => {
  assert.equal(Config.isConfigDir("/tmp/gjetr-test"), true)
  for (const bad of ["", "relative", "/tmp/../etc", "/tmp/a/..", "/tmp/a\nb", "/" + "x".repeat(300), null, 5]) {
    assert.equal(Config.isConfigDir(bad), false, String(bad))
  }
})

test("touch_devices lists the touchscreens that rotate with a Display", () => {
  const read = Config.readMain('[[display]]\nname = "HDMI-A-2"\ntouch_devices = ["wch.cn-usb2iic_ctp_control", "wch.cn-usb2iic_ctp_control-1", "wch.cn-usb2iic_ctp_control"]\n', HOME)
  assert.deepEqual(Array.from(read.errors), [])
  assert.deepEqual(Array.from(read.config.displays[0].touchDevices), ["wch.cn-usb2iic_ctp_control", "wch.cn-usb2iic_ctp_control-1"])
  const bad = Config.readMain('[[display]]\nname = "HDMI-A-2"\ntouch_devices = ["ok-dev", "bad name\\"", 5]\n', HOME)
  assert.deepEqual(Array.from(bad.config.displays[0].touchDevices), ["ok-dev"])
  assert.equal(bad.errors.length, 2)
  assert.match(Config.readMain('[[display]]\nname = "HDMI-A-2"\ntouch_devices = "all"\n', HOME).errors[0], /touch_devices: expected a list/)
})

test("recap is off, inline or expand per Agent List", () => {
  assert.equal(Config.readLayout("agents", '[[module]]\ntype = "agent-list"\n').layout.modules[0].recap, "off")
  assert.equal(Config.readLayout("agents", '[[module]]\ntype = "agent-list"\nrecap = "expand"\n').layout.modules[0].recap, "expand")
  const bad = Config.readLayout("agents", '[[module]]\ntype = "agent-list"\nrecap = "loud"\n')
  assert.equal(bad.layout.modules[0].recap, "off")
  assert.match(bad.errors.join("\n"), /module\[0\]\.recap: expected one of off, inline, expand/)
})

test("recap_open is card or overlay per Agent List, default card", () => {
  assert.equal(Config.readLayout("agents", '[[module]]\ntype = "agent-list"\n').layout.modules[0].recapOpen, "card")
  const overlay = Config.readLayout("agents", '[[module]]\ntype = "agent-list"\nrecap = "expand"\nrecap_open = "overlay"\n')
  assert.deepEqual(Array.from(overlay.errors), [])
  assert.equal(overlay.layout.modules[0].recapOpen, "overlay")
  for (const bad of ['"popup"', "true", '["card"]']) {
    const read = Config.readLayout("agents", `[[module]]\ntype = "agent-list"\nrecap_open = ${bad}\n`)
    assert.equal(read.layout.modules[0].recapOpen, "card", bad)
    assert.match(read.errors.join("\n"), /layouts\/agents\.toml: module\[0\]\.recap_open: expected one of card, overlay/, bad)
  }
})

test("every [[module]] of a Layout is read, in order, with an optional weight", () => {
  const read = Config.readLayout("wide", `
orientation = "landscape"
[[module]]
type = "agent-list"
sort = "priority"
weight = 2
[[module]]
type = "agent-list"
sort = "cache"
`)
  assert.deepEqual(Array.from(read.errors), [])
  const modules = plain(Config.layoutModules(read.layout))
  assert.deepEqual(modules.map(m => [m.index, m.key, m.type, m.weight, m.settings.sort]),
    [[0, "wide#0", "agent-list", 2, "priority"], [1, "wide#1", "agent-list", 1, "cache"]])
})

test("weight must be a positive number up to 100", () => {
  for (const good of ["1", "0.5", "3", "100"]) {
    const read = Config.readLayout("x", `[[module]]\ntype = "agent-list"\nweight = ${good}\n`)
    assert.deepEqual(Array.from(read.errors), [], good)
    assert.equal(read.layout.modules[0].weight, Number(good))
  }
  for (const bad of ["0", "-1", "101", '"2"', "true", "nan", "inf"]) {
    const read = Config.readLayout("x", `[[module]]\ntype = "agent-list"\nweight = ${bad}\n`)
    assert.equal(read.layout.modules[0].weight, 1, bad)
    assert.match(read.errors.join("\n"), /layouts\/x\.toml: module\[0\]\.weight: expected a number above 0/, bad)
  }
})

test("layoutModules keys Modules by their position among valid Modules", () => {
  const read = Config.readLayout("mix", '[[module]]\ntype = "nope"\n[[module]]\ntype = "agent-list"\n')
  assert.deepEqual(plain(Config.layoutModules(read.layout)).map(m => m.key), ["mix#0"])
  assert.deepEqual(plain(Config.layoutModules(null)), [])
})

test("a workspace-list Module reads tap, focus and weight", () => {
  const read = Config.readLayout("ws", '[[module]]\ntype = "workspace-list"\ntap = "focus"\nfocus = "window"\nweight = 2\n')
  assert.deepEqual(Array.from(read.errors), [])
  assert.deepEqual(plain(read.layout.modules), [{ type: "workspace-list", tap: "focus", focus: "window", weight: 2 }])
  const plainList = Config.readLayout("ws", '[[module]]\ntype = "workspace-list"\n')
  assert.deepEqual(plain(plainList.layout.modules), [{ type: "workspace-list", tap: "expand", focus: "herdr", weight: 1 }])
})

test("workspace-list values fall back per field", () => {
  const read = Config.readLayout("ws", '[[module]]\ntype = "workspace-list"\ntap = "hover"\nfocus = "teleport"\nsort = "spaces"\n')
  assert.deepEqual(plain(read.layout.modules), [{ type: "workspace-list", tap: "expand", focus: "herdr", weight: 1 }])
  const text = read.errors.join("\n")
  assert.match(text, /layouts\/ws\.toml: module\[0\]\.tap: expected one of expand, focus/)
  assert.match(text, /layouts\/ws\.toml: module\[0\]\.focus: expected one of herdr, window/)
  assert.match(text, /layouts\/ws\.toml: module\[0\]\.sort: unknown key/)
})

test("highlight_workspace is on by default and may be turned off per Agent List", () => {
  assert.equal(Config.readLayout("a", '[[module]]\ntype = "agent-list"\n').layout.modules[0].highlightWorkspace, true)
  const off = Config.readLayout("a", '[[module]]\ntype = "agent-list"\nhighlight_workspace = false\n')
  assert.deepEqual(Array.from(off.errors), [])
  assert.equal(off.layout.modules[0].highlightWorkspace, false)
  const bad = Config.readLayout("a", '[[module]]\ntype = "agent-list"\nhighlight_workspace = "no"\n')
  assert.equal(bad.layout.modules[0].highlightWorkspace, true)
  assert.match(bad.errors.join("\n"), /layouts\/a\.toml: module\[0\]\.highlight_workspace: expected true or false/)
})

test("a usage Module reads show, providers and refresh_seconds", () => {
  const read = Config.readLayout("u", `
[[module]]
type = "usage"
show = ["limits", "today", "recent_days", "models", "cost_30d", "today"]
providers = ["claude", "codex"]
refresh_seconds = 300
weight = 2
`)
  assert.deepEqual(Array.from(read.errors), [])
  assert.deepEqual(plain(read.layout.modules), [{ type: "usage", show: ["limits", "today", "recent_days", "models", "cost_30d"],
    providers: ["claude", "codex"], refreshSeconds: 300, weight: 2 }])
  assert.deepEqual(plain(Config.readLayout("u", '[[module]]\ntype = "usage"\n').layout.modules),
    [{ type: "usage", show: ["limits"], providers: [], refreshSeconds: null, weight: 1 }])
})

test("usage values fall back per item with clear errors", () => {
  const read = Config.readLayout("u", `
[[module]]
type = "usage"
show = ["limits", "weather", 3]
providers = ["claude", "../x"]
refresh_seconds = 30
`)
  const module = plain(read.layout.modules[0])
  assert.deepEqual(module.show, ["limits"])
  assert.deepEqual(module.providers, ["claude"])
  assert.equal(module.refreshSeconds, 60)
  const text = read.errors.join("\n")
  assert.match(text, /layouts\/u\.toml: module\[0\]\.show\[1\]: expected one of limits, today, recent_days, models, cost_30d/)
  assert.match(text, /module\[0\]\.show\[2\]: /)
  assert.match(text, /module\[0\]\.providers\[1\]: expected a provider id/)
  assert.match(text, /module\[0\]\.refresh_seconds: expected whole seconds from 60 to 86400, got 30; using 60/)
  const empty = Config.readLayout("u", '[[module]]\ntype = "usage"\nshow = []\nrefresh_seconds = "15m"\nproviders = "claude"\n')
  assert.deepEqual(plain(empty.layout.modules[0].show), ["limits"])
  assert.equal(empty.layout.modules[0].refreshSeconds, null)
  assert.match(empty.errors.join("\n"), /module\[0\]\.show: no valid items, using \["limits"\]/)
  assert.match(empty.errors.join("\n"), /module\[0\]\.refresh_seconds: expected whole seconds/)
  assert.match(empty.errors.join("\n"), /module\[0\]\.providers: expected a list of provider ids/)
})

test("a Display may set refresh_seconds for its Usage Modules", () => {
  const read = Config.readMain('[[display]]\nname = "DP-1"\nrefresh_seconds = 600\n', HOME)
  assert.deepEqual(Array.from(read.errors), [])
  assert.equal(read.config.displays[0].refreshSeconds, 600)
  const big = Config.readMain('[[display]]\nname = "DP-1"\nrefresh_seconds = 999999\n', HOME)
  assert.equal(big.config.displays[0].refreshSeconds, 86400)
  assert.match(big.errors.join("\n"), /display\[0\]\.refresh_seconds: expected whole seconds from 60 to 86400, got 999999; using 86400/)
})
