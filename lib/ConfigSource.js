.pragma library
.import "ConfigModel.js" as ConfigModel
.import "PresetModel.js" as PresetModel
.import "DetectPolicy.js" as DetectPolicy

// The Config in effect, from every text gjetr has. Its own module because
// PresetModel already imports ConfigModel.

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function own(table, key) {
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined
}

function sameMap(a, b) {
  var left = isObject(a) ? a : {}
  var right = isObject(b) ? b : {}
  var keys = Object.keys(left)
  if (keys.length !== Object.keys(right).length) return false
  for (var i = 0; i < keys.length; i++) {
    if (!Object.prototype.hasOwnProperty.call(right, keys[i]) || left[keys[i]] !== right[keys[i]]) return false
  }
  return true
}

function sameKey(a, b) {
  return a.mainText === b.mainText && a.home === b.home && a.preset === b.preset && a.presetText === b.presetText
    && a.touchscreen === b.touchscreen && a.monitor === b.monitor
    && sameMap(a.layoutUserTexts, b.layoutUserTexts) && sameMap(a.layoutShippedTexts, b.layoutShippedTexts)
}

// The last inputs and what they resolved to.
var last = null

// The Config in effect and where each part came from.
// input: { mainText: gjetr.toml's text or null, layoutUserTexts and
//   layoutShippedTexts: Layout name -> text or null (absent while loading),
//   presetTexts: preset name -> text or null, detection: DetectPolicy.detect's
//   result, home }
// -> { config, layoutTexts, sources: Layout name -> "config" | "shipped" |
//   "missing" | "loading", source: "file" | "preset" | "none", preset: the
//   preset shown ("" unless source is "preset"), errors, incomplete: gjetr.toml
//   or a Layout of the Decks is not in the Config (yet), missingOutputs: the
//   detected preset's placeholders left unfilled }
// The same texts, outputs and home return the same object, so bindings on it
// do not re-evaluate on every detection.
function resolve(input) {
  var o = isObject(input) ? input : {}
  var home = typeof o.home === "string" ? o.home : ""
  var detection = isObject(o.detection) ? o.detection : {}
  var presets = isObject(o.presetTexts) ? o.presetTexts : {}
  var presetName = typeof detection.preset === "string" ? detection.preset : ""
  var presetText = presetName !== "" ? own(presets, presetName) : undefined
  var key = { mainText: o.mainText, home: home, preset: presetName, presetText: presetText,
    touchscreen: detection.touchscreen, monitor: detection.monitor,
    layoutUserTexts: o.layoutUserTexts, layoutShippedTexts: o.layoutShippedTexts }
  if (last !== null && sameKey(last.key, key)) return last.result
  var result = compute(o, home, detection, presetName, presetText)
  last = { key: key, result: result }
  return result
}

function compute(o, home, detection, presetName, presetText) {
  // The detected preset, rendered for this machine: shown without a
  // gjetr.toml, and its Displays stand in for a gjetr.toml that names none.
  var rendered = typeof presetText === "string"
    ? PresetModel.render(presetText, { touchscreen: detection.touchscreen, monitor: detection.monitor }) : null
  var presetRead = rendered ? ConfigModel.readMain(rendered.text, home) : null

  var source = typeof o.mainText === "string" ? "file" : presetRead ? "preset" : "none"
  var read = source === "file"
    ? ConfigModel.readMain(o.mainText, home, presetRead ? DetectPolicy.detectedConfig(presetRead.config).displays : [])
    : source === "preset" ? { config: DetectPolicy.detectedConfig(presetRead.config), errors: presetRead.errors }
    : ConfigModel.readMain(null, home)
  var layouts = ConfigModel.overlayLayouts(ConfigModel.deckLayoutNames(read.config), o.layoutUserTexts, o.layoutShippedTexts)
  // Whether gjetr.toml or a Layout of the Decks is not in the Config (yet).
  var incomplete = source !== "file"
    || Object.keys(layouts.sources).some(function(name) { return layouts.sources[name] !== "config" })
  return { config: read.config, layoutTexts: layouts.texts, sources: layouts.sources, source: source,
    preset: source === "preset" ? presetName : "", errors: read.errors, incomplete: incomplete,
    missingOutputs: rendered ? rendered.missing : [] }
}

if (typeof module !== "undefined") {
  module.exports = {
    resolve: resolve
  }
}
