.pragma library

// Timing of every motion gjetr draws: the working glyph's turn, the Attention
// pulse and the kind mark's effects (IndicatorPolicy.frame). One clock drives
// them all (components/MotionClock.qml), ticking every FRAME_MS while anything
// moves on screen, and nothing at all while nothing does.
//
// Why a coarse clock: a Qt Quick window redraws all of itself for any change,
// so one vsync-driven animation, even a 14 px glyph, kept a whole Dock redrawn
// 60 times a second (about 9% of a core per window on the Intel iGPU). Every
// motion here is slow and small, and reads the same at 20 frames a second;
// one shared clock also puts every window's updates into the same frames.
// Pure.

// Milliseconds between frames while anything moves: 20 a second.
var FRAME_MS = 50

// The working glyph turns once in SPIN_PERIOD; the Attention pulse fades and
// returns in PULSE_PERIOD (650 ms each way, as the eased animation it replaces).
var SPIN_PERIOD = 1800
var PULSE_PERIOD = 1300

// The clock's place in a period, 0 to 1; 0 without a usable period or time.
function phase(ms, period) {
  var p = Number(period)
  var t = Number(ms)
  if (!isFinite(p) || p <= 0 || !isFinite(t)) return 0
  var x = t / p
  return x - Math.floor(x)
}

// Degrees the working glyph has turned.
function spinAngle(ms) {
  return 360 * phase(ms, SPIN_PERIOD)
}

// The Attention pulse's opacity: 1, easing (sine in and out) down to `low`
// halfway through the period and back.
function pulseOpacity(ms, low) {
  var wave = 0.5 - 0.5 * Math.cos(2 * Math.PI * phase(ms, PULSE_PERIOD))
  return 1 - (1 - low) * wave
}

if (typeof module !== "undefined") {
  module.exports = {
    FRAME_MS: FRAME_MS,
    SPIN_PERIOD: SPIN_PERIOD,
    PULSE_PERIOD: PULSE_PERIOD,
    phase: phase,
    spinAngle: spinAngle,
    pulseOpacity: pulseOpacity
  }
}
