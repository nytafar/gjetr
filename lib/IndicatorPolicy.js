.pragma library

// The kind mark as a status indicator. A Module's `indicator` setting:
// "glyph" (the default) shows the status glyph beside the kind mark as it is;
// "icon" draws the kind mark itself monochrome in its status (and hides the
// glyph wherever there is a mark to carry the state); "both" draws the glyph
// and the stateful mark. The status word stays wherever a Card shows it, so
// state reads without colour.
//
// Per status the mark has a theme tone, an opacity and a motion:
//   working  accent, moving with the Module's `working_effect`: sweep (a slow
//            gradient through the accent), breathe (brightness and a soft glow),
//            hue (a slow cycle through the theme palette), shimmer (a narrow
//            highlight band passing)
//   idle     foreground, dimmed, still
//   blocked  urgent, steady, with a sharp flash
//   done     the theme's green; pulsing while the Agent is in Attention
//   unknown  muted, faded, still
//
// The Module animates one `phase` from 0 to 1 per period; `frame` turns it into
// what to draw, and a motion of "" is neutral at any phase, so nothing is left
// behind when a status changes. Pure.

var MODES = ["glyph", "icon", "both"]
var DEFAULT_MODE = "glyph"
var WORKING_EFFECTS = ["sweep", "breathe", "hue", "shimmer"]
var DEFAULT_WORKING_EFFECT = "sweep"

var STATUSES = ["working", "idle", "blocked", "done", "unknown"]
var STATES = {
  working: { tone: "accent", opacity: 1 },
  idle: { tone: "foreground", opacity: 0.45 },
  blocked: { tone: "urgent", opacity: 1 },
  done: { tone: "success", opacity: 1 },
  unknown: { tone: "muted", opacity: 0.3 }
}

// Milliseconds per period of each motion.
var PERIODS = { sweep: 2400, breathe: 1500, hue: 6000, shimmer: 2000, flash: 1100, pulse: 1300 }

// Shimmer: the share of its period the band takes to cross the mark.
var SHIMMER_SHARE = 0.3
// Breathe and flash: the brightness at their peak (MultiEffect brightness).
var BREATHE_BRIGHTNESS = 0.35
var FLASH_BRIGHTNESS = 0.55
// Flash: rises over this share of its period, then falls until FLASH_FALL.
var FLASH_RISE = 0.08
var FLASH_FALL = 0.4
// Pulse: how far the mark fades at its lowest.
var PULSE_DEPTH = 0.6
// Sweep: how much lighter the gradient's highlight is than the accent (Qt.lighter).
var SWEEP_HIGHLIGHT = 1.6

function normalizeMode(value) {
  return typeof value === "string" && MODES.indexOf(value) >= 0 ? value : DEFAULT_MODE
}

function normalizeEffect(value) {
  return typeof value === "string" && WORKING_EFFECTS.indexOf(value) >= 0 ? value : DEFAULT_WORKING_EFFECT
}

// Whether the status glyph is drawn. Only "icon" hides it, and only where a
// kind mark is there to carry the state (a workspace row has none).
function showsGlyph(mode, hasMark) {
  return normalizeMode(mode) !== "icon" || !hasMark
}

// Whether the kind mark draws its Agent's state rather than itself.
function marksState(mode) {
  return normalizeMode(mode) !== "glyph"
}

// status, attention ("blocked", "done" or ""), the Module's working_effect ->
// { status, tone, opacity, motion, period }.
function markFor(status, attention, workingEffect) {
  var key = typeof status === "string" && STATUSES.indexOf(status) >= 0 ? status : "unknown"
  var motion = key === "working" ? normalizeEffect(workingEffect)
    : key === "blocked" ? "flash"
    : key === "done" && attention === "done" ? "pulse"
    : ""
  return { status: key, tone: STATES[key].tone, opacity: STATES[key].opacity, motion: motion,
    period: motion === "" ? 0 : PERIODS[motion] }
}

function wrap(phase) {
  var p = Number(phase)
  return isFinite(p) ? p - Math.floor(p) : 0
}

// What a motion draws at a phase:
//   sweep       the gradient's offset along the mark, 0 to 1
//   band        the shimmer band's position across the mark, 0 to 1, or -1 when not shown
//   brightness  added brightness
//   glow        the glow's strength, 0 to 1
//   opacity     multiplies the mark's opacity
function frame(motion, phase) {
  var out = { sweep: 0, band: -1, brightness: 0, glow: 0, opacity: 1 }
  var p = wrap(phase)
  // 0 at the start of a period, 1 halfway, 0 again at its end.
  var wave = 0.5 - 0.5 * Math.cos(2 * Math.PI * p)
  if (motion === "sweep") {
    out.sweep = p
  } else if (motion === "shimmer") {
    out.band = p < SHIMMER_SHARE ? p / SHIMMER_SHARE : -1
  } else if (motion === "breathe") {
    out.brightness = BREATHE_BRIGHTNESS * wave
    out.glow = wave
  } else if (motion === "flash") {
    var spike = p < FLASH_RISE ? p / FLASH_RISE
      : p < FLASH_FALL ? 1 - (p - FLASH_RISE) / (FLASH_FALL - FLASH_RISE)
      : 0
    out.brightness = FLASH_BRIGHTNESS * spike
    out.glow = spike
  } else if (motion === "pulse") {
    out.opacity = 1 - PULSE_DEPTH * wave
  }
  return out
}

// The hue cycle over a palette of `count` colours: mix palette[from] into
// palette[to] by t.
function hueStep(count, phase) {
  var n = Math.floor(Number(count))
  if (!isFinite(n) || n < 2) return { from: 0, to: 0, t: 0 }
  var x = wrap(phase) * n
  var from = Math.min(n - 1, Math.floor(x))
  return { from: from, to: (from + 1) % n, t: x - from }
}

// The hue fill at a phase, over the palette as colour components ({ r, g, b,
// a }, 0 to 1): the colour hueStep is on, tinted with the next at alpha t, as
// Qt.tint(from, Util.alpha(to, t)) gives, without reading a colour per frame.
// null with fewer than two colours.
function hueColor(colors, phase) {
  if (!Array.isArray(colors) || colors.length < 2) return null
  var step = hueStep(colors.length, phase)
  var from = colors[step.from]
  var to = colors[step.to]
  var inv = 1 - step.t
  return { r: to.r * step.t + from.r * inv, g: to.g * step.t + from.g * inv, b: to.b * step.t + from.b * inv,
    a: step.t + inv * from.a }
}

if (typeof module !== "undefined") {
  module.exports = {
    MODES: MODES,
    DEFAULT_MODE: DEFAULT_MODE,
    WORKING_EFFECTS: WORKING_EFFECTS,
    DEFAULT_WORKING_EFFECT: DEFAULT_WORKING_EFFECT,
    PERIODS: PERIODS,
    SHIMMER_SHARE: SHIMMER_SHARE,
    SWEEP_HIGHLIGHT: SWEEP_HIGHLIGHT,
    normalizeMode: normalizeMode,
    normalizeEffect: normalizeEffect,
    showsGlyph: showsGlyph,
    marksState: marksState,
    markFor: markFor,
    frame: frame,
    hueStep: hueStep,
    hueColor: hueColor
  }
}
