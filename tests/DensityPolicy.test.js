"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")
const loadLib = require("./support/loadLib.cjs")

const Density = loadLib("lib/DensityPolicy.js")
const Card = loadLib("lib/CardPolicy.js")

// Omarchy's type ramp and spacing at base size 12.
const FONTS = { caption: 10, body: 12, title: 14 }
const SPACING = { sm: 4, lg: 8, xxl: 12 }

function tokens(width, height, input, dpr) {
  return Density.tokens({ width, height, input, fonts: FONTS, spacing: SPACING, dpr })
}

test("a Dock is a pointer Display and a surface a touch Display", () => {
  assert.equal(Density.inputFor("dock"), "pointer")
  assert.equal(Density.inputFor("surface"), "touch")
  assert.equal(Density.inputFor(undefined), "touch")
})

test("pointer Displays are compact at any size", () => {
  assert.equal(Density.densityFor(360, 714, "pointer"), "compact")
  assert.equal(Density.densityFor(1920, 360, "pointer"), "compact")
})

test("touch keeps comfortable Cards unless the column is narrow", () => {
  assert.equal(Density.densityFor(1024, 544, "touch"), "comfortable")
  assert.equal(Density.densityFor(383, 544, "touch"), "comfortable")
  assert.equal(Density.densityFor(Density.COMPACT_TOUCH_BELOW - 1, 544, "touch"), "compact")
  // Before the first configure a Module reports 0x0: not narrow yet.
  assert.equal(Density.densityFor(0, 0, "touch"), "comfortable")
  assert.equal(Density.densityFor(300, 544, "bogus"), "compact")
  assert.equal(Density.densityFor(800, 544, "bogus"), "comfortable")
})

test("comfortable tokens are today's touch sizes", () => {
  const t = tokens(1024, 544, "touch", 1)
  assert.equal(t.name, "comfortable")
  assert.equal(t.boxed, true)
  assert.equal(t.textScale, 1.25)
  assert.equal(t.titlePx, 18)
  assert.equal(t.bodyPx, 15)
  assert.equal(t.captionPx, 13)
  assert.equal(t.iconPx, 28)
  assert.equal(t.statusWidth, 28)
  assert.equal(t.pad, 12)
  assert.equal(t.gap, 8)
  assert.equal(t.headerHeight, Card.MIN_TOUCH_PX)
  assert.equal(t.rowHeight, Card.MIN_TOUCH_PX)
  assert.equal(t.indent, 28)
  assert.equal(t.minColumnWidth, 440)
  assert.equal(t.recapLines, 2)
})

test("compact tokens drop the boxes and shrink type, icons and padding", () => {
  const comfy = tokens(1024, 544, "touch", 1)
  const t = tokens(360, 714, "pointer", 2)
  assert.equal(t.name, "compact")
  assert.equal(t.boxed, false)
  assert.equal(t.textScale, 1)
  assert.ok(t.namePx <= comfy.titlePx - 4)
  assert.ok(t.detailPx < t.namePx)
  assert.ok(t.iconPx <= comfy.iconPx / 2)
  assert.ok(t.pad < comfy.pad && t.gap < comfy.gap)
  assert.ok(t.headerHeight < Card.MIN_TOUCH_PX)
  assert.ok(t.minColumnWidth < comfy.minColumnWidth)
  assert.equal(t.recapLines, 1)
})

test("icons are rasterised for the device pixel ratio", () => {
  assert.equal(tokens(360, 714, "pointer", 2).iconSourcePx, tokens(360, 714, "pointer", 2).iconPx * 2)
  assert.equal(tokens(360, 714, "pointer", 1).iconSourcePx, tokens(360, 714, "pointer", 1).iconPx)
  // Junk ratios count as 1; huge ones are capped.
  assert.equal(tokens(360, 714, "pointer", "x").iconSourcePx, tokens(360, 714, "pointer", 1).iconSourcePx)
  assert.ok(tokens(360, 714, "pointer", 50).iconSourcePx <= tokens(360, 714, "pointer", 1).iconPx * 4)
})

test("a compact pointer list fits 14 to 16 two-line rows in a 1080-tall Dock's Agent part", () => {
  // dock.toml: Agent List weight 2 over Usage weight 1, gap 8, 1080 tall.
  const height = Math.floor((1080 - 8) * 2 / 3)
  const t = tokens(360, height, "pointer", 2)
  const pitch = Density.rowHeight(t, true) + t.rowGap
  const rows = Math.floor((height - t.headerHeight - t.gap) / pitch)
  assert.ok(rows >= 14 && rows <= 16, "pitch " + pitch + ", rows " + rows)
  assert.ok(Density.rowHeight(t, false) < Density.rowHeight(t, true))
})

test("compact rows breathe: padding, a gap between the lines and a hairline between rows", () => {
  const t = tokens(360, 714, "pointer", 2)
  assert.ok(t.padY >= 4, "padY " + t.padY)
  assert.ok(t.lineGap > 0 && t.lineGap < t.padY)
  assert.equal(Density.rowHeight(t, true), t.padY * 2 + t.lineHeight + t.lineGap + t.secondLineHeight)
  assert.equal(Density.rowHeight(t, false), t.padY * 2 + t.lineHeight)
  assert.ok(t.rowGap >= 1 && t.dividerAlpha > 0 && t.dividerAlpha <= 0.15)
  assert.ok(t.pad >= 8 && t.gap >= 6)
  // Compact Usage lines are spaced like the list, a little looser than a name line.
  assert.ok(t.limitLineHeight > t.lineHeight + 3)
  const comfy = tokens(1024, 544, "touch", 1)
  assert.equal(comfy.lineGap, 0)
  assert.equal(comfy.dividerAlpha, 0)
})

test("touch rows stay touch targets even when compact", () => {
  const t = tokens(300, 544, "touch", 1)
  assert.equal(t.name, "compact")
  assert.equal(t.headerHeight, Card.MIN_TOUCH_PX)
  assert.ok(Density.rowHeight(t, false) >= Card.MIN_TOUCH_PX)
  assert.ok(Density.rowHeight(t, true) >= Card.MIN_TOUCH_PX)
  assert.ok(t.rowHeight >= Card.MIN_TOUCH_PX)
})

test("the second line of a compact row: the inline Recap, else workspace › tab when there is room", () => {
  const t = tokens(360, 714, "pointer", 2)
  const tall = 2000
  assert.equal(Density.secondLine(t, "compact", "inline", "Did a thing", 714), "recap")
  assert.equal(Density.secondLine(t, "compact", "inline", "", 714), "")
  assert.equal(Density.secondLine(t, "compact", "expand", "Did a thing", tall), "")
  assert.equal(Density.secondLine(t, "compact", "off", "", tall), "")
  assert.equal(Density.secondLine(t, "detailed", "off", "", tall), "location")
  // Not enough height for ROOM_ROWS two-line rows: one line only.
  const short = (Density.rowHeight(t, true) + t.rowGap) * Density.ROOM_ROWS - 1
  assert.equal(Density.secondLine(t, "detailed", "off", "", short), "")
  assert.equal(Density.secondLine(t, "detailed", "inline", "Did a thing", short), "recap")
})

test("comfortable Cards keep their own Fields, so no compact second line", () => {
  const t = tokens(1024, 544, "touch", 1)
  assert.equal(Density.secondLine(t, "detailed", "inline", "Did a thing", 544), "")
})

test("missing fonts and spacing fall back to Omarchy's defaults", () => {
  const t = Density.tokens({ width: 360, height: 714, input: "pointer" })
  assert.deepEqual(t, tokens(360, 714, "pointer", 1))
  assert.equal(Density.tokens(null).name, "comfortable")
})

test("the density setting: auto chooses, compact and full are the user's", () => {
  assert.deepEqual(Array.from(Density.SETTINGS), ["auto", "compact", "full"])
  assert.equal(Density.DEFAULT_SETTING, "auto")
  assert.equal(Density.densityFor(1024, 544, "touch", "auto", "agent-list"), "comfortable")
  assert.equal(Density.densityFor(360, 714, "pointer", "auto", "agent-list"), "compact")
  assert.equal(Density.densityFor(1024, 544, "touch", "compact", "agent-list"), "compact")
  assert.equal(Density.densityFor(360, 714, "pointer", "full", "agent-list"), "full")
  assert.equal(Density.densityFor(1024, 544, "touch", "full", "agent-list"), "full")
  // Modules without a full rendering draw comfortable.
  assert.equal(Density.densityFor(360, 714, "pointer", "full", "usage"), "comfortable")
  assert.equal(Density.densityFor(360, 714, "pointer", "full", "workspace-list"), "comfortable")
  // A setting outside the list is auto.
  assert.equal(Density.densityFor(360, 714, "pointer", "huge", "agent-list"), "compact")
  assert.equal(Density.normalizeSetting("huge"), "auto")
  assert.equal(Density.normalizeSetting("full"), "full")
})

function full(width, height, input) {
  return Density.tokens({ width, height, input, setting: "full", module: "agent-list", fonts: FONTS, spacing: SPACING, dpr: 2 })
}

test("full tokens: a big name, readable secondary lines, two Recap lines", () => {
  const t = full(360, 714, "pointer")
  const compact = tokens(360, 714, "pointer", 2)
  assert.equal(t.name, "full")
  assert.equal(t.boxed, false)
  assert.ok(t.namePx >= 17 && t.namePx <= 19, "namePx " + t.namePx)
  assert.ok(t.metaPx >= compact.detailPx && t.metaPx < t.namePx)
  assert.ok(t.recapPx >= compact.detailPx)
  assert.equal(t.recapLines, 2)
  assert.ok(t.cachePx >= t.namePx - 2)
  assert.ok(t.cacheBarWidth > 0 && t.cacheBarHeight >= 2)
  assert.ok(t.headerHeight < Card.MIN_TOUCH_PX)
  assert.equal(t.iconSourcePx, t.iconPx * 2)
  assert.equal(full(1024, 544, "touch").headerHeight, Card.MIN_TOUCH_PX)
})

test("a full Card list shows about 9 to 11 Agents in a 360x714 Dock Agent part", () => {
  const height = 714
  const t = full(360, height, "pointer")
  const room = height - t.headerHeight - t.gap
  const withRecap = Density.fullCardHeight(t, true) + t.rowGap
  const plain = Density.fullCardHeight(t, false) + t.rowGap
  assert.equal(Density.fullCardHeight(t, false), t.padY * 2 + t.lineHeight + t.lineGap + t.secondLineHeight)
  assert.equal(withRecap - plain, t.recapGap + t.recapLineHeight * 2)
  // Every Agent with a Recap: still more than 8.
  assert.ok(room / withRecap >= 8, "all recaps " + room / withRecap)
  // Three in four with a Recap, as on the user's Dock.
  const mixed = room / (withRecap * 0.75 + plain * 0.25)
  assert.ok(mixed >= 9 && mixed <= 11, "mixed " + mixed)
  assert.ok(Density.fullCardHeight(full(1024, 544, "touch"), false) >= Card.MIN_TOUCH_PX)
  assert.equal(Density.fullCardHeight(tokens(360, 714, "pointer", 2), true), Card.MIN_TOUCH_PX)
})

test("a full Card shows Recap lines for inline and expand when there is a Recap", () => {
  assert.equal(Density.fullRecapShown("inline", "Did a thing"), true)
  assert.equal(Density.fullRecapShown("expand", "Did a thing"), true)
  assert.equal(Density.fullRecapShown("off", "Did a thing"), false)
  assert.equal(Density.fullRecapShown("inline", ""), false)
  assert.equal(Density.fullRecapShown("expand", null), false)
})
