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
    displays: [{ name: "HDMI-A-2", deck: ["agents"], rotatable: false, background: "black", touchDevices: [] }]
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
      { name: "HDMI-A-2", deck: ["agents", "overview"], rotatable: true, background: "#101315", touchDevices: [] },
      { name: "DP-2", deck: ["agents"], rotatable: false, background: "theme", touchDevices: [] }
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
  assert.deepEqual(config.displays, [{ name: "HDMI-A-2", deck: ["agents"], rotatable: false, background: "black", touchDevices: [] }])
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
    modules: [{ type: "agent-list", sort: "cache", preset: "compact", focus: "window" }]
  })
})

test("a missing layout file is the default Agent List, with an error", () => {
  const read = Config.readLayout("agents", null)
  assert.deepEqual(plain(read.layout), {
    name: "agents",
    orientation: "portrait",
    modules: [{ type: "agent-list", sort: "spaces", preset: "detailed", focus: "herdr" }]
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
    modules: [{ type: "agent-list", sort: "spaces", preset: "detailed", focus: "herdr" }]
  })
  const text = read.errors.join("\n")
  for (const key of ["orientation", "module[0].sort", "module[0].preset", "module[0].focus", "module[0].extra"]) {
    assert.match(text, new RegExp("layouts/side\\.toml: " + key.replace(/[[\].]/g, "\\$&") + ": "), key)
  }
})

test("unknown module types are skipped; no modules left means the default", () => {
  const read = Config.readLayout("x", '[[module]]\ntype = "usage"\n')
  assert.deepEqual(plain(read.layout.modules), [{ type: "agent-list", sort: "spaces", preset: "detailed", focus: "herdr" }])
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
