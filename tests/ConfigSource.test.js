"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const loadLib = require("./support/loadLib.cjs")

const Source = loadLib("lib/ConfigSource.js")

const HOME = "/home/test"
const PRESETS_DIR = path.join(__dirname, "..", "presets")

function presetTexts() {
  const texts = {}
  for (const name of ["panel", "sidebar", "panel-sidebar", "minimal"]) {
    texts[name] = fs.readFileSync(path.join(PRESETS_DIR, name + ".toml"), "utf8")
  }
  return texts
}

function detection(fields) {
  return Object.assign({ ready: true, preset: "", touchscreen: "", monitor: "", device: "", reason: "" }, fields)
}

function names(displays) {
  return displays.map(display => display.kind + ":" + display.name + ":" + display.visible)
}

test("resolve reads a gjetr.toml when there is one, whatever is detected", () => {
  const main = '[[display]]\nname = "DP-3"\ndeck = ["agents"]\n'
  const resolved = Source.resolve({ mainText: main, layoutUserTexts: { agents: "" }, layoutShippedTexts: {},
    presetTexts: presetTexts(), detection: detection({ preset: "panel", touchscreen: "HDMI-A-2" }), home: HOME })
  assert.equal(resolved.source, "file")
  assert.equal(resolved.preset, "")
  assert.deepEqual(names(resolved.config.displays), ["surface:DP-3:true"])
  assert.deepEqual(Array.from(resolved.errors), [])
})

test("resolve shows the detected preset, its outputs filled in, when there is no gjetr.toml", () => {
  const panel = Source.resolve({ mainText: null, layoutUserTexts: {}, layoutShippedTexts: {}, presetTexts: presetTexts(),
    detection: detection({ preset: "panel", touchscreen: "HDMI-A-2", monitor: "DP-1" }), home: HOME })
  assert.equal(panel.source, "preset")
  assert.equal(panel.preset, "panel")
  assert.deepEqual(names(panel.config.displays), ["surface:HDMI-A-2:true"])
  assert.deepEqual(Array.from(panel.errors), [])
  assert.deepEqual(Array.from(panel.missingOutputs), [])

  // The sidebar's Dock is shown, whatever the preset says.
  const sidebarText = presetTexts().sidebar.replace("visible = true", "visible = false")
  const sidebar = Source.resolve({ mainText: null, layoutUserTexts: {}, layoutShippedTexts: {},
    presetTexts: { sidebar: sidebarText }, detection: detection({ preset: "sidebar", monitor: "DP-1" }), home: HOME })
  assert.equal(sidebar.source, "preset")
  assert.equal(sidebar.preset, "sidebar")
  assert.deepEqual(names(sidebar.config.displays), ["dock:DP-1:true"])
})

test("resolve falls back to gjetr's defaults when there is no gjetr.toml and nothing is detected", () => {
  for (const detected of [detection({ preset: "", reason: "no monitor" }), detection({ ready: false, preset: "" }),
    detection({ preset: "panel", touchscreen: "HDMI-A-2" })]) {
    const texts = detected.preset === "panel" ? { panel: null } : presetTexts()
    const resolved = Source.resolve({ mainText: null, layoutUserTexts: {}, layoutShippedTexts: {}, presetTexts: texts,
      detection: detected, home: HOME })
    assert.equal(resolved.source, "none")
    assert.equal(resolved.preset, "")
    assert.deepEqual(names(resolved.config.displays), ["surface::true"])
    assert.deepEqual(Array.from(resolved.config.displays[0].deck), ["agents"])
    assert.equal(resolved.config.socket, HOME + "/.config/herdr/herdr.sock")
    assert.deepEqual(Array.from(resolved.missingOutputs), [])
  }
})

test("resolve takes each Layout of the Decks from the Config first, then the shipped ones, and says which", () => {
  const main = '[[display]]\nname = "DP-3"\ndeck = ["agents", "sidebar", "gone", "loading"]\n'
  const input = { mainText: main, presetTexts: {}, detection: detection({}), home: HOME,
    layoutUserTexts: { agents: "mine", sidebar: null, gone: null, other: "unused" },
    layoutShippedTexts: { agents: "theirs", sidebar: "shipped", gone: null, loading: "not yet" } }
  const resolved = Source.resolve(input)
  assert.deepEqual(resolved.sources, { agents: "config", sidebar: "shipped", gone: "missing", loading: "loading" })
  assert.deepEqual(resolved.layoutTexts, { agents: "mine", sidebar: "shipped", gone: null })
  // A Layout not in the Config yet leaves it incomplete.
  assert.equal(resolved.incomplete, true)

  const complete = Source.resolve(Object.assign({}, input, { mainText: '[[display]]\nname = "DP-3"\ndeck = ["agents"]\n' }))
  assert.deepEqual(complete.sources, { agents: "config" })
  assert.equal(complete.incomplete, false)

  // Without a gjetr.toml the Config is incomplete, even with every Layout in it.
  const noFile = Source.resolve(Object.assign({}, input, { mainText: null, layoutUserTexts: { agents: "mine" } }))
  assert.deepEqual(noFile.sources, { agents: "config" })
  assert.equal(noFile.incomplete, true)
})

test("resolve lists the output placeholders the detected preset could not fill", () => {
  // panel-sidebar detected with no touchscreen of its own: the surface keeps its placeholder.
  const resolved = Source.resolve({ mainText: null, layoutUserTexts: {}, layoutShippedTexts: {}, presetTexts: presetTexts(),
    detection: detection({ preset: "panel-sidebar", touchscreen: "", monitor: "DP-1" }), home: HOME })
  assert.equal(resolved.source, "preset")
  assert.deepEqual(Array.from(resolved.missingOutputs), ["touchscreen"])
  assert.deepEqual(names(resolved.config.displays), ["surface:touchscreen:true", "dock:DP-1:true"])

  // A gjetr.toml of its own still reports them: they are the detected preset's.
  const file = Source.resolve({ mainText: '[[display]]\nname = "DP-3"\n', layoutUserTexts: {}, layoutShippedTexts: {},
    presetTexts: presetTexts(), detection: detection({ preset: "sidebar", monitor: "" }), home: HOME })
  assert.deepEqual(Array.from(file.missingOutputs), ["monitor"])
})

test("resolve returns the same object for the same texts, so bindings on it do not re-fire", () => {
  const input = () => ({ mainText: null, layoutUserTexts: { panel: null }, layoutShippedTexts: { panel: "shipped" },
    presetTexts: presetTexts(), detection: detection({ preset: "panel", touchscreen: "HDMI-A-2", reason: "a" }), home: HOME })
  const first = Source.resolve(input())
  // New maps and a new detection with the same texts and outputs: a detection tick.
  assert.equal(Source.resolve(Object.assign(input(), { detection: detection({ preset: "panel", touchscreen: "HDMI-A-2", reason: "b" }) })), first)
  assert.equal(Source.resolve(input()), first)

  const changes = [
    { mainText: '[[display]]\nname = "DP-3"\n' },
    { layoutUserTexts: { panel: "mine" } },
    { layoutShippedTexts: { panel: "shipped", sidebar: "more" } },
    { presetTexts: Object.assign(presetTexts(), { panel: presetTexts().panel + "\n# edited\n" }) },
    { detection: detection({ preset: "panel", touchscreen: "DP-2" }) },
    { home: "/home/other" }
  ]
  for (const change of changes) {
    const changed = Source.resolve(Object.assign(input(), change))
    assert.notEqual(changed, first, JSON.stringify(change))
    assert.notEqual(Source.resolve(input()), changed, JSON.stringify(change))
  }
})
