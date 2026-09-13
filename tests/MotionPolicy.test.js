"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")
const loadLib = require("./support/loadLib.cjs")

const Motion = loadLib("lib/MotionPolicy.js")

const close = (actual, expected, message, epsilon = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < epsilon, `${message}: ${actual} != ${expected}`)

test("one clock ticks at a coarse rate, far below the display's 60 Hz", () => {
  assert.ok(Motion.FRAME_MS >= 40 && Motion.FRAME_MS <= 67, String(Motion.FRAME_MS))
})

test("a phase is the clock's place in a period, 0 to 1, and 0 without a period", () => {
  close(Motion.phase(0, 2000), 0, "start")
  close(Motion.phase(500, 2000), 0.25, "quarter")
  close(Motion.phase(2500, 2000), 0.25, "wraps")
  close(Motion.phase(1789329000123, 1000), 0.123, "wall clock", 1e-6)
  for (const period of [0, -5, NaN, undefined]) close(Motion.phase(1234, period), 0, String(period))
  for (const ms of [NaN, undefined, Infinity]) close(Motion.phase(ms, 1000), 0, String(ms))
})

test("the working glyph turns once per spin period", () => {
  close(Motion.spinAngle(0), 0, "start")
  close(Motion.spinAngle(Motion.SPIN_PERIOD / 4), 90, "quarter")
  close(Motion.spinAngle(Motion.SPIN_PERIOD * 3 + Motion.SPIN_PERIOD / 2), 180, "later turn")
  assert.equal(Motion.SPIN_PERIOD, 1800)
})

// What the Attention pulse was: SequentialAnimation of two NumberAnimations,
// 1 -> low and low -> 1, 650 ms each with Easing.InOutSine.
function sequentialPulse(ms, low) {
  const inOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2
  const p = ((ms % 1300) + 1300) % 1300
  return p < 650 ? 1 + (low - 1) * inOutSine(p / 650) : low + (1 - low) * inOutSine((p - 650) / 650)
}

test("the Attention pulse from the clock draws what the eased animation drew", () => {
  assert.equal(Motion.PULSE_PERIOD, 1300)
  for (const low of [0.2, 0.25]) {
    for (let ms = 0; ms < 2600; ms += 37) close(Motion.pulseOpacity(ms, low), sequentialPulse(ms, low), `low ${low} at ${ms}`)
  }
  close(Motion.pulseOpacity(0, 0.2), 1, "full at the start")
  close(Motion.pulseOpacity(650, 0.2), 0.2, "faintest halfway")
})
