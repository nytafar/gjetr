.pragma library
.import "ConfigModel.js" as ConfigModel
.import "SortPolicy.js" as SortPolicy

// Overrides: choices made on the Display that shadow Config until reset,
// persisted in ~/.local/state/gjetr/state.json. Pure; Service.qml is the one
// writer of the file. The file is treated as untrusted: unknown keys and
// invalid values are dropped on read.
//
//   { "version": 1, "modules": { "<layout>#<index>": { "sort": "cache" } } }
//
// A Module is keyed by its Layout and its position there. An Override that
// equals the Config value is removed, so a later Config edit applies again.

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
  return { version: VERSION, modules: {} }
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
  return out
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
  return JSON.stringify({ version: VERSION, modules: modules }, null, 2) + "\n"
}

if (typeof module !== "undefined") {
  module.exports = {
    VERSION: VERSION,
    empty: empty,
    moduleKey: moduleKey,
    parse: parse,
    effective: effective,
    set: set,
    clear: clear,
    serialize: serialize
  }
}
