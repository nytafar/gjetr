.pragma library
.import "CommandPolicy.js" as CommandPolicy
.import "LatestPolicy.js" as LatestPolicy

// What gjetr shows when there is no Config: a preset (PresetModel) placed on
// this machine's outputs.
//
// - A connected touchscreen bound to an output of its own shows the `panel`
//   preset there. Hyprland reports touch devices without their output, so the
//   binding is read from the hl.device({ name, output }) rules in
//   ~/.config/hypr/input.lua, where Omarchy keeps input config.
// - Otherwise the `sidebar` preset: a Dock on the focused monitor. A
//   touchscreen that is the only monitor counts as none, so a touch laptop
//   gets the sidebar rather than a panel under all its windows.
// - Outputs chosen before are kept while they are still there, so a hotplug
//   elsewhere does not move what is shown.

// Whether the sidebar Dock shown without a Config starts shown. A keybinding
// with toggleDock hides it either way.
var SIDEBAR_VISIBLE = true

var TOUCH_PRESET = "panel"
var MONITOR_PRESET = "sidebar"

var OUTPUT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
var DEVICE_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function size(value) {
  return typeof value === "number" && isFinite(value) && value >= 0 ? Math.floor(value) : 0
}

// Lua source without its comments: --[[ blocks ]] and -- to the end of a line,
// except inside a quoted string.
function stripLuaComments(text) {
  var source = String(text).replace(/--\[(=*)\[[\s\S]*?\]\1\]/g, " ")
  var lines = source.split("\n")
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i]
    var quote = ""
    for (var j = 0; j < line.length; j++) {
      var c = line.charAt(j)
      if (quote !== "") {
        if (c === "\\") j++
        else if (c === quote) quote = ""
      } else if (c === "\"" || c === "'") {
        quote = c
      } else if (c === "-" && line.charAt(j + 1) === "-") {
        lines[i] = line.slice(0, j)
        break
      }
    }
  }
  return lines.join("\n")
}

function field(body, key) {
  var match = new RegExp("(^|[^A-Za-z0-9_])" + key + "\\s*=\\s*\"([^\"]*)\"").exec(body)
  return match ? match[2] : ""
}

// input.lua text -> every hl.device rule that binds a device to an output, in
// order: [{ name, output }].
function touchBindings(text) {
  if (typeof text !== "string") return []
  var source = stripLuaComments(text)
  var rule = /hl\.device\s*\(\s*\{([\s\S]*?)\}\s*\)/g
  var out = []
  var match
  while ((match = rule.exec(source)) !== null) {
    var name = field(match[1], "name")
    var output = field(match[1], "output")
    if (DEVICE_RE.test(name) && OUTPUT_RE.test(output)) out.push({ name: name, output: output })
  }
  return out
}

// `hyprctl -j monitors` -> { ok, monitors: [{ name, focused, disabled, width, height }] }
function parseMonitors(text) {
  var value
  try {
    value = JSON.parse(String(text))
  } catch (error) {
    return { ok: false, monitors: [] }
  }
  if (!Array.isArray(value)) return { ok: false, monitors: [] }
  var monitors = []
  for (var i = 0; i < value.length; i++) {
    var entry = value[i]
    if (!isObject(entry) || typeof entry.name !== "string" || !OUTPUT_RE.test(entry.name)) continue
    monitors.push({ name: entry.name, focused: entry.focused === true, disabled: entry.disabled === true,
      width: size(entry.width), height: size(entry.height) })
  }
  return { ok: true, monitors: monitors }
}

// `hyprctl -j devices` -> { ok, names: the touch devices' names }
function parseTouchDevices(text) {
  var value
  try {
    value = JSON.parse(String(text))
  } catch (error) {
    return { ok: false, names: [] }
  }
  if (!isObject(value)) return { ok: false, names: [] }
  var names = []
  var touch = Array.isArray(value.touch) ? value.touch : []
  for (var i = 0; i < touch.length; i++) {
    var name = isObject(touch[i]) ? touch[i].name : ""
    if (typeof name === "string" && DEVICE_RE.test(name) && names.indexOf(name) < 0) names.push(name)
  }
  return { ok: true, names: names }
}

// input: { monitors: parseMonitors().monitors, or null while unknown;
//   touchDevices: names, or null; bindings: touchBindings(); previous: the
//   last result, or null }
// -> { ready, preset: "panel" | "sidebar" | "", touchscreen, monitor, device, reason }
function detect(input) {
  var o = isObject(input) ? input : {}
  if (!Array.isArray(o.monitors)) {
    return { ready: false, preset: "", touchscreen: "", monitor: "", device: "", reason: "reading monitors" }
  }
  var enabled = []
  var focused = ""
  for (var i = 0; i < o.monitors.length; i++) {
    var monitor = o.monitors[i]
    if (!isObject(monitor) || monitor.disabled || typeof monitor.name !== "string" || !OUTPUT_RE.test(monitor.name)) continue
    if (enabled.indexOf(monitor.name) < 0) enabled.push(monitor.name)
    if (monitor.focused && focused === "") focused = monitor.name
  }
  if (enabled.length === 0) return { ready: true, preset: "", touchscreen: "", monitor: "", device: "", reason: "no monitor" }

  var devices = Array.isArray(o.touchDevices) ? o.touchDevices : []
  var bindings = Array.isArray(o.bindings) ? o.bindings : []
  var previous = isObject(o.previous) ? o.previous : {}
  var bound = []
  for (var b = 0; b < bindings.length; b++) {
    var binding = bindings[b]
    if (isObject(binding) && devices.indexOf(binding.name) >= 0 && enabled.indexOf(binding.output) >= 0) bound.push(binding)
  }

  var touchscreen = ""
  var device = ""
  var reason = "no connected touchscreen is bound to an output"
  if (bound.length > 0) {
    var pick = bound[0]
    for (var p = 0; p < bound.length; p++) {
      if (bound[p].output === previous.touchscreen) {
        pick = bound[p]
        break
      }
    }
    if (enabled.length < 2) {
      reason = "touchscreen " + pick.name + " is bound to " + pick.output + ", the only monitor"
    } else {
      touchscreen = pick.output
      device = pick.name
      reason = "touchscreen " + device + " is bound to " + touchscreen
    }
  }

  var candidates = enabled.filter(function(name) { return name !== touchscreen })
  var main = candidates.indexOf(previous.monitor) >= 0 ? previous.monitor
    : candidates.indexOf(focused) >= 0 ? focused : (candidates[0] || "")
  return { ready: true, preset: touchscreen !== "" ? TOUCH_PRESET : main !== "" ? MONITOR_PRESET : "",
    touchscreen: touchscreen, monitor: main, device: device, reason: reason }
}

// A Config read from a detected preset, with every Dock shown or hidden as
// SIDEBAR_VISIBLE says. The given Config is not changed.
function detectedConfig(config) {
  var source = isObject(config) ? config : {}
  var out = {}
  for (var key in source) if (Object.prototype.hasOwnProperty.call(source, key)) out[key] = source[key]
  out.displays = (Array.isArray(source.displays) ? source.displays : []).map(function(display) {
    var copy = {}
    for (var name in display) if (Object.prototype.hasOwnProperty.call(display, name)) copy[name] = display[name]
    if (copy.kind === "dock") copy.visible = SIDEBAR_VISIBLE
    return copy
  })
  return out
}

// ------------------------------------------------------------------ pipeline
//
// Detection as a pipeline (ADR 0003), driven by PipelineDriver.qml.
// state: { monitors, touchDevices, bindings: detect()'s inputs; detection: its
//   result; retryAt: ms after which a failed monitor read is tried again, 0
//   when none is due; guard: LatestPolicy's, one start per refresh; reading:
//   the replies of the latest refresh so far, null when none is running }
// events: { type: "refresh" } (start and a hotplug), { type: "bindings",
//   bindings }, { type: "tick" }, { type: "reply", id, text, code } with ids
//   "monitors:<refresh>" and "devices:<refresh>"
// -> { state, commands: [{ id, argv }] }. Nothing changed: the same state.

// A failed monitor read is tried again after this long.
var RETRY_MS = 2000

function initial() {
  return { monitors: null, touchDevices: null, bindings: [], detection: detect(null), retryAt: 0,
    guard: { sequence: 0 }, reading: null }
}

function withFields(state, fields) {
  var next = {}
  for (var key in state) next[key] = state[key]
  for (var name in fields) next[name] = fields[name]
  return next
}

function refresh(state) {
  var started = LatestPolicy.start(state.guard)
  return {
    state: withFields(state, { guard: started.guard, reading: { monitors: undefined, devices: undefined }, retryAt: 0 }),
    commands: [{ id: "monitors:" + started.token, argv: CommandPolicy.MONITORS.slice() },
      { id: "devices:" + started.token, argv: CommandPolicy.DEVICES.slice() }]
  }
}

// The state with detect()'s inputs set. Inputs that did not change keep the
// state and its detection; a detection that comes out the same keeps its
// reference, so bindings on it do not re-evaluate.
function withInputs(state, monitors, touchDevices, bindings) {
  var json = JSON.stringify
  if (json(monitors) === json(state.monitors) && json(touchDevices) === json(state.touchDevices)
    && json(bindings) === json(state.bindings)) return state
  var detection = detect({ monitors: monitors, touchDevices: touchDevices, bindings: bindings, previous: state.detection })
  return withFields(state, { monitors: monitors, touchDevices: touchDevices, bindings: bindings,
    detection: json(detection) === json(state.detection) ? state.detection : detection })
}

// A hyprctl answer. Only the latest refresh's ids are taken, each once. With
// both in, a failed monitor read schedules a retry; otherwise detection runs.
function answer(state, event, now) {
  var same = { state: state, commands: [] }
  var id = typeof event.id === "string" ? event.id : ""
  var colon = id.indexOf(":")
  var part = colon > 0 ? id.slice(0, colon) : ""
  if ((part !== "monitors" && part !== "devices") || state.reading === null
    || !LatestPolicy.accepts(state.guard, Number(id.slice(colon + 1)))) return same
  var reading = { monitors: state.reading.monitors, devices: state.reading.devices }
  if (part === "monitors") {
    if (reading.monitors !== undefined) return same
    var read = event.code === 0 ? parseMonitors(event.text) : { ok: false, monitors: [] }
    reading.monitors = read.ok ? read.monitors : null
  } else {
    if (reading.devices !== undefined) return same
    reading.devices = event.code === 0 ? parseTouchDevices(event.text).names : []
  }
  if (reading.monitors === undefined || reading.devices === undefined) {
    return { state: withFields(state, { reading: reading }), commands: [] }
  }
  if (reading.monitors === null) return { state: withFields(state, { reading: null, retryAt: now + RETRY_MS }), commands: [] }
  return { state: withInputs(withFields(state, { reading: null, retryAt: 0 }), reading.monitors, reading.devices, state.bindings),
    commands: [] }
}

function step(state, event, now) {
  var current = isObject(state) ? state : initial()
  var type = isObject(event) ? event.type : ""
  if (type === "refresh") return refresh(current)
  if (type === "reply") return answer(current, event, now)
  if (type === "tick") {
    return current.retryAt > 0 && now >= current.retryAt ? refresh(current) : { state: current, commands: [] }
  }
  if (type === "bindings") {
    var bindings = Array.isArray(event.bindings) ? event.bindings : []
    return { state: withInputs(current, current.monitors, current.touchDevices, bindings), commands: [] }
  }
  return { state: current, commands: [] }
}

if (typeof module !== "undefined") {
  module.exports = {
    SIDEBAR_VISIBLE: SIDEBAR_VISIBLE,
    TOUCH_PRESET: TOUCH_PRESET,
    MONITOR_PRESET: MONITOR_PRESET,
    touchBindings: touchBindings,
    parseMonitors: parseMonitors,
    parseTouchDevices: parseTouchDevices,
    detect: detect,
    detectedConfig: detectedConfig,
    RETRY_MS: RETRY_MS,
    initial: initial,
    step: step
  }
}
