"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const loadLib = require("./support/loadLib.cjs")

const Preset = loadLib("lib/PresetModel.js")
const Config = loadLib("lib/ConfigModel.js")

const HOME = "/home/test"
const ROOT = path.join(__dirname, "..")
const PRESETS_DIR = path.join(ROOT, "presets")
const LAYOUTS_DIR = path.join(PRESETS_DIR, "layouts")
const OUTPUTS = { touchscreen: "HDMI-A-2", monitor: "DP-1" }

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

function tomlNames(dir) {
  return fs.readdirSync(dir).filter(name => name.endsWith(".toml")).map(name => name.slice(0, -5)).sort()
}

function shippedLayouts() {
  const texts = {}
  for (const name of tomlNames(LAYOUTS_DIR)) texts[name] = fs.readFileSync(path.join(LAYOUTS_DIR, name + ".toml"), "utf8")
  return texts
}

test("PRESETS lists every shipped preset, each with a description", () => {
  assert.deepEqual(Preset.PRESETS.map(p => p.name).slice().sort(), tomlNames(PRESETS_DIR))
  for (const preset of Preset.PRESETS) {
    assert.ok(Preset.isPreset(preset.name), preset.name)
    assert.ok(preset.description.length > 10, preset.name)
  }
  for (const bad of ["", "nope", "../minimal", "panel.toml", null, 3]) assert.equal(Preset.isPreset(bad), false, String(bad))
})

test("every shipped preset reads without Config errors, as shipped and with its outputs filled in", () => {
  const layouts = shippedLayouts()
  for (const name of tomlNames(PRESETS_DIR)) {
    const text = fs.readFileSync(path.join(PRESETS_DIR, name + ".toml"), "utf8")
    assert.deepEqual(Array.from(Config.readMain(text, HOME).errors), [], name)
    const rendered = Preset.render(text, OUTPUTS)
    assert.deepEqual(Array.from(rendered.missing), [], name)
    const read = Config.readMain(rendered.text, HOME)
    assert.deepEqual(Array.from(read.errors), [], name)
    for (const display of read.config.displays) {
      assert.equal(display.name, display.kind === "dock" ? "DP-1" : "HDMI-A-2", name)
    }
    for (const layout of Config.deckLayoutNames(read.config)) {
      assert.ok(Object.prototype.hasOwnProperty.call(layouts, layout), `${name} names a Layout gjetr does not ship: ${layout}`)
    }
  }
})

test("every shipped Layout reads without Config errors", () => {
  const layouts = shippedLayouts()
  assert.ok(Object.keys(layouts).length >= 5)
  for (const name of Object.keys(layouts)) {
    assert.deepEqual(Array.from(Config.readLayout(name, layouts[name]).errors), [], name)
  }
})

test("render fills in only the output placeholders of Display names and reports the ones it could not", () => {
  const text = [
    '# name = "touchscreen" in a comment stays',
    "[[display]]",
    'name = "touchscreen"',
    'deck = ["panel"]',
    "[[display]]",
    'kind = "dock"',
    '  name   =   "monitor"   # the main monitor',
    'label = "monitor"'
  ].join("\n")
  const both = Preset.render(text, OUTPUTS)
  assert.deepEqual(Array.from(both.missing), [])
  assert.equal(both.text, text.replace('name = "touchscreen"\n', 'name = "HDMI-A-2"\n')
    .replace('name   =   "monitor"', 'name   =   "DP-1"'))
  assert.match(both.text, /^# name = "touchscreen" in a comment stays/)
  assert.match(both.text, /label = "monitor"$/)

  const none = Preset.render(text, { touchscreen: "", monitor: "bad name; rm" })
  assert.deepEqual(Array.from(none.missing), ["touchscreen", "monitor"])
  assert.equal(none.text, text)
  assert.deepEqual(plain(Preset.render(null, OUTPUTS)), { text: "", missing: [] })
})

test("lineDiff counts the lines added and removed", () => {
  assert.deepEqual(plain(Preset.lineDiff("a\nb\nc\n", "a\nb\nc\n")), { added: 0, removed: 0 })
  assert.deepEqual(plain(Preset.lineDiff("a\nb\nc\n", "a\nx\nc\nd\n")), { added: 2, removed: 1 })
  assert.deepEqual(plain(Preset.lineDiff("", "a\nb\n")), { added: 2, removed: 0 })
  assert.deepEqual(plain(Preset.lineDiff("a\nb", "")), { added: 0, removed: 2 })
})

test("installFiles lists gjetr.toml and each Layout its Decks name, under the Config dir", () => {
  const main = '[[display]]\nname = "DP-1"\ndeck = ["panel", "sidebar"]\n'
  const files = Preset.installFiles("/home/test/.config/gjetr/", main, { panel: "p", sidebar: "s", usage: "u" })
  assert.deepEqual(plain(files), [
    { relative: "gjetr.toml", path: "/home/test/.config/gjetr/gjetr.toml", text: main },
    { relative: "layouts/panel.toml", path: "/home/test/.config/gjetr/layouts/panel.toml", text: "p" },
    { relative: "layouts/sidebar.toml", path: "/home/test/.config/gjetr/layouts/sidebar.toml", text: "s" }
  ])
  // A Layout gjetr does not ship is left out; a bad directory gives nothing.
  assert.deepEqual(plain(Preset.installFiles("/c", main, { panel: "p" })).map(f => f.relative), ["gjetr.toml", "layouts/panel.toml"])
  for (const dir of ["relative/dir", "/tmp/../etc", "", null]) assert.deepEqual(plain(Preset.installFiles(dir, main, {})), [], String(dir))
})

test("isInstallPath allows only gjetr.toml, layouts/<name>.toml and their backups in the Config dir", () => {
  const dir = "/home/test/.config/gjetr"
  for (const good of [dir + "/gjetr.toml", dir + "/layouts/sidebar.toml", dir + "/gjetr.toml.bak.1789400000",
    dir + "/layouts/panel-2.toml.bak.1"]) assert.equal(Preset.isInstallPath(dir, good), true, good)
  for (const bad of [dir + "/other.toml", dir + "/layouts/../gjetr.toml", dir + "/layouts/a/b.toml", "/etc/gjetr.toml",
    dir + "/gjetr.toml.bak.x", dir + "/layouts/.toml", dir + "x/gjetr.toml", dir + "/layouts/sidebar.toml.bak.", null])
    assert.equal(Preset.isInstallPath(dir, bad), false, String(bad))
  assert.equal(Preset.isInstallPath("relative", "relative/gjetr.toml"), false)
})

test("fileOutcome says what installing a file does: created, unchanged, or replaced with a backup", () => {
  assert.deepEqual(plain(Preset.fileOutcome("layouts/panel.toml", null, "a\nb\n", 1789400000)),
    { relative: "layouts/panel.toml", action: "created", backup: "", added: 2, removed: 0, line: "layouts/panel.toml: created (2 lines)" })
  assert.deepEqual(plain(Preset.fileOutcome("gjetr.toml", "a\n", "a\n", 1789400000)),
    { relative: "gjetr.toml", action: "unchanged", backup: "", added: 0, removed: 0, line: "gjetr.toml: unchanged" })
  assert.deepEqual(plain(Preset.fileOutcome("gjetr.toml", "a\nold\n", "a\nnew\nmore\n", 1789400000)),
    { relative: "gjetr.toml", action: "replaced", backup: "gjetr.toml.bak.1789400000", added: 2, removed: 1,
      line: "gjetr.toml: replaced (+2 -1), yours kept as gjetr.toml.bak.1789400000" })
  // An empty file counts as absent, so nothing empty is backed up.
  assert.equal(Preset.fileOutcome("gjetr.toml", "", "a\n", 1).action, "created")
})
