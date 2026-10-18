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

test("resolve puts a desc: Display on the port its monitor is plugged into", () => {
  const main = '[[display]]\nname = "desc:JRP JRP7006H"\ndeck = ["agents"]\n\n'
    + '[[display]]\nname = "DP-1"\nkind = "dock"\ndeck = ["agents"]\n'
  const input = monitors => ({ mainText: main, layoutUserTexts: { agents: "" }, layoutShippedTexts: {},
    presetTexts: presetTexts(), detection: detection({}), monitors: monitors, home: HOME })
  const before = Source.resolve(input(null))
  // Not connected (or not read yet): kept by its description, so no screen shows it.
  assert.deepEqual(names(before.config.displays), ["surface:desc:JRP JRP7006H:true", "dock:DP-1:true"])
  assert.deepEqual(Array.from(before.errors), [])

  const plugged = Source.resolve(input([{ name: "DP-1", description: "Dell Inc. DELL U2720Q 8FDSM13" },
    { name: "HDMI-A-2", description: "JRP JRP7006H 0" }]))
  assert.notEqual(plugged, before)
  assert.deepEqual(names(plugged.config.displays), ["surface:HDMI-A-2:true", "dock:DP-1:true"])
  assert.equal(plugged.config.displays[0].match, "desc:JRP JRP7006H")
  assert.equal(plugged.config.displays[1].match, "DP-1")

  // The cable moved: the same monitor on another port.
  const moved = Source.resolve(input([{ name: "DP-1", description: "Dell Inc. DELL U2720Q 8FDSM13" },
    { name: "HDMI-A-1", description: "JRP JRP7006H 0" }]))
  assert.deepEqual(names(moved.config.displays), ["surface:HDMI-A-1:true", "dock:DP-1:true"])

  // The same monitors read again: the same object.
  assert.equal(Source.resolve(input([{ name: "DP-1", description: "Dell Inc. DELL U2720Q 8FDSM13" },
    { name: "HDMI-A-1", description: "JRP JRP7006H 0" }])), moved)

  // A description that lands on an output another Display holds is skipped.
  const clash = Source.resolve(input([{ name: "DP-1", description: "JRP JRP7006H 0" }]))
  assert.deepEqual(names(clash.config.displays), ["surface:DP-1:true"])
  assert.match(clash.errors.join("\n"), /display "DP-1" is on DP-1, which "desc:JRP JRP7006H" already holds; display skipped/)
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

function presetLayout(name) {
  return fs.readFileSync(path.join(PRESETS_DIR, "layouts", name + ".toml"), "utf8")
}

test("resolve reports a Layout's errors only once its files have answered", () => {
  const main = '[[display]]\nname = "DP-3"\ndeck = ["cache", "sidebar", "gone", "broken", "waiting"]\n'
  const resolved = Source.resolve({ mainText: main, presetTexts: {}, detection: detection({}), home: HOME,
    layoutUserTexts: { cache: '[[module]]\ntype = "agent-list"\n', sidebar: null, gone: null, broken: "= nope" },
    layoutShippedTexts: { sidebar: presetLayout("sidebar"), gone: null, waiting: null } })
  assert.deepEqual(resolved.sources,
    { cache: "config", sidebar: "shipped", gone: "missing", broken: "config", waiting: "loading" })
  const errors = Array.from(resolved.layoutErrors)
  assert.equal(errors.length, 2, errors.join("\n"))
  assert.match(errors[0], /^layouts\/gone\.toml: not found in the Config or among gjetr's Layouts/)
  assert.match(errors[1], /^layouts\/broken\.toml:/)
})

// The shell start of #6: Layouts that exist are read while the shipped ones
// answer, and are read again (a file watch, the retry timer). None of them is
// reported missing, or drawn as the default Agent List, at any step.
test("a Layout that exists is never reported missing while its files are read or read again", () => {
  const ConfigModel = loadLib("lib/ConfigModel.js")
  const main = '[[display]]\nname = "DP-3"\ndeck = ["cache", "agents"]\n'
  const cache = '[[module]]\ntype = "agent-list"\nsort = "cache"\n'
  const agents = '[[module]]\ntype = "agent-list"\n'
  const user = {}
  const shipped = {}
  function answer(texts, name, outcome) {
    const previous = Object.prototype.hasOwnProperty.call(texts, name) ? texts[name] : undefined
    const text = ConfigModel.answeredText(previous, outcome)
    if (text !== undefined) texts[name] = text
  }
  function step() {
    const resolved = Source.resolve({ mainText: main, presetTexts: {}, detection: detection({}), home: HOME,
      layoutUserTexts: Object.assign({}, user), layoutShippedTexts: Object.assign({}, shipped) })
    for (const name of ["cache", "agents"]) assert.notEqual(resolved.sources[name], "missing", name)
    assert.deepEqual(Array.from(resolved.layoutErrors), [])
    return resolved
  }
  step()
  // gjetr ships no cache Layout; its agents one answers first.
  answer(shipped, "cache", { loaded: false, notFound: true })
  answer(shipped, "agents", { loaded: true, text: presetLayout("agents") })
  assert.deepEqual(step().sources, { cache: "loading", agents: "loading" })
  // A read of the Config's file fails without saying it is not there.
  answer(user, "cache", { loaded: false, notFound: false })
  assert.equal(step().sources.cache, "loading")
  answer(user, "cache", { loaded: true, text: cache })
  answer(user, "agents", { loaded: true, text: agents })
  assert.deepEqual(step().sources, { cache: "config", agents: "config" })
  // Read again: a failed read keeps the text, so the Layout keeps its Modules.
  answer(user, "cache", { loaded: false, notFound: false })
  const again = step()
  assert.equal(again.sources.cache, "config")
  assert.equal(again.layoutTexts.cache, cache)
  // Only a file really not there is missing, once the shipped one is not there either.
  answer(user, "cache", { loaded: false, notFound: true })
  const gone = Source.resolve({ mainText: main, presetTexts: {}, detection: detection({}), home: HOME,
    layoutUserTexts: Object.assign({}, user), layoutShippedTexts: Object.assign({}, shipped) })
  assert.equal(gone.sources.cache, "missing")
  assert.match(Array.from(gone.layoutErrors).join("\n"), /layouts\/cache\.toml: not found/)
})
