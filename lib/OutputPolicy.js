.pragma library

// Which output a Display name means. A Display is named by its output's port
// (`DP-1`, `HDMI-A-2`) or, as Hyprland's monitor rules allow, by its
// monitor's description: `desc:<description>`, the `description` of
// `hyprctl monitors -j` (make, model and serial from its EDID). A port name
// changes when a cable moves; a description does not. Like Hyprland, a
// description matches exactly first, then as a prefix. Pure.

var DESC_PREFIX = "desc:"
var OUTPUT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
// A description as Hyprland reports it: printable, no control characters.
var DESCRIPTION_RE = /^[^\u0000-\u001f\u007f]{1,128}$/

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

// The description a `desc:` name asks for, or "" when it is not one.
function descriptionOf(name) {
  if (typeof name !== "string" || name.indexOf(DESC_PREFIX) !== 0) return ""
  var wanted = name.slice(DESC_PREFIX.length).trim()
  return DESCRIPTION_RE.test(wanted) ? wanted : ""
}

function isDescName(name) {
  return descriptionOf(name) !== ""
}

function isPortName(name) {
  return typeof name === "string" && OUTPUT_RE.test(name)
}

// A name a Display may have: a port name or a `desc:` name.
function isDisplayName(name) {
  return isPortName(name) || isDescName(name)
}

// A monitor's description from `hyprctl monitors -j`, cleaned, or "".
function cleanDescription(value) {
  if (typeof value !== "string") return ""
  var text = value.trim()
  return DESCRIPTION_RE.test(text) ? text : ""
}

// The port a Display name means among `monitors` ([{ name, description,
// disabled }], DetectPolicy.parseMonitors), or "" when none. A port name is
// itself; a `desc:` name is the first enabled monitor whose description is
// exactly it, else the first whose description starts with it.
function resolve(name, monitors) {
  var wanted = typeof name === "string" ? name.trim() : ""
  if (isPortName(wanted)) return wanted
  var description = descriptionOf(wanted)
  if (description === "") return ""
  var list = Array.isArray(monitors) ? monitors : []
  var prefix = ""
  for (var i = 0; i < list.length; i++) {
    var monitor = list[i]
    if (!isObject(monitor) || monitor.disabled === true || !isPortName(monitor.name)) continue
    var actual = cleanDescription(monitor.description)
    if (actual === "") continue
    if (actual === description) return monitor.name
    if (prefix === "" && actual.indexOf(description) === 0) prefix = monitor.name
  }
  return prefix
}

// Displays with each `desc:` name resolved to its port, so everything after
// sees port names. Each keeps the name its Config gave as `match`. A `desc:`
// Display no connected monitor matches keeps its name: no screen has it, so it
// is not drawn until its monitor is connected. A Display on an output an
// earlier one already holds is skipped, as an output holds one Display.
// -> { displays, errors }
function resolveDisplays(displays, monitors) {
  var list = Array.isArray(displays) ? displays : []
  var out = []
  var errors = []
  var taken = {}
  for (var i = 0; i < list.length; i++) {
    var display = list[i]
    if (!isObject(display)) continue
    var copy = {}
    for (var key in display) if (Object.prototype.hasOwnProperty.call(display, key)) copy[key] = display[key]
    var configured = typeof display.match === "string" && display.match !== "" ? display.match : String(display.name)
    copy.match = configured
    if (isDescName(configured)) {
      var port = resolve(configured, monitors)
      copy.name = port !== "" ? port : configured
    }
    if (Object.prototype.hasOwnProperty.call(taken, copy.name)) {
      errors.push("gjetr.toml: display " + JSON.stringify(configured) + " is on " + copy.name + ", which "
        + JSON.stringify(taken[copy.name]) + " already holds; display skipped")
      continue
    }
    taken[copy.name] = configured
    out.push(copy)
  }
  return { displays: out, errors: errors }
}

if (typeof module !== "undefined") {
  module.exports = {
    DESC_PREFIX: DESC_PREFIX,
    descriptionOf: descriptionOf,
    isDescName: isDescName,
    isPortName: isPortName,
    isDisplayName: isDisplayName,
    cleanDescription: cleanDescription,
    resolve: resolve,
    resolveDisplays: resolveDisplays
  }
}
