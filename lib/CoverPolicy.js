.pragma library

// Cover: whether a window covers a surface. A surface sits on the Bottom layer
// and reserves nothing, so any window Hyprland shows on its output is drawn
// over it, and nothing else reports that. Pure: `hyprctl -j monitors` and
// `hyprctl -j clients` in, the covering windows out.
//
// A window covers the surface when it is mapped, not hidden (a group's
// background tab), on a workspace the surface's monitor shows now (its active
// workspace, its open special workspace, or pinned to that monitor), and its
// rectangle overlaps the monitor's. Coordinates are Hyprland's global logical
// pixels: a monitor's mode size divided by its scale, swapped for a quarter
// turn. A fullscreen window has the monitor's rectangle, so it counts the same.
//
// A Dock is not checked: it is on the Top layer and windows tile beside it.

var OUTPUT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
var ADDRESS_RE = /^0x[0-9a-f]{1,16}$/
// At most this many covering windows are listed; `count` keeps the total.
var MAX_WINDOWS = 16

// Hyprland events after which a window may have started or stopped covering
// an output. A floating window dragged or resized sends none, so the check
// also runs on a slow timer.
var EVENTS = ["openwindow", "closewindow", "movewindow", "movewindowv2", "workspace", "workspacev2",
  "focusedmon", "focusedmonv2", "activespecial", "activespecialv2", "activewindow", "activewindowv2",
  "changefloatingmode", "fullscreen", "pin", "minimized", "moveworkspace", "moveworkspacev2",
  "togglegroup", "moveintogroup", "moveoutofgroup", "monitoradded", "monitoraddedv2", "monitorremoved",
  "monitorremovedv2", "configreloaded"]

function triggers(eventName) {
  return typeof eventName === "string" && EVENTS.indexOf(eventName) >= 0
}

function str(value) {
  return value === undefined || value === null ? "" : String(value)
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function isNumber(value) {
  return typeof value === "number" && isFinite(value)
}

function isInteger(value) {
  return isNumber(value) && Math.floor(value) === value
}

function parseList(text) {
  var value
  try {
    value = JSON.parse(str(text))
  } catch (error) {
    return null
  }
  return Array.isArray(value) ? value : null
}

function workspaceId(value) {
  return isObject(value) && isInteger(value.id) ? value.id : 0
}

// `hyprctl -j monitors` -> [{ id, name, x, y, width, height, workspace, special, disabled }]
// in logical pixels, or null when the text is not a monitor list.
function parseMonitors(text) {
  var list = parseList(text)
  if (!list) return null
  var out = []
  for (var i = 0; i < list.length; i++) {
    var m = list[i]
    if (!isObject(m) || typeof m.name !== "string" || !OUTPUT_RE.test(m.name) || !isInteger(m.id)
      || !isNumber(m.x) || !isNumber(m.y) || !isNumber(m.width) || !isNumber(m.height)) continue
    var scale = isNumber(m.scale) && m.scale > 0 ? m.scale : 1
    var quarter = isInteger(m.transform) && (m.transform & 1) === 1
    var w = Math.round(m.width / scale)
    var h = Math.round(m.height / scale)
    out.push({ id: m.id, name: m.name, x: m.x, y: m.y, width: quarter ? h : w, height: quarter ? w : h,
      workspace: workspaceId(m.activeWorkspace), special: workspaceId(m.specialWorkspace), disabled: m.disabled === true })
  }
  return out
}

// `hyprctl -j clients` -> the fields cover needs, with invalid rows dropped,
// or null when the text is not a client list.
function parseClients(text) {
  var list = parseList(text)
  if (!list) return null
  var out = []
  for (var i = 0; i < list.length; i++) {
    var c = list[i]
    if (!isObject(c) || typeof c.address !== "string" || !ADDRESS_RE.test(c.address)) continue
    if (!Array.isArray(c.at) || !Array.isArray(c.size) || !isNumber(c.at[0]) || !isNumber(c.at[1])
      || !isNumber(c.size[0]) || !isNumber(c.size[1])) continue
    out.push({
      address: c.address,
      title: str(c.title).slice(0, 120),
      className: str(c["class"]).slice(0, 120),
      workspace: workspaceId(c.workspace),
      workspaceName: isObject(c.workspace) ? str(c.workspace.name).slice(0, 64) : "",
      monitor: isInteger(c.monitor) ? c.monitor : -1,
      x: c.at[0], y: c.at[1], width: c.size[0], height: c.size[1],
      mapped: c.mapped !== false,
      hidden: c.hidden === true,
      floating: c.floating === true,
      pinned: c.pinned === true,
      fullscreen: isInteger(c.fullscreen) ? c.fullscreen > 0 : c.fullscreen === true
    })
  }
  return out
}

function overlaps(a, b) {
  return a.width > 0 && a.height > 0 && b.width > 0 && b.height > 0
    && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

function shownOn(client, monitor) {
  if (client.workspace !== 0 && client.workspace === monitor.workspace) return true
  if (monitor.special !== 0 && client.workspace === monitor.special) return true
  return client.pinned && client.monitor === monitor.id
}

// The windows covering `output`, in Hyprland's order.
function coveringWindows(monitor, clients) {
  var list = Array.isArray(clients) ? clients : []
  var out = []
  if (!monitor || monitor.disabled) return out
  for (var i = 0; i < list.length; i++) {
    var c = list[i]
    if (c && c.mapped && !c.hidden && shownOn(c, monitor) && overlaps(c, monitor)) out.push(c)
  }
  return out
}

// One check: both replies in, what `state` reports out.
// -> { checked, covered, count, windows: [{ address, title, class, workspace, floating, fullscreen }], error }
// `covered` is null when the check could not tell.
function check(monitorsText, clientsText, output) {
  var monitors = parseMonitors(monitorsText)
  var clients = parseClients(clientsText)
  if (!monitors) return unknown("hyprctl monitors unreadable")
  if (!clients) return unknown("hyprctl clients unreadable")
  var monitor = null
  for (var i = 0; i < monitors.length; i++) if (monitors[i].name === output) monitor = monitors[i]
  if (!monitor) return unknown("output " + str(output) + " not in hyprctl monitors")
  var windows = coveringWindows(monitor, clients)
  return {
    checked: true,
    covered: windows.length > 0,
    count: windows.length,
    windows: windows.slice(0, MAX_WINDOWS).map(function(c) {
      return { address: c.address, title: c.title, "class": c.className, workspace: c.workspaceName,
        floating: c.floating, fullscreen: c.fullscreen }
    }),
    error: ""
  }
}

function unknown(error) {
  return { checked: false, covered: null, count: 0, windows: [], error: error }
}

// Before the first check.
function initial() {
  return unknown("")
}

// The warning for a covered surface, or "".
function warning(output, result) {
  if (!result || result.covered !== true) return ""
  var first = result.windows[0]
  var name = first ? (first["class"] || first.title || first.address) : "a window"
  return "surface " + str(output) + " is covered by " + name
    + (result.count > 1 ? " and " + (result.count - 1) + " more" : "")
}

// Whether two results report the same cover, so an unchanged check is neither
// logged nor assigned again.
function same(a, b) {
  if (!a || !b || a.checked !== b.checked || a.covered !== b.covered || a.count !== b.count || a.error !== b.error) return false
  for (var i = 0; i < a.windows.length; i++) {
    var x = a.windows[i]
    var y = b.windows[i]
    if (!y || x.address !== y.address || x.title !== y.title || x.workspace !== y.workspace
      || x.floating !== y.floating || x.fullscreen !== y.fullscreen) return false
  }
  return true
}

if (typeof module !== "undefined") {
  module.exports = {
    EVENTS: EVENTS,
    MAX_WINDOWS: MAX_WINDOWS,
    triggers: triggers,
    parseMonitors: parseMonitors,
    parseClients: parseClients,
    coveringWindows: coveringWindows,
    check: check,
    initial: initial,
    warning: warning,
    same: same
  }
}
