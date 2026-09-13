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
