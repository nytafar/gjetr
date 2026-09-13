.pragma library
.import "ConfigModel.js" as ConfigModel
.import "SortPolicy.js" as SortPolicy

// Overrides: choices made on the Display that shadow Config until reset,
// persisted in ~/.local/state/gjetr/state.json. Pure; Service.qml is the one
// writer of the file. The file is treated as untrusted: unknown keys and
// invalid values are dropped on read.
//
//   { "version": 1,
//     "modules": { "<layout>#<index>": { "sort": "cache", "focus": "window" } },
//     "displays": { "<output>": { "layout": "<layout>" } } }
//
// A Module is keyed by its Layout and its position there; a Display by its
// output name. An Override that equals the Config value is removed, so a later
// Config edit applies again.

var VERSION = 1
var KEY_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}#[0-9]{1,2}$/

function allowed(field) {
  if (field === "sort") return SortPolicy.MODES
  if (field === "focus") return ConfigModel.FOCUS_MODES
  return null
}

function own(object, key) {
  return object !== null && typeof object === "object" && Object.prototype.hasOwnProperty.call(object, key)
}

function isTable(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function empty() {
  return { version: VERSION, modules: {}, displays: {} }
}

function validDisplay(entry) {
  return isTable(entry) && ConfigModel.isLayoutName(entry.layout) ? { layout: entry.layout } : null
}

function moduleKey(layoutName, index) {
  var i = Number(index)
  if (!ConfigModel.isLayoutName(layoutName) || !isFinite(i) || Math.floor(i) !== i || i < 0 || i > 99) return ""
  return layoutName + "#" + i
}

function validModule(entry) {
  if (!isTable(entry)) return null
  var out = {}
  var count = 0
  for (var field in entry) {
    var values = own(entry, field) ? allowed(field) : null
    if (values && typeof entry[field] === "string" && values.indexOf(entry[field]) >= 0) {
      out[field] = entry[field]
      count++
    }
  }
  return count > 0 ? out : null
}

function parse(text) {
  if (text === undefined || text === null || String(text).trim() === "") return { overrides: empty(), error: "" }
  var value
  try {
    value = JSON.parse(String(text))
  } catch (error) {
    return { overrides: empty(), error: "invalid JSON: " + error.message }
  }
  if (!isTable(value)) return { overrides: empty(), error: "state file is not an object" }
  if (value.version !== VERSION) return { overrides: empty(), error: "unsupported state version " + JSON.stringify(value.version) }
  var overrides = empty()
  var modules = isTable(value.modules) ? value.modules : {}
  for (var key in modules) {
    if (!own(modules, key) || !KEY_RE.test(key)) continue
    var entry = validModule(modules[key])
    if (entry) overrides.modules[key] = entry
  }
  var displays = isTable(value.displays) ? value.displays : {}
  for (var output in displays) {
    if (!own(displays, output) || !ConfigModel.isOutputName(output)) continue
    var display = validDisplay(displays[output])
    if (display) overrides.displays[output] = display
  }
  return { overrides: overrides, error: "" }
}

function effective(overrides, key, field, configValue) {
  if (!overrides || !own(overrides.modules, key) || !own(overrides.modules[key], field)) return configValue
  return overrides.modules[key][field]
}

function copy(overrides) {
  var out = empty()
  var modules = overrides && isTable(overrides.modules) ? overrides.modules : {}
  for (var key in modules) {
    if (!own(modules, key)) continue
    out.modules[key] = {}
    for (var field in modules[key]) if (own(modules[key], field)) out.modules[key][field] = modules[key][field]
  }
  var displays = overrides && isTable(overrides.displays) ? overrides.displays : {}
  for (var output in displays) {
    if (own(displays, output) && isTable(displays[output])) out.displays[output] = { layout: displays[output].layout }
  }
  return out
}

// The active Layout Override for a Display, or the fallback.
function displayLayout(overrides, output, fallback) {
  if (!overrides || !own(overrides.displays, output) || !own(overrides.displays[output], "layout")) return fallback
  return overrides.displays[output].layout
}

// Same contract as set: invalid changes return the same object, and choosing
// the Config default (the Deck's first Layout) removes the Override.
function setDisplayLayout(overrides, output, layout, configDefault) {
  var base = overrides || empty()
  if (!ConfigModel.isOutputName(output) || !ConfigModel.isLayoutName(layout)) return base
  var next = copy(base)
  if (layout === configDefault) delete next.displays[output]
  else next.displays[output] = { layout: layout }
  return next
}

// Returns the same object when the change is invalid, so callers can skip a
// write by identity.
function set(overrides, key, field, value, configValue) {
  var base = overrides || empty()
  var values = allowed(field)
  if (!KEY_RE.test(String(key)) || !values || values.indexOf(value) < 0) return base
  var next = copy(base)
  var entry = own(next.modules, key) ? next.modules[key] : {}
  if (value === configValue) delete entry[field]
  else entry[field] = value
  if (Object.keys(entry).length > 0) next.modules[key] = entry
  else delete next.modules[key]
  return next
}

function clear(overrides, key) {
  if (key === undefined) return empty()
  var next = copy(overrides)
  delete next.modules[key]
  return next
}

// Per Module key: its Config settings with every Override field applied, plus
// `<field>Overridden` and the untouched Config under `config`. `modules` is
// ConfigModel.layoutModules(layout). Only the fields a Module has are
// shadowed, so an Override never adds a setting a Module type does not know.
var MODULE_FIELDS = ["sort", "focus"]

function moduleStates(modules, overrides) {
  var list = Array.isArray(modules) ? modules : []
  var out = {}
  for (var i = 0; i < list.length; i++) {
    var module = list[i]
    if (!module || !KEY_RE.test(String(module.key)) || !isTable(module.settings)) continue
    var state = { key: module.key, type: module.type, index: module.index, weight: module.weight, config: module.settings }
    for (var name in module.settings) if (own(module.settings, name) && !own(state, name)) state[name] = module.settings[name]
    for (var f = 0; f < MODULE_FIELDS.length; f++) {
      var field = MODULE_FIELDS[f]
      if (!own(module.settings, field)) continue
      state[field] = effective(overrides, module.key, field, module.settings[field])
      state[field + "Overridden"] = state[field] !== module.settings[field]
    }
    out[module.key] = state
  }
  return out
}

// Stable bytes: sorted keys, so equal Overrides compare equal as text.
function serialize(overrides) {
  var source = copy(overrides)
  var modules = {}
  var keys = Object.keys(source.modules).sort()
  for (var i = 0; i < keys.length; i++) {
    var entry = {}
    var fields = Object.keys(source.modules[keys[i]]).sort()
    for (var j = 0; j < fields.length; j++) entry[fields[j]] = source.modules[keys[i]][fields[j]]
    modules[keys[i]] = entry
  }
  var displays = {}
  var outputs = Object.keys(source.displays).sort()
  for (var k = 0; k < outputs.length; k++) displays[outputs[k]] = { layout: source.displays[outputs[k]].layout }
  return JSON.stringify({ version: VERSION, modules: modules, displays: displays }, null, 2) + "\n"
}

if (typeof module !== "undefined") {
  module.exports = {
    VERSION: VERSION,
    empty: empty,
    moduleKey: moduleKey,
    parse: parse,
    effective: effective,
    set: set,
    displayLayout: displayLayout,
    setDisplayLayout: setDisplayLayout,
    clear: clear,
    moduleStates: moduleStates,
    serialize: serialize
  }
}
