.pragma library
.import "vendor/toml.js" as Toml
.import "SortPolicy.js" as SortPolicy
.import "CardPolicy.js" as CardPolicy
.import "RecapModel.js" as RecapModel

// Config: the user's TOML files in ~/.config/gjetr/ -> validated Displays,
// Decks, Layouts and Module settings. Config is untrusted input. Every value
// is checked, a bad value falls back to its default with an error that names
// the file and key, and a file that does not parse falls back as a whole.
// gjetr never writes Config.
//
//   gjetr.toml           socket, [[display]] name, deck, rotatable, background
//   layouts/<name>.toml  orientation, [[module]] type and its settings
//                        (sort, preset, focus, recap, recap_open)
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
var MODULE_TYPES = ["agent-list"]

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

function pick(file, key, table, allowed, fallback, errors) {
  if (!own(table, key)) return fallback
  var value = table[key]
  if (typeof value === "string" && allowed.indexOf(value) >= 0) return value
  errors.push(file + ": " + key + ": expected one of " + sameStrings(allowed) + ", got " + show(value))
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

function defaultDisplay() {
  return { name: DEFAULT_DISPLAY, deck: [DEFAULT_LAYOUT], rotatable: false, background: "black", touchDevices: [] }
}

function defaultAgentList() {
  return { type: "agent-list", sort: SortPolicy.DEFAULT_MODE, preset: CardPolicy.DEFAULT_PRESET, focus: "herdr",
    recap: RecapModel.DEFAULT_MODE, recapOpen: RecapModel.DEFAULT_OPEN }
}

function defaultLayout(name) {
  return { name: isLayoutName(name) ? name : DEFAULT_LAYOUT, orientation: "portrait", modules: [defaultAgentList()] }
}

function defaults(home) {
  return {
    socket: expandHome("~/.config/herdr/herdr.sock", home),
    displays: [defaultDisplay()]
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
  unknownKeys(file, prefix, table, ["name", "deck", "rotatable", "background", "touch_devices"], errors)
  var display = defaultDisplay()
  display.name = table.name
  display.deck = readDeck(file, prefix, table, errors)
  if (own(table, "rotatable")) {
    if (typeof table.rotatable === "boolean") display.rotatable = table.rotatable
    else errors.push(file + ": " + prefix + "rotatable: expected true or false, got " + show(table.rotatable))
  }
  if (own(table, "touch_devices")) {
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

  unknownKeys(file, "", table, ["socket", "display"], errors)
  config.socket = readSocket(file, table, home, config.socket, errors)

  if (own(table, "display")) {
    var list = Array.isArray(table.display) ? table.display : (isTable(table.display) ? [table.display] : null)
    if (!list) {
      errors.push(file + ": display: expected [[display]] tables, got " + show(table.display))
    } else {
      var displays = []
      for (var i = 0; i < list.length; i++) {
        var display = readDisplay(file, i, list[i], errors)
        if (display) displays.push(display)
      }
      if (displays.length > 0) config.displays = displays
      else errors.push(file + ": no valid display, using " + DEFAULT_DISPLAY)
    }
  }
  return { config: config, errors: errors }
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

function readAgentList(file, prefix, table, errors) {
  var settings = defaultAgentList()
  unknownKeys(file, prefix, table, ["type", "sort", "preset", "focus", "recap", "recap_open"], errors)
  var scoped = []
  settings.sort = pick(file, "sort", table, SortPolicy.MODES, settings.sort, scoped)
  settings.preset = pick(file, "preset", table, CardPolicy.PRESET_NAMES, settings.preset, scoped)
  settings.focus = pick(file, "focus", table, FOCUS_MODES, settings.focus, scoped)
  settings.recap = pick(file, "recap", table, RecapModel.MODES, settings.recap, scoped)
  settings.recapOpen = pick(file, "recap_open", table, RecapModel.OPEN_MODES, settings.recapOpen, scoped)
  for (var i = 0; i < scoped.length; i++) errors.push(scoped[i].replace(file + ": ", file + ": " + prefix))
  return settings
}

function readLayout(name, text) {
  var layout = defaultLayout(name)
  var file = "layouts/" + layout.name + ".toml"
  var errors = []
  if (text === undefined || text === null) {
    errors.push(file + ": not found, using the default Agent List")
    return { layout: layout, errors: errors }
  }
  var table = parseToml(file, text, errors)
  if (!table) return { layout: layout, errors: errors }

  unknownKeys(file, "", table, ["orientation", "module"], errors)
  layout.orientation = pick(file, "orientation", table, ORIENTATIONS, layout.orientation, errors)

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
    modules.push(readAgentList(file, prefix, list[i], errors))
  }
  if (modules.length > 0) layout.modules = modules
  else errors.push(file + ": no valid module, using the default Agent List")
  return { layout: layout, errors: errors }
}

// The first Agent List in a Layout and its position, which keys its Overrides.
function agentList(layout) {
  var modules = layout && Array.isArray(layout.modules) ? layout.modules : []
  for (var i = 0; i < modules.length; i++) {
    if (modules[i] && modules[i].type === "agent-list") return { index: i, settings: modules[i] }
  }
  return { index: 0, settings: defaultAgentList() }
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
    defaultLayout: defaultLayout,
    readMain: readMain,
    readLayout: readLayout,
    deckLayoutNames: deckLayoutNames,
    agentList: agentList
  }
}
