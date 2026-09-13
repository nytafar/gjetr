.pragma library
.import "vendor/toml.js" as Toml
.import "SortPolicy.js" as SortPolicy
.import "CardPolicy.js" as CardPolicy
.import "RecapModel.js" as RecapModel
.import "WorkspaceTreeModel.js" as WorkspaceTreeModel
.import "UsageModel.js" as UsageModel
.import "DockPolicy.js" as DockPolicy
.import "DensityPolicy.js" as DensityPolicy

// Config: the user's TOML files in ~/.config/gjetr/ -> validated Displays,
// Decks, Layouts and Module settings. Config is untrusted input. Every value
// is checked, a bad value falls back to its default with an error that names
// the file and key, and a file that does not parse falls back as a whole.
// gjetr never writes Config.
//
//   gjetr.toml           socket, [[display]] name, kind, deck, background,
//                        refresh_seconds; a surface: rotatable, touch_devices;
//                        a dock: edge, size, visible; [defaults] and
//                        [defaults.<module type>]: Module settings
//   layouts/<name>.toml  orientation, [[module]] type, weight and its settings
//                        (TYPE_KEYS: every type: density; agent-list: sort, preset, focus, recap,
//                        recap_open, highlight_workspace; workspace-list: tap, focus;
//                        usage: show, providers, refresh_seconds)
//
// A Module setting cascades: the built-in default, then [defaults] (for every
// Module type that has the key), then [defaults.<type>], then the [[module]]'s
// own key; an Override (OverrideModel) shadows the result at runtime. A bad
// value keeps what the cascade had so far. There are no defaults per Display:
// a Layout shown on two Displays is the same Modules.
//
// Values that later reach a process (output names, Layout names used in
// paths) are held to strict allowlists here.

var MAX_BYTES = 65536
var MAX_SOCKET_BYTES = 107 // sun_path is 108 bytes including the NUL

var DEFAULT_DISPLAY = "HDMI-A-2"
var DEFAULT_LAYOUT = "agents"

var ORIENTATIONS = ["portrait", "landscape", "any"]
// "wallpaper" and "transparent" both leave the surface clear. gjetr sits on the
// Bottom layer above omarchy-background, so the Omarchy wallpaper shows through;
// a #aarrggbb colour tints it.
var BACKGROUND_KEYWORDS = ["black", "theme", "wallpaper", "transparent"]
var FOCUS_MODES = ["herdr", "window"]
var MODULE_TYPES = ["agent-list", "workspace-list", "usage"]
// Keys every [[module]] accepts, whatever its type.
var COMMON_MODULE_KEYS = ["type", "weight", "density"]
var DEFAULT_WEIGHT = 1
var MAX_WEIGHT = 100

var NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/
var OUTPUT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
// Hyprland input device names as `hyprctl devices` lists them.
var DEVICE_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/
var MAX_TOUCH_DEVICES = 8
var HEX_RE = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/

// ------------------------------------------------------------------ helpers

function own(object, key) {
  return object !== null && typeof object === "object" && Object.prototype.hasOwnProperty.call(object, key)
}

function isTable(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)
}

function show(value) {
  var text
  try {
    text = JSON.stringify(value)
  } catch (error) {
    text = String(value)
  }
  if (text === undefined) text = String(value)
  return text.length > 60 ? text.slice(0, 57) + "..." : text
}

function oneLine(text) {
  return String(text === undefined || text === null ? "" : text)
    .replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim()
}

function sameStrings(list) {
  return list.join(", ")
}

function parseToml(file, text, errors) {
  var source = String(text)
  if (source.length > MAX_BYTES) {
    errors.push(file + ": file too large (" + source.length + " bytes, limit " + MAX_BYTES + ")")
    return null
  }
  try {
    return Toml.parse(source)
  } catch (error) {
    var where = error && isFinite(error.line) && isFinite(error.column) ? ":" + error.line + ":" + error.column : ""
    errors.push(file + where + ": " + (oneLine(error && error.message) || "invalid TOML"))
    return null
  }
}

function unknownKeys(file, prefix, table, known, errors) {
  var keys = Object.keys(table)
  for (var i = 0; i < keys.length; i++) {
    if (known.indexOf(keys[i]) < 0) errors.push(file + ": " + prefix + keys[i] + ": unknown key (ignored)")
  }
}

function pick(file, prefix, key, table, allowed, fallback, errors) {
  if (!own(table, key)) return fallback
  var value = table[key]
  if (typeof value === "string" && allowed.indexOf(value) >= 0) return value
  errors.push(file + ": " + prefix + key + ": expected one of " + sameStrings(allowed) + ", got " + show(value))
  return fallback
}

function expandHome(path, home) {
  var value = String(path)
  var base = String(home || "").replace(/\/+$/, "")
  if (value === "~") return base
  if (value.indexOf("~/") === 0) return base + value.slice(1)
  return value
}

// ------------------------------------------------------------------ names

function isLayoutName(value) {
  return typeof value === "string" && NAME_RE.test(value)
}

function isOutputName(value) {
  return typeof value === "string" && OUTPUT_RE.test(value)
}

// An absolute directory with no parent steps or control characters.
function isConfigDir(value) {
  return typeof value === "string" && value.length <= 256 && value.charAt(0) === "/"
    && !/(^|\/)\.\.(\/|$)/.test(value) && !/[\u0000-\u001f\u007f]/.test(value)
}

function layoutPath(configDir, name) {
  if (!isLayoutName(name)) return ""
  return String(configDir).replace(/\/+$/, "") + "/layouts/" + name + ".toml"
}

// ------------------------------------------------------------------ defaults

// A surface has no edge or size and is always visible; those are a dock's.
function defaultDisplay() {
  return { name: DEFAULT_DISPLAY, kind: DockPolicy.DEFAULT_KIND, deck: [DEFAULT_LAYOUT], rotatable: false,
    background: "black", touchDevices: [], refreshSeconds: null, edge: "", size: 0, visible: true }
}

function defaultAgentList() {
  return { type: "agent-list", sort: SortPolicy.DEFAULT_MODE, preset: CardPolicy.DEFAULT_PRESET, focus: "herdr",
    recap: RecapModel.DEFAULT_MODE, recapOpen: RecapModel.DEFAULT_OPEN, weight: DEFAULT_WEIGHT, highlightWorkspace: true,
    density: DensityPolicy.DEFAULT_SETTING }
}

function defaultUsage() {
  return { type: "usage", show: UsageModel.DEFAULT_SHOW.slice(), providers: [], refreshSeconds: null, weight: DEFAULT_WEIGHT,
    density: DensityPolicy.DEFAULT_SETTING }
}

// Seconds between usage refreshes: a whole number from the minimum to the
// maximum. Out of range clamps, with an error; anything else keeps the
// fallback (null: unset).
function readRefresh(file, prefix, table, fallback, errors) {
  if (!own(table, "refresh_seconds")) return fallback
  var value = table.refresh_seconds
  var min = UsageModel.MIN_REFRESH_SECONDS
  var max = UsageModel.MAX_REFRESH_SECONDS
  var message = file + ": " + prefix + "refresh_seconds: expected whole seconds from " + min + " to " + max + ", got " + show(value)
  if (typeof value !== "number" || !isFinite(value) || Math.floor(value) !== value) {
    errors.push(message)
    return fallback
  }
  if (value >= min && value <= max) return value
  var clamped = value < min ? min : max
  errors.push(message + "; using " + clamped)
  return clamped
}

function defaultWorkspaceList() {
  return { type: "workspace-list", tap: WorkspaceTreeModel.DEFAULT_TAP, focus: "herdr", weight: DEFAULT_WEIGHT,
    density: DensityPolicy.DEFAULT_SETTING }
}

// Every Module type's built-in settings, the bottom of the cascade.
function moduleDefaults() {
  return { "agent-list": defaultAgentList(), "workspace-list": defaultWorkspaceList(), "usage": defaultUsage() }
}

function defaultLayout(name) {
  return { name: isLayoutName(name) ? name : DEFAULT_LAYOUT, orientation: "portrait", modules: [defaultAgentList()] }
}

function defaults(home) {
  return {
    socket: expandHome("~/.config/herdr/herdr.sock", home),
    displays: [defaultDisplay()],
    defaults: moduleDefaults()
  }
}

// ------------------------------------------------------------------ gjetr.toml

function readSocket(file, table, home, fallback, errors) {
  if (!own(table, "socket")) return fallback
  var value = table.socket
  var path = typeof value === "string" ? expandHome(value, home) : ""
  if (path.charAt(0) === "/" && path.indexOf("\u0000") < 0 && path.length <= MAX_SOCKET_BYTES) return path
  errors.push(file + ": socket: expected an absolute path or ~/path of at most " + MAX_SOCKET_BYTES
    + " bytes, got " + show(value))
  return fallback
}

function readDeck(file, prefix, table, errors) {
  if (!own(table, "deck")) return [DEFAULT_LAYOUT]
  var value = table.deck
  if (!Array.isArray(value)) {
    errors.push(file + ": " + prefix + "deck: expected a list of Layout names, got " + show(value))
    return [DEFAULT_LAYOUT]
  }
  var deck = []
  for (var i = 0; i < value.length; i++) {
    if (!isLayoutName(value[i])) {
      errors.push(file + ": " + prefix + "deck[" + i + "]: expected a Layout name (letters, digits, - and _), got "
        + show(value[i]))
      continue
    }
    if (deck.indexOf(value[i]) < 0) deck.push(value[i])
  }
  if (deck.length === 0) {
    errors.push(file + ": " + prefix + "deck: no valid Layout names, using [\"" + DEFAULT_LAYOUT + "\"]")
    return [DEFAULT_LAYOUT]
  }
  return deck
}

// Keys every [[display]] takes, and the keys only one kind uses.
var DISPLAY_KEYS = ["name", "kind", "deck", "background", "refresh_seconds"]
var SURFACE_KEYS = ["rotatable", "touch_devices"]
var DOCK_KEYS = ["edge", "size", "visible"]

// A dock's size in logical pixels, a whole number from the minimum to the
// maximum. Out of range clamps, with an error; anything else is the default.
function readDockSize(file, prefix, table, errors) {
  if (!own(table, "size")) return DockPolicy.DEFAULT_SIZE
  var value = table.size
  var min = DockPolicy.MIN_SIZE
  var max = DockPolicy.MAX_SIZE
  var message = file + ": " + prefix + "size: expected whole logical pixels from " + min + " to " + max + ", got " + show(value)
  if (typeof value !== "number" || !isFinite(value) || Math.floor(value) !== value) {
    errors.push(message)
    return DockPolicy.DEFAULT_SIZE
  }
  if (value >= min && value <= max) return value
  var clamped = value < min ? min : max
  errors.push(message + "; using " + clamped)
  return clamped
}

function readDisplay(file, index, table, errors) {
  var prefix = "display[" + index + "]."
  if (!isTable(table)) {
    errors.push(file + ": display[" + index + "]: expected a table, got " + show(table))
    return null
  }
  if (!isOutputName(table.name)) {
    errors.push(file + ": " + prefix + "name: expected an output name such as HDMI-A-2, got " + show(table.name)
      + "; display skipped")
    return null
  }
  // A mistyped kind or edge would put a surface somewhere unintended, so the
  // Display is skipped rather than guessed. A dock that names no edge docks
  // on the default one.
  var kind = DockPolicy.DEFAULT_KIND
  if (own(table, "kind")) {
    if (typeof table.kind !== "string" || DockPolicy.KINDS.indexOf(table.kind) < 0) {
      errors.push(file + ": " + prefix + "kind: expected one of " + sameStrings(DockPolicy.KINDS) + ", got "
        + show(table.kind) + "; display skipped")
      return null
    }
    kind = table.kind
  }
  var dock = kind === "dock"
  if (dock && own(table, "edge") && !DockPolicy.isEdge(table.edge)) {
    errors.push(file + ": " + prefix + "edge: a dock needs one of " + sameStrings(DockPolicy.EDGES) + ", got "
      + show(table.edge) + "; display skipped")
    return null
  }
  if (own(table, "defaults")) errors.push(file + ": " + prefix + "defaults: not per Display, a Layout is the same Modules on "
    + "every Display; use [defaults] (ignored)")
  unknownKeys(file, prefix, table, DISPLAY_KEYS.concat(SURFACE_KEYS, DOCK_KEYS, ["defaults"]), errors)
  var ignored = dock ? SURFACE_KEYS : DOCK_KEYS
  for (var k = 0; k < ignored.length; k++) {
    if (own(table, ignored[k])) errors.push(file + ": " + prefix + ignored[k] + ": "
      + (dock ? "a dock never rotates its output" : "only for kind = \"dock\"") + " (ignored)")
  }
  var display = defaultDisplay()
  display.name = table.name
  display.kind = kind
  display.deck = readDeck(file, prefix, table, errors)
  if (dock) {
    display.edge = own(table, "edge") ? table.edge : DockPolicy.DEFAULT_EDGE
    display.size = readDockSize(file, prefix, table, errors)
    display.visible = readBoolean(file, prefix, table, "visible", true, errors)
  }
  if (!dock && own(table, "rotatable")) {
    if (typeof table.rotatable === "boolean") display.rotatable = table.rotatable
    else errors.push(file + ": " + prefix + "rotatable: expected true or false, got " + show(table.rotatable))
  }
  if (!dock && own(table, "touch_devices")) {
    var devices = table.touch_devices
    if (!Array.isArray(devices)) {
      errors.push(file + ": " + prefix + "touch_devices: expected a list of device names, got " + show(devices))
    } else {
      for (var d = 0; d < devices.length; d++) {
        if (typeof devices[d] !== "string" || !DEVICE_RE.test(devices[d])) {
          errors.push(file + ": " + prefix + "touch_devices[" + d + "]: expected a device name from hyprctl devices, got "
            + show(devices[d]))
        } else if (display.touchDevices.indexOf(devices[d]) < 0 && display.touchDevices.length < MAX_TOUCH_DEVICES) {
          display.touchDevices.push(devices[d])
        }
      }
    }
  }
  display.refreshSeconds = readRefresh(file, prefix, table, null, errors)
  if (own(table, "background")) {
    var bg = table.background
    if (typeof bg === "string" && (BACKGROUND_KEYWORDS.indexOf(bg) >= 0 || HEX_RE.test(bg))) display.background = bg
    else errors.push(file + ": " + prefix + "background: expected " + sameStrings(BACKGROUND_KEYWORDS)
      + " or a #rrggbb / #aarrggbb colour, got " + show(bg))
  }
  return display
}

// text is null or undefined when the file does not exist.
function readMain(text, home) {
  var file = "gjetr.toml"
  var errors = []
  var config = defaults(home)
  if (text === undefined || text === null) return { config: config, errors: errors }
  var table = parseToml(file, text, errors)
  if (!table) return { config: config, errors: errors }

  unknownKeys(file, "", table, ["socket", "display", "defaults"], errors)
  config.socket = readSocket(file, table, home, config.socket, errors)
  config.defaults = readDefaults(file, table, errors)

  if (own(table, "display")) {
    var list = Array.isArray(table.display) ? table.display : (isTable(table.display) ? [table.display] : null)
    if (!list) {
      errors.push(file + ": display: expected [[display]] tables, got " + show(table.display))
    } else {
      var displays = []
      for (var i = 0; i < list.length; i++) {
        var display = readDisplay(file, i, list[i], errors)
        if (!display) continue
        // Overrides and surfaces are per output, so an output holds one Display.
        if (displayNamed({ displays: displays }, display.name)) {
          errors.push(file + ": display[" + i + "].name: " + show(display.name) + " is already a Display; display skipped")
          continue
        }
        displays.push(display)
      }
      if (displays.length > 0) config.displays = displays
      else errors.push(file + ": no valid display, using " + DEFAULT_DISPLAY)
    }
  }
  return { config: config, errors: errors }
}

// The Display on an output, or null.
function displayNamed(config, name) {
  var displays = config && Array.isArray(config.displays) ? config.displays : []
  for (var i = 0; i < displays.length; i++) if (displays[i] && displays[i].name === name) return displays[i]
  return null
}

// Every Layout a Display's Deck names, once, in order of first use.
function deckLayoutNames(config) {
  var names = []
  var displays = config && Array.isArray(config.displays) ? config.displays : []
  for (var i = 0; i < displays.length; i++) {
    var deck = Array.isArray(displays[i].deck) ? displays[i].deck : []
    for (var j = 0; j < deck.length; j++) {
      if (isLayoutName(deck[j]) && names.indexOf(deck[j]) < 0) names.push(deck[j])
    }
  }
  return names
}

// ------------------------------------------------------------------ layouts

// A Module's share of the Layout along the split axis: columns in landscape,
// rows in portrait.
function readWeight(file, prefix, table, errors) {
  if (!own(table, "weight")) return DEFAULT_WEIGHT
  var value = table.weight
  if (typeof value === "number" && isFinite(value) && value > 0 && value <= MAX_WEIGHT) return value
  errors.push(file + ": " + prefix + "weight: expected a number above 0 and at most " + MAX_WEIGHT + ", got " + show(value))
  return DEFAULT_WEIGHT
}

// How big a Module draws (DensityPolicy): auto from its size and input, or
// the user's compact or full.
function readDensity(file, prefix, table, fallback, errors) {
  return pick(file, prefix, "density", table, DensityPolicy.SETTINGS, fallback, errors)
}

function readBoolean(file, prefix, table, key, fallback, errors) {
  if (!own(table, key)) return fallback
  if (typeof table[key] === "boolean") return table[key]
  errors.push(file + ": " + prefix + key + ": expected true or false, got " + show(table[key]))
  return fallback
}

// Keys about a Module's place in its Layout rather than its settings: only a
// [[module]] takes them, never [defaults].
var MODULE_ONLY_KEYS = ["type", "weight"]
// The settings of each Module type, which [defaults] and [defaults.<type>]
// may give as well as a [[module]].
var TYPE_KEYS = {
  "agent-list": ["density", "sort", "preset", "focus", "recap", "recap_open", "highlight_workspace"],
  "workspace-list": ["density", "tap", "focus"],
  "usage": ["density", "show", "providers", "refresh_seconds"]
}

// Each apply reads one type's keys present in `table` onto `settings`. A key
// that is absent or invalid keeps the value already there: the cascade so far.
function applyAgentList(file, prefix, table, settings, errors) {
  settings.density = readDensity(file, prefix, table, settings.density, errors)
  settings.highlightWorkspace = readBoolean(file, prefix, table, "highlight_workspace", settings.highlightWorkspace, errors)
  settings.sort = pick(file, prefix, "sort", table, SortPolicy.MODES, settings.sort, errors)
  settings.preset = pick(file, prefix, "preset", table, CardPolicy.PRESET_NAMES, settings.preset, errors)
  settings.focus = pick(file, prefix, "focus", table, FOCUS_MODES, settings.focus, errors)
  settings.recap = pick(file, prefix, "recap", table, RecapModel.MODES, settings.recap, errors)
  settings.recapOpen = pick(file, prefix, "recap_open", table, RecapModel.OPEN_MODES, settings.recapOpen, errors)
}

function applyWorkspaceList(file, prefix, table, settings, errors) {
  settings.density = readDensity(file, prefix, table, settings.density, errors)
  settings.tap = pick(file, prefix, "tap", table, WorkspaceTreeModel.TAP_MODES, settings.tap, errors)
  settings.focus = pick(file, prefix, "focus", table, FOCUS_MODES, settings.focus, errors)
}

function applyUsage(file, prefix, table, settings, errors) {
  settings.density = readDensity(file, prefix, table, settings.density, errors)
  settings.refreshSeconds = readRefresh(file, prefix, table, settings.refreshSeconds, errors)
  if (own(table, "show")) {
    if (!Array.isArray(table.show)) {
      errors.push(file + ": " + prefix + "show: expected a list of " + sameStrings(UsageModel.SHOW_ITEMS) + ", got " + show(table.show))
    } else {
      var items = []
      for (var i = 0; i < table.show.length; i++) {
        var item = table.show[i]
        if (typeof item !== "string" || UsageModel.SHOW_ITEMS.indexOf(item) < 0) {
          errors.push(file + ": " + prefix + "show[" + i + "]: expected one of " + sameStrings(UsageModel.SHOW_ITEMS) + ", got " + show(item))
        } else if (items.indexOf(item) < 0) {
          items.push(item)
        }
      }
      if (items.length > 0) settings.show = items
      else errors.push(file + ": " + prefix + "show: no valid items, using " + show(settings.show))
    }
  }
  if (own(table, "providers")) {
    if (!Array.isArray(table.providers)) {
      errors.push(file + ": " + prefix + "providers: expected a list of provider ids, got " + show(table.providers))
    } else {
      var providers = []
      for (var j = 0; j < table.providers.length; j++) {
        var id = table.providers[j]
        if (!UsageModel.isProviderId(id)) {
          errors.push(file + ": " + prefix + "providers[" + j + "]: expected a provider id such as claude, got " + show(id))
        } else if (providers.indexOf(id) < 0 && providers.length < UsageModel.MAX_PROVIDERS) {
          providers.push(id)
        }
      }
      settings.providers = providers
    }
  }
}

var APPLY = { "agent-list": applyAgentList, "workspace-list": applyWorkspaceList, "usage": applyUsage }

// A settings object whose lists are its own, so no two Modules share one.
function copySettings(settings) {
  var out = {}
  for (var key in settings) {
    if (own(settings, key)) out[key] = Array.isArray(settings[key]) ? settings[key].slice() : settings[key]
  }
  return out
}

function onlyKeys(table, keys) {
  var out = {}
  for (var i = 0; i < keys.length; i++) if (own(table, keys[i])) out[keys[i]] = table[keys[i]]
  return out
}

function isSettingKey(key) {
  for (var i = 0; i < MODULE_TYPES.length; i++) if (TYPE_KEYS[MODULE_TYPES[i]].indexOf(key) >= 0) return true
  return false
}

// gjetr.toml's [defaults] and [defaults.<type>] -> each Module type's
// settings before its own keys. Errors name gjetr.toml and the table, once
// even when a [defaults] key applies to several types.
function readDefaults(file, table, errors) {
  var out = moduleDefaults()
  if (!own(table, "defaults")) return out
  var value = table.defaults
  if (!isTable(value)) {
    errors.push(file + ": defaults: expected a [defaults] table, got " + show(value))
    return out
  }
  var found = []
  var keys = Object.keys(value)
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i]
    if (MODULE_TYPES.indexOf(key) >= 0) {
      if (!isTable(value[key])) found.push(file + ": defaults." + key + ": expected a [defaults." + key + "] table, got " + show(value[key]))
    } else if (MODULE_ONLY_KEYS.indexOf(key) >= 0) {
      found.push(file + ": defaults." + key + ": only in a [[module]] (ignored)")
    } else if (!isSettingKey(key)) {
      found.push(file + ": defaults." + key + ": " + (isTable(value[key])
        ? "expected a Module type (" + sameStrings(MODULE_TYPES) + ")" : "unknown key") + " (ignored)")
    }
  }
  for (var t = 0; t < MODULE_TYPES.length; t++) {
    var type = MODULE_TYPES[t]
    APPLY[type](file, "defaults.", onlyKeys(value, TYPE_KEYS[type]), out[type], found)
    if (!own(value, type) || !isTable(value[type])) continue
    var scoped = value[type]
    var prefix = "defaults." + type + "."
    var names = Object.keys(scoped)
    for (var n = 0; n < names.length; n++) {
      if (MODULE_ONLY_KEYS.indexOf(names[n]) >= 0) found.push(file + ": " + prefix + names[n] + ": only in a [[module]] (ignored)")
      else if (TYPE_KEYS[type].indexOf(names[n]) < 0) found.push(file + ": " + prefix + names[n] + ": unknown key for " + type + " (ignored)")
    }
    APPLY[type](file, prefix, onlyKeys(scoped, TYPE_KEYS[type]), out[type], found)
  }
  for (var e = 0; e < found.length; e++) if (errors.indexOf(found[e]) < 0) errors.push(found[e])
  return out
}

// One [[module]] of a known type, starting from its type's cascaded settings.
function readModule(file, prefix, table, base, errors) {
  var settings = copySettings(base)
  unknownKeys(file, prefix, table, MODULE_ONLY_KEYS.concat(TYPE_KEYS[table.type]), errors)
  settings.weight = readWeight(file, prefix, table, errors)
  APPLY[table.type](file, prefix, table, settings, errors)
  return settings
}

// defaults: ConfigModel.readMain's config.defaults; built-in when omitted.
function readLayout(name, text, defaults) {
  var bases = moduleDefaults()
  for (var d = 0; d < MODULE_TYPES.length; d++) {
    if (isTable(defaults) && isTable(defaults[MODULE_TYPES[d]])) bases[MODULE_TYPES[d]] = defaults[MODULE_TYPES[d]]
  }
  var layout = defaultLayout(name)
  layout.modules = [copySettings(bases["agent-list"])]
  var file = "layouts/" + layout.name + ".toml"
  var errors = []
  if (text === undefined || text === null) {
    errors.push(file + ": not found, using the default Agent List")
    return { layout: layout, errors: errors }
  }
  var table = parseToml(file, text, errors)
  if (!table) return { layout: layout, errors: errors }

  unknownKeys(file, "", table, ["orientation", "module"], errors)
  layout.orientation = pick(file, "", "orientation", table, ORIENTATIONS, layout.orientation, errors)

  var list = own(table, "module") ? table.module : []
  if (isTable(list)) list = [list]
  if (!Array.isArray(list)) {
    errors.push(file + ": module: expected [[module]] tables, got " + show(list))
    list = []
  }
  var modules = []
  for (var i = 0; i < list.length; i++) {
    var prefix = "module[" + i + "]."
    if (!isTable(list[i])) {
      errors.push(file + ": module[" + i + "]: expected a table, got " + show(list[i]))
      continue
    }
    if (typeof list[i].type !== "string" || MODULE_TYPES.indexOf(list[i].type) < 0) {
      errors.push(file + ": " + prefix + "type: expected one of " + sameStrings(MODULE_TYPES) + ", got "
        + show(list[i].type) + "; module skipped")
      continue
    }
    modules.push(readModule(file, prefix, list[i], bases[list[i].type], errors))
  }
  if (modules.length > 0) layout.modules = modules
  else errors.push(file + ": no valid module, using the default Agent List")
  return { layout: layout, errors: errors }
}

// The first Agent List in a Layout and its position, which keys its Overrides.
// Index -1 when the Layout has none.
function agentList(layout) {
  var modules = layout && Array.isArray(layout.modules) ? layout.modules : []
  for (var i = 0; i < modules.length; i++) {
    if (modules[i] && modules[i].type === "agent-list") return { index: i, settings: modules[i] }
  }
  return { index: -1, settings: defaultAgentList() }
}

// Every Module of a Layout, in order, with the key its Overrides and session
// state live under: <layout>#<position among the Layout's valid Modules>.
function layoutModules(layout) {
  var modules = layout && Array.isArray(layout.modules) ? layout.modules : []
  var name = layout && isLayoutName(layout.name) ? layout.name : ""
  var out = []
  for (var i = 0; i < modules.length; i++) {
    if (!modules[i] || MODULE_TYPES.indexOf(modules[i].type) < 0) continue
    out.push({ index: i, key: name === "" ? "" : name + "#" + i, type: modules[i].type,
      weight: modules[i].weight, settings: modules[i] })
  }
  return out
}

if (typeof module !== "undefined") {
  module.exports = {
    MAX_BYTES: MAX_BYTES,
    DEFAULT_DISPLAY: DEFAULT_DISPLAY,
    DEFAULT_LAYOUT: DEFAULT_LAYOUT,
    ORIENTATIONS: ORIENTATIONS,
    FOCUS_MODES: FOCUS_MODES,
    MODULE_TYPES: MODULE_TYPES,
    isLayoutName: isLayoutName,
    isOutputName: isOutputName,
    isConfigDir: isConfigDir,
    layoutPath: layoutPath,
    expandHome: expandHome,
    defaults: defaults,
    moduleDefaults: moduleDefaults,
    TYPE_KEYS: TYPE_KEYS,
    MODULE_ONLY_KEYS: MODULE_ONLY_KEYS,
    defaultLayout: defaultLayout,
    readMain: readMain,
    readLayout: readLayout,
    deckLayoutNames: deckLayoutNames,
    displayNamed: displayNamed,
    agentList: agentList,
    layoutModules: layoutModules,
    DEFAULT_WEIGHT: DEFAULT_WEIGHT
  }
}
