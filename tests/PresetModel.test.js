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

const DIR = "/home/test/.config/gjetr"

test("installPlan writes a file that is not there yet, and nothing else", () => {
  const files = [{ relative: "layouts/panel.toml", path: DIR + "/layouts/panel.toml", text: "a\nb\n" }]
  const plan = Preset.installPlan(DIR, files, { [DIR + "/layouts/panel.toml"]: null }, 1789400000)
  assert.deepEqual(plain(plan.writes), [{ path: DIR + "/layouts/panel.toml", text: "a\nb\n", kind: "file", relative: "layouts/panel.toml" }])
  assert.deepEqual(plan.outcomes.map(o => o.action), ["created"])
  assert.deepEqual(Array.from(plan.summaryLines), ["layouts/panel.toml: created (2 lines)"])
})

test("installPlan leaves an identical file alone", () => {
  const files = [{ relative: "gjetr.toml", path: DIR + "/gjetr.toml", text: "a\n" }]
  const plan = Preset.installPlan(DIR, files, { [DIR + "/gjetr.toml"]: "a\n" }, 1789400000)
  assert.deepEqual(plain(plan.writes), [])
  assert.deepEqual(Array.from(plan.summaryLines), ["gjetr.toml: unchanged"])
})

test("installPlan backs up a file it replaces before writing it", () => {
  const files = [{ relative: "gjetr.toml", path: DIR + "/gjetr.toml", text: "a\nnew\n" }]
  const plan = Preset.installPlan(DIR, files, { [DIR + "/gjetr.toml"]: "a\nold\n" }, 1789400000)
  assert.deepEqual(plain(plan.writes), [
    { path: DIR + "/gjetr.toml.bak.1789400000", text: "a\nold\n", kind: "backup", relative: "gjetr.toml" },
    { path: DIR + "/gjetr.toml", text: "a\nnew\n", kind: "file", relative: "gjetr.toml" }
  ])
  assert.deepEqual(Array.from(plan.summaryLines), ["gjetr.toml: replaced (+1 -1), yours kept as gjetr.toml.bak.1789400000"])
})

test("installPlan refuses a file outside what installing may write, writing nothing for it", () => {
  const files = [
    { relative: "gjetr.toml", path: "/etc/gjetr.toml", text: "a\n" },
    { relative: "layouts/../x.toml", path: DIR + "/layouts/../x.toml", text: "b\n" }
  ]
  const plan = Preset.installPlan(DIR, files, {}, 1789400000)
  assert.deepEqual(plain(plan.writes), [])
  assert.deepEqual(plan.outcomes.map(o => o.action), ["refused", "refused"])
  assert.deepEqual(Array.from(plan.summaryLines), ["gjetr.toml: refused", "layouts/../x.toml: refused"])
})

test("installPlan plans a mixed set of files in order, each file's writes together", () => {
  const files = [
    { relative: "gjetr.toml", path: DIR + "/gjetr.toml", text: "main\nnew\n" },
    { relative: "layouts/panel.toml", path: DIR + "/layouts/panel.toml", text: "panel\n" },
    { relative: "layouts/sidebar.toml", path: DIR + "/layouts/sidebar.toml", text: "sidebar\nx\ny\n" },
    { relative: "layouts/usage.toml", path: DIR + "/layouts/usage.toml", text: "usage\n" }
  ]
  const current = { [DIR + "/gjetr.toml"]: "main\n", [DIR + "/layouts/panel.toml"]: "panel\n", [DIR + "/layouts/sidebar.toml"]: null }
  const plan = Preset.installPlan(DIR + "/", files, current, 42)
  assert.deepEqual(plain(plan.writes).map(w => w.kind + " " + w.path + " " + JSON.stringify(w.text)), [
    `backup ${DIR}/gjetr.toml.bak.42 "main\\n"`,
    `file ${DIR}/gjetr.toml "main\\nnew\\n"`,
    `file ${DIR}/layouts/sidebar.toml "sidebar\\nx\\ny\\n"`,
    `file ${DIR}/layouts/usage.toml "usage\\n"`
  ])
  assert.deepEqual(Array.from(plan.summaryLines), [
    "gjetr.toml: replaced (+1 -0), yours kept as gjetr.toml.bak.42",
    "layouts/panel.toml: unchanged",
    "layouts/sidebar.toml: created (3 lines)",
    "layouts/usage.toml: created (1 line)"
  ])
  assert.deepEqual(plan.outcomes.map(o => o.relative), files.map(f => f.relative))
  assert.equal(Preset.installSummary("panel", DIR, plan.outcomes, []).split("\n").length, 5)
})

test("failedOutcome says a file was not installed, keeping the backup a failed write leaves", () => {
  const replaced = Preset.fileOutcome("gjetr.toml", "a\n", "b\n", 7)
  const created = Preset.fileOutcome("layouts/panel.toml", null, "x\n", 7)
  assert.deepEqual(plain(Preset.failedOutcome(replaced, "backup")), { relative: "gjetr.toml", action: "failed", backup: "",
    added: 0, removed: 0, line: "gjetr.toml: not replaced, its backup could not be written" })
  assert.equal(Preset.failedOutcome(replaced, "file").line, "gjetr.toml: could not be written (backup gjetr.toml.bak.7 kept)")
  assert.equal(Preset.failedOutcome(replaced, "file").backup, "gjetr.toml.bak.7")
  assert.equal(Preset.failedOutcome(created, "file").line, "layouts/panel.toml: could not be written")
})

test("installPlan plans no writes for a file whose backup it may not write", () => {
  const files = [{ relative: "gjetr.toml", path: DIR + "/gjetr.toml", text: "b\n" }]
  // An epoch past what a backup name holds.
  const plan = Preset.installPlan(DIR, files, { [DIR + "/gjetr.toml"]: "a\n" }, 1e13)
  assert.deepEqual(plain(plan.writes), [])
  assert.deepEqual(Array.from(plan.summaryLines), ["gjetr.toml: not replaced, its backup could not be written"])
})

test("installSummary reports each file and the output names left to set", () => {
  const outcomes = [Preset.fileOutcome("gjetr.toml", "a\n", "b\n", 7), Preset.fileOutcome("layouts/panel.toml", null, "x\n", 7)]
  assert.equal(Preset.installSummary("panel", "/c/gjetr/", outcomes, ["touchscreen"]), [
    "installed preset panel into /c/gjetr",
    "  gjetr.toml: replaced (+1 -1), yours kept as gjetr.toml.bak.7",
    "  layouts/panel.toml: created (1 line)",
    "set the surface's name in gjetr.toml yourself: no touchscreen bound to an output of its own was found"
  ].join("\n"))
  assert.equal(Preset.installSummary("sidebar", "/c", [], ["monitor", "bogus"]),
    "installed preset sidebar into /c\nset the Dock's name in gjetr.toml yourself: no monitor was found")
})

test("listText lists every preset with its description, aligned, marking the detected one", () => {
  const lines = Preset.listText("sidebar").split("\n")
  assert.equal(lines.length, Preset.PRESETS.length)
  assert.match(lines[0], /^panel\s{2,}a touchscreen: the Agent List beside usage$/)
  assert.match(lines[1], /^sidebar\s{2,}.* \(detected\)$/)
  assert.equal(new Set(lines.map((line, i) => line.indexOf(Preset.PRESETS[i].description))).size, 1)
  assert.doesNotMatch(Preset.listText(""), /detected/)
})
