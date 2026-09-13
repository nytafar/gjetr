"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")
const loadLib = require("./support/loadLib.cjs")

const Indicator = loadLib("lib/IndicatorPolicy.js")

const EFFECTS = ["sweep", "breathe", "hue", "shimmer"]

test("indicator is glyph, icon or both, default glyph; working_effect defaults to sweep", () => {
  assert.deepEqual(Array.from(Indicator.MODES), ["glyph", "icon", "both"])
  assert.equal(Indicator.DEFAULT_MODE, "glyph")
  assert.deepEqual(Array.from(Indicator.WORKING_EFFECTS), EFFECTS)
  assert.equal(Indicator.DEFAULT_WORKING_EFFECT, "sweep")
  for (const junk of [undefined, null, "", "ICON", 3]) {
    assert.equal(Indicator.normalizeMode(junk), "glyph", String(junk))
    assert.equal(Indicator.normalizeEffect(junk), "sweep", String(junk))
  }
})

test("the status glyph hides only with icon, and only where a kind mark carries the state", () => {
  assert.equal(Indicator.showsGlyph("glyph", true), true)
  assert.equal(Indicator.showsGlyph("both", true), true)
  assert.equal(Indicator.showsGlyph("icon", true), false)
  // A workspace row has no kind mark: its glyph stays so the state reads.
  assert.equal(Indicator.showsGlyph("icon", false), true)
  assert.equal(Indicator.showsGlyph("junk", true), true)
})

test("the kind mark shows state with icon and both, and stays itself with glyph", () => {
  assert.equal(Indicator.marksState("glyph"), false)
  assert.equal(Indicator.marksState("icon"), true)
  assert.equal(Indicator.marksState("both"), true)
  assert.equal(Indicator.marksState(undefined), false)
})

test("working is accent and moves with the chosen effect", () => {
  for (const effect of EFFECTS) {
    const mark = Indicator.markFor("working", "", effect)
    assert.deepEqual([mark.tone, mark.opacity, mark.motion], ["accent", 1, effect], effect)
    assert.ok(mark.period > 0, effect)
  }
  assert.equal(Indicator.markFor("working", "", "sparkle").motion, "sweep")
})

test("idle is dim monochrome, unknown fainter still, neither moves", () => {
  const idle = Indicator.markFor("idle", "", "hue")
  const unknown = Indicator.markFor("unknown", "", "hue")
  assert.deepEqual([idle.tone, idle.motion, idle.period], ["foreground", "", 0])
  assert.deepEqual([unknown.tone, unknown.motion, unknown.period], ["muted", "", 0])
  assert.ok(idle.opacity > 0 && idle.opacity < 0.6, String(idle.opacity))
  assert.ok(unknown.opacity > 0 && unknown.opacity < idle.opacity, String(unknown.opacity))
})

test("blocked is steady urgent with a sharp flash, in Attention or not", () => {
  for (const attention of ["", "blocked"]) {
    const mark = Indicator.markFor("blocked", attention, "breathe")
    assert.deepEqual([mark.tone, mark.opacity, mark.motion], ["urgent", 1, "flash"], attention)
  }
})

test("done is the theme's green, pulsing only while in Attention", () => {
  assert.deepEqual(Object.values(Indicator.markFor("done", "", "sweep")).slice(1), ["success", 1, "", 0])
  const seen = Indicator.markFor("done", "done", "sweep")
  assert.deepEqual([seen.tone, seen.motion], ["success", "pulse"])
  assert.ok(seen.period > 0)
})

test("junk statuses draw as unknown, and callers get a copy", () => {
  for (const junk of [undefined, null, "", "sleeping", "__proto__", 4]) {
    assert.equal(Indicator.markFor(junk, "", "sweep").status, "unknown", String(junk))
  }
  const mark = Indicator.markFor("idle", "", "sweep")
  mark.tone = "urgent"
  assert.equal(Indicator.markFor("idle", "", "sweep").tone, "foreground")
})

test("breathe takes about 1.5 s and shimmer passes every 2 s; sweep and hue are slower", () => {
  assert.equal(Indicator.markFor("working", "", "breathe").period, 1500)
  assert.equal(Indicator.markFor("working", "", "shimmer").period, 2000)
  assert.ok(Indicator.markFor("working", "", "sweep").period >= 2000)
  assert.ok(Indicator.markFor("working", "", "hue").period >= 4000)
})

const NEUTRAL = { sweep: 0, band: -1, brightness: 0, glow: 0, opacity: 1 }

test("no motion draws a neutral frame at any phase, so nothing sticks when a state changes", () => {
  for (const phase of [0, 0.3, 0.5, 0.99, 7.25, NaN, Infinity, undefined]) {
    assert.deepEqual(Indicator.frame("", phase), NEUTRAL, String(phase))
    assert.deepEqual(Indicator.frame("nope", phase), NEUTRAL, String(phase))
  }
})

test("sweep moves the gradient along with the phase and wraps", () => {
  assert.equal(Indicator.frame("sweep", 0).sweep, 0)
  assert.equal(Indicator.frame("sweep", 0.5).sweep, 0.5)
  assert.equal(Indicator.frame("sweep", 1.25).sweep, 0.25)
  assert.equal(Indicator.frame("sweep", 0.5).brightness, 0)
})

test("shimmer's band crosses the mark early in each period and is gone for the rest", () => {
  const share = Indicator.SHIMMER_SHARE
  assert.ok(share > 0 && share < 0.5)
  assert.equal(Indicator.frame("shimmer", 0).band, 0)
  assert.ok(Math.abs(Indicator.frame("shimmer", share / 2).band - 0.5) < 1e-9)
  assert.equal(Indicator.frame("shimmer", share + 0.01).band, -1)
  assert.equal(Indicator.frame("shimmer", 0.9).band, -1)
})

test("breathe brightens and glows smoothly, peaking mid-period", () => {
  const start = Indicator.frame("breathe", 0)
  const mid = Indicator.frame("breathe", 0.5)
  assert.equal(start.glow, 0)
  assert.equal(start.brightness, 0)
  assert.ok(Math.abs(mid.glow - 1) < 1e-9)
  assert.ok(mid.brightness > 0 && mid.brightness <= 0.5)
  assert.ok(Indicator.frame("breathe", 0.25).glow > 0.4 && Indicator.frame("breathe", 0.25).glow < 0.6)
})

test("blocked's flash rises fast and falls, then rests steady", () => {
  const values = [0, 0.02, 0.05, 0.08, 0.2, 0.3, 0.5, 0.8].map(p => Indicator.frame("flash", p).glow)
  assert.equal(values[0], 0)
  assert.ok(values[3] > 0.95, String(values[3]))
  assert.ok(values[4] < values[3] && values[5] < values[4])
  assert.equal(values[6], 0)
  assert.equal(values[7], 0)
  assert.ok(Indicator.frame("flash", 0.08).brightness > 0)
})

test("done's pulse dims and returns", () => {
  assert.equal(Indicator.frame("pulse", 0).opacity, 1)
  const low = Indicator.frame("pulse", 0.5).opacity
  assert.ok(low >= 0.2 && low < 0.6, String(low))
  assert.ok(Math.abs(Indicator.frame("pulse", 1).opacity - 1) < 1e-9)
})

test("hueStep walks the palette in a loop", () => {
  assert.deepEqual(Indicator.hueStep(0, 0.4), { from: 0, to: 0, t: 0 })
  assert.deepEqual(Indicator.hueStep(1, 0.4), { from: 0, to: 0, t: 0 })
  assert.deepEqual(Indicator.hueStep(4, 0), { from: 0, to: 1, t: 0 })
  const mid = Indicator.hueStep(3, 0.5)
  assert.deepEqual([mid.from, mid.to], [1, 2])
  assert.ok(Math.abs(mid.t - 0.5) < 1e-9)
  const last = Indicator.hueStep(3, 0.9)
  assert.deepEqual([last.from, last.to], [2, 0])
  assert.deepEqual(Indicator.hueStep(3, NaN), { from: 0, to: 1, t: 0 })
})

// What the hue fill was: Qt.tint(palette[from], Util.alpha(palette[to], t)),
// which is Qt's tintColor(base, tint).
function qtTint(base, tint) {
  const a = tint.a
  const inv = 1 - a
  return { r: tint.r * a + base.r * inv, g: tint.g * a + base.g * inv, b: tint.b * a + base.b * inv, a: a + inv * base.a }
}

test("hueColor mixes the palette's colours as Qt.tint with the next colour at alpha t did", () => {
  const palette = [{ r: 1, g: 0.2, b: 0.1, a: 1 }, { r: 0.1, g: 0.8, b: 0.3, a: 1 }, { r: 0.2, g: 0.4, b: 1, a: 0.5 }]
  for (let phase = 0; phase < 1; phase += 0.07) {
    const step = Indicator.hueStep(palette.length, phase)
    const expected = qtTint(palette[step.from], { r: palette[step.to].r, g: palette[step.to].g, b: palette[step.to].b, a: step.t })
    const got = Indicator.hueColor(palette, phase)
    for (const channel of ["r", "g", "b", "a"]) {
      assert.ok(Math.abs(got[channel] - expected[channel]) < 1e-12, `${channel} at ${phase}: ${got[channel]} != ${expected[channel]}`)
    }
  }
  assert.equal(Indicator.hueColor([], 0.5), null)
  assert.equal(Indicator.hueColor([palette[0]], 0.5), null)
  assert.equal(Indicator.hueColor(null, 0.5), null)
})
