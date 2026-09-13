.pragma library

// Every process gjetr starts, as an allowlist of exact argv shapes. Builders
// return [] for a value outside its allowlist, and the QML runner refuses any
// argv that `allowed` does not accept, so Config or herdr data can never add
// an argument, a shell word or a Lua expression. Commands never pass through
// a shell.

var PROCESSES = ["ps", "-e", "-o", "pid=,ppid=,comm=,args="]
var CLIENTS = ["hyprctl", "-j", "clients"]
var MONITORS = ["hyprctl", "-j", "monitors"]

var ADDRESS_RE = /^0x[0-9a-f]{1,16}$/

function isAddress(value) {
  return typeof value === "string" && ADDRESS_RE.test(value)
}

function same(a, b) {
  if (!Array.isArray(a) || a.length !== b.length) return false
  for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

// Focus a window by address. Hyprland switches to the window's workspace
// (and its monitor) as part of focusing it.
function focusWindow(address) {
  if (!isAddress(address)) return []
  return ["hyprctl", "dispatch", "hl.dsp.focus({ window = \"address:" + address + "\" })"]
}

var FOCUS_RE = /^hl\.dsp\.focus\(\{ window = "address:0x[0-9a-f]{1,16}" \}\)$/

var OUTPUT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

function isCoordinate(value) {
  return typeof value === "number" && isFinite(value) && Math.floor(value) === value && Math.abs(value) <= 100000
}

function scaleText(value) {
  if (typeof value !== "number" || !isFinite(value) || value < 0.25 || value > 10) return ""
  return String(Math.round(value * 1000000) / 1000000)
}

// Rotate an output at runtime without touching monitors.lua. A runtime rule
// merges into the output's existing one (docs/findings/T02.md), so every field
// the rule depends on is written: mode, position, scale and transform.
function rotateOutput(output, transform, x, y, scale) {
  var s = scaleText(scale)
  if (typeof output !== "string" || !OUTPUT_RE.test(output) || typeof transform !== "number"
    || [0, 1, 2, 3, 4, 5, 6, 7].indexOf(transform) < 0 || !isCoordinate(x) || !isCoordinate(y) || s === "") return []
  return ["hyprctl", "eval", "hl.monitor({ output = \"" + output + "\", mode = \"preferred\", position = \""
    + x + "x" + y + "\", scale = " + s + ", transform = " + transform + " })"]
}

// Touch follows a runtime rotation only when told to (docs/findings/T09.md):
// either the global touchdevice transform, or per-device rules for the
// touchscreens a Display names.
var DEVICE_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/

function touchTransform(transform) {
  if (typeof transform !== "number" || [0, 1, 2, 3, 4, 5, 6, 7].indexOf(transform) < 0) return []
  return ["hyprctl", "eval", "hl.config({ input = { touchdevice = { transform = " + transform + " } } })"]
}

function deviceTransform(name, output, transform) {
  if (typeof name !== "string" || !DEVICE_RE.test(name) || typeof output !== "string" || !OUTPUT_RE.test(output)
    || typeof transform !== "number" || [0, 1, 2, 3, 4, 5, 6, 7].indexOf(transform) < 0) return []
  return ["hyprctl", "eval", "hl.device({ name = \"" + name + "\", output = \"" + output + "\", transform = " + transform + " })"]
}

var TOUCH_RE = /^hl\.config\(\{ input = \{ touchdevice = \{ transform = [0-7] \} \} \}\)$/
var DEVICE_RULE_RE = /^hl\.device\(\{ name = "[A-Za-z0-9][A-Za-z0-9._:-]{0,63}", output = "[A-Za-z0-9][A-Za-z0-9._-]{0,63}", transform = [0-7] \}\)$/

var ROTATE_RE = /^hl\.monitor\(\{ output = "[A-Za-z0-9][A-Za-z0-9._-]{0,63}", mode = "preferred", position = "-?[0-9]{1,6}x-?[0-9]{1,6}", scale = [0-9]{1,2}(\.[0-9]{1,6})?, transform = [0-7] \}\)$/

function allowed(argv) {
  if (!Array.isArray(argv) || argv.length === 0) return false
  for (var i = 0; i < argv.length; i++) if (typeof argv[i] !== "string") return false
  if (same(argv, PROCESSES) || same(argv, CLIENTS) || same(argv, MONITORS)) return true
  if (argv.length === 3 && argv[0] === "hyprctl" && argv[1] === "dispatch" && FOCUS_RE.test(argv[2])) return true
  if (argv.length === 3 && argv[0] === "hyprctl" && argv[1] === "eval" && ROTATE_RE.test(argv[2])) return true
  if (argv.length === 3 && argv[0] === "hyprctl" && argv[1] === "eval"
    && (TOUCH_RE.test(argv[2]) || DEVICE_RULE_RE.test(argv[2]))) return true
  return false
}

if (typeof module !== "undefined") {
  module.exports = {
    PROCESSES: PROCESSES,
    CLIENTS: CLIENTS,
    MONITORS: MONITORS,
    rotateOutput: rotateOutput,
    touchTransform: touchTransform,
    deviceTransform: deviceTransform,
    isAddress: isAddress,
    focusWindow: focusWindow,
    allowed: allowed
  }
}
