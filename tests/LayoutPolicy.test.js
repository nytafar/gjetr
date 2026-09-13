"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")
const loadLib = require("./support/loadLib.cjs")

const Layout = loadLib("lib/LayoutPolicy.js")

const screens = [
  { name: "DP-1", width: 1920, height: 1080 },
  { name: "HDMI-A-2", width: 1024, height: 600 }
]

test("displayScreens picks the screen named by the Display", () => {
  const picked = Layout.displayScreens(screens, "HDMI-A-2")
  assert.equal(picked.length, 1)
  assert.equal(picked[0], screens[1])
})

test("displayScreens is empty while the Display is unplugged", () => {
  assert.deepEqual(Array.from(Layout.displayScreens(screens, "HDMI-A-1")), [])
})

test("displayScreens is empty for a blank Display name", () => {
  assert.deepEqual(Array.from(Layout.displayScreens(screens, "")), [])
  assert.deepEqual(Array.from(Layout.displayScreens(screens, "  ")), [])
})

test("displayScreens trims the name and ignores duplicates and junk", () => {
  const list = [null, { name: "HDMI-A-2" }, { name: "HDMI-A-2" }, {}]
  const picked = Layout.displayScreens(list, " HDMI-A-2 ")
  assert.equal(picked.length, 1)
  assert.equal(picked[0], list[1])
})

test("displayScreens tolerates a missing screen list", () => {
  assert.deepEqual(Array.from(Layout.displayScreens(undefined, "HDMI-A-2")), [])
})

test("barInset reserves the bar edge only", () => {
  assert.deepEqual({ ...Layout.barInset("right", 28, false) }, { top: 0, right: 28, bottom: 0, left: 0 })
  assert.deepEqual({ ...Layout.barInset("top", 26, false) }, { top: 26, right: 0, bottom: 0, left: 0 })
  assert.deepEqual({ ...Layout.barInset("bottom", 26, false) }, { top: 0, right: 0, bottom: 26, left: 0 })
  assert.deepEqual({ ...Layout.barInset("left", 28, false) }, { top: 0, right: 0, bottom: 0, left: 28 })
})

test("barInset is zero while the bar is hidden", () => {
  assert.deepEqual({ ...Layout.barInset("right", 28, true) }, { top: 0, right: 0, bottom: 0, left: 0 })
})

test("barInset treats an unknown position as top, like the bar does", () => {
  assert.deepEqual({ ...Layout.barInset("sideways", 26, false) }, { top: 26, right: 0, bottom: 0, left: 0 })
  assert.deepEqual({ ...Layout.barInset(undefined, 26, false) }, { top: 26, right: 0, bottom: 0, left: 0 })
})

test("barInset clamps nonsense sizes to zero and rounds", () => {
  assert.equal(Layout.barInset("right", -4, false).right, 0)
  assert.equal(Layout.barInset("right", NaN, false).right, 0)
  assert.equal(Layout.barInset("right", "x", false).right, 0)
  assert.equal(Layout.barInset("right", 27.6, false).right, 28)
})

test("contentRect removes the inset from the surface", () => {
  const rect = Layout.contentRect(1024, 600, Layout.barInset("right", 28, false))
  assert.deepEqual({ ...rect }, { x: 0, y: 0, width: 996, height: 600 })
})

test("contentRect never goes negative on a transient zero-size surface", () => {
  const rect = Layout.contentRect(0, 0, Layout.barInset("left", 28, false))
  assert.deepEqual({ ...rect }, { x: 28, y: 0, width: 0, height: 0 })
})

test("columnsFor fits as many columns as keep the minimum width", () => {
  assert.equal(Layout.columnsFor(572, 440, 3), 1)
  assert.equal(Layout.columnsFor(996, 440, 3), 2)
  assert.equal(Layout.columnsFor(1400, 440, 3), 3)
  assert.equal(Layout.columnsFor(4000, 440, 3), 3)
})

test("columnsFor is at least one, even for a surface before its first configure", () => {
  assert.equal(Layout.columnsFor(0, 440, 3), 1)
  assert.equal(Layout.columnsFor(NaN, 440, 3), 1)
  assert.equal(Layout.columnsFor(900, 0, 3), 1)
  assert.equal(Layout.columnsFor(900, 440, 0), 1)
})

test("cardPlacement stacks one column, an open Card pushing the rest down", () => {
  const placed = Layout.cardPlacement(["a", "b", "c"], { b: 300 }, 1, 88, 10)
  assert.deepEqual({ ...placed.positions.a }, { column: 0, y: 0 })
  assert.deepEqual({ ...placed.positions.b }, { column: 0, y: 98 })
  assert.deepEqual({ ...placed.positions.c }, { column: 0, y: 408 })
  assert.equal(placed.contentHeight, 506)
})

test("cardPlacement rows take their tallest Card", () => {
  const placed = Layout.cardPlacement(["a", "b", "c", "d", "e"], { b: 200, c: 60 }, 2, 88, 10)
  assert.deepEqual(["a", "b", "c", "d", "e"].map(k => [placed.positions[k].column, placed.positions[k].y]),
    [[0, 0], [1, 0], [0, 210], [1, 210], [0, 308]])
  assert.equal(placed.contentHeight, 406)
})

test("cardPlacement falls back to the base height for unknown or junk heights", () => {
  const placed = Layout.cardPlacement(["a", "b"], { a: NaN, b: -5 }, 0, 64, 8)
  assert.equal(placed.positions.b.y, 72)
  assert.equal(placed.contentHeight, 144)
  assert.equal(Layout.cardPlacement([], {}, 1, 64, 8).contentHeight, 0)
  assert.equal(Layout.cardPlacement(null, null, 1, 64, 8).contentHeight, 0)
})

test("clampScroll keeps the scroll position unless the content got too short", () => {
  assert.equal(Layout.clampScroll(300, 2000, 600), 300)
  assert.equal(Layout.clampScroll(1800, 2000, 600), 1400)
  assert.equal(Layout.clampScroll(300, 400, 600), 0)
  assert.equal(Layout.clampScroll(-20, 2000, 600), 0)
  assert.equal(Layout.clampScroll(NaN, 2000, 600), 0)
})

test("keepScroll holds the Card at the top of the view when a Card above it changes height", () => {
  const keys = ["a", "b", "c", "d"]
  const before = Layout.cardPlacement(keys, {}, 1, 100, 0)
  // b (above the view top at 250, inside c) grows by 200: c must stay where it was on screen.
  assert.equal(Layout.keepScroll(before, Layout.cardPlacement(keys, { b: 300 }, 1, 100, 0), keys, 250), 450)
  // c itself, straddling the top, grows: it grows downward, nothing moves.
  assert.equal(Layout.keepScroll(before, Layout.cardPlacement(keys, { c: 300 }, 1, 100, 0), keys, 250), 250)
  // d, below the top, grows: nothing moves.
  assert.equal(Layout.keepScroll(before, Layout.cardPlacement(keys, { d: 300 }, 1, 100, 0), keys, 250), 250)
  // At the very top the view stays at the top.
  assert.equal(Layout.keepScroll(before, Layout.cardPlacement(keys, { a: 300 }, 1, 100, 0), keys, 0), 0)
  assert.equal(Layout.keepScroll(null, null, keys, 120), 120)
})

test("moduleRects puts Modules side by side in equal columns on a landscape area", () => {
  const rects = Layout.moduleRects(940, 600, [1, 1], 9)
  assert.deepEqual(rects.map(r => ({ ...r })), [
    { x: 0, y: 0, width: 465, height: 600 },
    { x: 474, y: 0, width: 466, height: 600 }
  ])
})

test("moduleRects stacks Modules on a portrait area", () => {
  const rects = Layout.moduleRects(572, 968, [1, 1, 1], 8)
  assert.deepEqual(rects.map(r => [r.y, r.height, r.width]), [[0, 317, 572], [325, 317, 572], [650, 318, 572]])
})

test("moduleRects shares the length by weight, the last Module taking the rounding", () => {
  const rects = Layout.moduleRects(1000, 500, [2, 1], 10)
  assert.deepEqual(rects.map(r => [r.x, r.width]), [[0, 660], [670, 330]])
  assert.equal(rects[1].x + rects[1].width, 1000)
})

test("moduleRects treats junk weights as 1 and never goes negative", () => {
  assert.deepEqual(Layout.moduleRects(300, 100, [0, NaN, "x"], 0).map(r => r.width), [100, 100, 100])
  assert.deepEqual(Layout.moduleRects(0, 0, [1, 1], 8).map(r => ({ ...r })),
    [{ x: 0, y: 0, width: 0, height: 0 }, { x: 0, y: 0, width: 0, height: 0 }])
  assert.deepEqual(Layout.moduleRects(500, 300, [], 8), [])
  assert.deepEqual(Layout.moduleRects(500, 300, [1], 8).map(r => ({ ...r })), [{ x: 0, y: 0, width: 500, height: 300 }])
})

test("moduleRects gives a pinned stacked Module its content height, flush at the bottom", () => {
  // An Agent List over a pinned Usage 180 px tall: the list takes the rest, whatever the weights.
  const rects = Layout.moduleRects(360, 1000, [2, 1], 8, [null, 180])
  assert.deepEqual(rects.map(r => ({ ...r })), [
    { x: 0, y: 0, width: 360, height: 812 },
    { x: 0, y: 820, width: 360, height: 180 }
  ])
})

test("moduleRects moves pinned Modules after the others, in their own order", () => {
  const rects = Layout.moduleRects(360, 1000, [1, 1, 1], 10, [100, null, 50])
  assert.deepEqual(rects.map(r => [r.y, r.height]), [[840, 100], [0, 830], [950, 50]])
  assert.equal(rects[2].y + rects[2].height, 1000)
})

test("moduleRects shares the rest by weight among the Modules that are not pinned", () => {
  const rects = Layout.moduleRects(300, 1000, [2, 1, 5], 10, [null, null, 170])
  assert.deepEqual(rects.map(r => [r.y, r.height]), [[0, 540], [550, 270], [830, 170]])
})

test("moduleRects caps pinned Modules at half the length together", () => {
  assert.deepEqual(Layout.moduleRects(300, 1000, [1, 1], 0, [null, 900]).map(r => [r.y, r.height]), [[0, 500], [500, 500]])
  // Two pinned Modules asking 400 and 200 of a 500 px budget shrink in proportion.
  assert.deepEqual(Layout.moduleRects(300, 1000, [1, 1, 1], 0, [null, 400, 200]).map(r => [r.y, r.height]),
    [[0, 501], [501, 333], [834, 166]])
})

test("moduleRects keeps the weight share of a pinned Module not measured yet, at the end", () => {
  for (const unknown of [0, -5, NaN, undefined, "180", true]) {
    const rects = Layout.moduleRects(300, 1000, [1, 1], 8, [unknown === undefined ? 0 : unknown, null])
    assert.deepEqual(rects.map(r => [r.y, r.height]), [[504, 496], [0, 496]], String(unknown))
  }
})

test("moduleRects puts a pinned Module at the right edge side by side, sized by weight", () => {
  const rects = Layout.moduleRects(1000, 500, [1, 2], 10, [120, null])
  assert.deepEqual(rects.map(r => [r.x, r.width, r.height]), [[670, 330, 500], [0, 660, 500]])
})

test("moduleRects splits by weight in order when every Module is pinned, or none is", () => {
  assert.deepEqual(Layout.moduleRects(300, 1000, [1, 1], 0, [100, 100]).map(r => [r.y, r.height]), [[0, 500], [500, 500]])
  assert.deepEqual(Layout.moduleRects(300, 1000, [1, 1], 0, [null, null]).map(r => [r.y, r.height]), [[0, 500], [500, 500]])
  assert.deepEqual(Layout.moduleRects(300, 1000, [1, 1], 0, "junk").map(r => [r.y, r.height]), [[0, 500], [500, 500]])
})

test("moduleRects never goes negative with a pinned Module in too little room", () => {
  for (const rect of Layout.moduleRects(300, 12, [1, 1, 1], 8, [null, 40, null])) {
    assert.ok(rect.y >= 0 && rect.height >= 0 && rect.y + rect.height <= 12, JSON.stringify(rect))
  }
})

test("moduleDividers draws a hairline in each gap between placed neighbours", () => {
  const stacked = Layout.moduleRects(360, 1000, [1, 1], 8, [180, null])
  assert.deepEqual(Layout.moduleDividers(360, 1000, stacked, 8).map(d => ({ ...d })),
    [{ x: 0, y: 812 + 4, width: 360, height: 1 }])
  const row = Layout.moduleRects(940, 600, [1, 1, 1], 9)
  assert.deepEqual(Layout.moduleDividers(940, 600, row, 9).map(d => [d.x, d.y, d.width, d.height]),
    [[row[1].x - 5, 0, 1, 600], [row[2].x - 5, 0, 1, 600]])
  assert.deepEqual(Layout.moduleDividers(360, 1000, [], 8), [])
  assert.deepEqual(Layout.moduleDividers(360, 1000, null, 8), [])
})

test("keepRowScroll holds the row at the top of the view when rows change above or below it", () => {
  const before = ["a", "b", "c", "d", "e"]
  // View top at 130 with 60 px rows: row c (index 2) is at the top, 10 px scrolled into it.
  assert.equal(Layout.keepRowScroll(before, ["a", "x", "y", "b", "c", "d", "e"], 60, 130), 250)
  // Rows inserted below the top row (an expanded row) move nothing.
  assert.equal(Layout.keepRowScroll(before, ["a", "b", "c", "c1", "c2", "d", "e"], 60, 130), 130)
  // Rows removed above it pull the view up with it.
  assert.equal(Layout.keepRowScroll(before, ["c", "d", "e"], 60, 130), 10)
  // The top row itself gone: the nearest surviving row above it keeps its place.
  assert.equal(Layout.keepRowScroll(before, ["x", "a", "b", "d", "e"], 60, 130), 190)
  // Nothing survives, junk, or at the very top: unchanged.
  assert.equal(Layout.keepRowScroll(before, ["z"], 60, 130), 130)
  assert.equal(Layout.keepRowScroll(before, ["x", "a"], 60, 0), 0)
  assert.equal(Layout.keepRowScroll(null, null, 0, 40), 40)
})
