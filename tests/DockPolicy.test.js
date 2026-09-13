"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")
const loadLib = require("./support/loadLib.cjs")

const Dock = loadLib("lib/DockPolicy.js")

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

test("a dock's orientation comes from its edge", () => {
  assert.equal(Dock.orientationFor("left"), "portrait")
  assert.equal(Dock.orientationFor("right"), "portrait")
  assert.equal(Dock.orientationFor("top"), "landscape")
  assert.equal(Dock.orientationFor("bottom"), "landscape")
  assert.equal(Dock.orientationFor("middle"), "")
  assert.equal(Dock.orientationFor(undefined), "")
})

test("isEdge accepts only the four edges", () => {
  assert.equal(Dock.DEFAULT_EDGE, "left")
  for (const edge of ["left", "right", "top", "bottom"]) assert.equal(Dock.isEdge(edge), true, edge)
  for (const edge of ["", "Left", "center", null, 3]) assert.equal(Dock.isEdge(edge), false, String(edge))
})

test("a side dock anchors to its edge and spans the height", () => {
  assert.deepEqual(plain(Dock.geometry("right", 360, 1920, 1080)),
    { anchors: { top: true, bottom: true, left: false, right: true }, width: 360, height: 0, size: 360 })
  assert.deepEqual(plain(Dock.geometry("left", 300, 1920, 1080)),
    { anchors: { top: true, bottom: true, left: true, right: false }, width: 300, height: 0, size: 300 })
})

test("a top or bottom dock anchors to its edge and spans the width", () => {
  assert.deepEqual(plain(Dock.geometry("top", 200, 1920, 1080)),
    { anchors: { top: true, bottom: false, left: true, right: true }, width: 0, height: 200, size: 200 })
  assert.deepEqual(plain(Dock.geometry("bottom", 200, 1920, 1080)),
    { anchors: { top: false, bottom: true, left: true, right: true }, width: 0, height: 200, size: 200 })
})

test("a dock never takes more than half its output", () => {
  assert.equal(Dock.sizeFor("right", 1500, 1920, 1080), 960)
  assert.equal(Dock.sizeFor("bottom", 900, 1920, 1080), 540)
  assert.equal(Dock.sizeFor("right", 360, 1920, 1080), 360)
})

test("a dock keeps its size before the output is known, and junk sizes use the default", () => {
  assert.equal(Dock.sizeFor("right", 360, 0, 0), 360)
  assert.equal(Dock.sizeFor("right", "wide", 1920, 1080), Dock.DEFAULT_SIZE)
  assert.equal(Dock.sizeFor("right", -5, 1920, 1080), Dock.DEFAULT_SIZE)
  assert.equal(Dock.sizeFor("right", 360.7, 1920, 1080), 360)
})

test("an unknown edge has no geometry", () => {
  assert.deepEqual(plain(Dock.geometry("middle", 360, 1920, 1080)),
    { anchors: { top: false, bottom: false, left: false, right: false }, width: 0, height: 0, size: 0 })
})

test("Deck tabs sit on a dock's short edge", () => {
  assert.equal(Dock.tabEdge("right"), "top")
  assert.equal(Dock.tabEdge("left"), "top")
  assert.equal(Dock.tabEdge("top"), "left")
  assert.equal(Dock.tabEdge("bottom"), "left")
})

test("visibility actions toggle, show or hide", () => {
  assert.equal(Dock.nextVisible("toggle", true), false)
  assert.equal(Dock.nextVisible("toggle", false), true)
  assert.equal(Dock.nextVisible("show", false), true)
  assert.equal(Dock.nextVisible("show", true), true)
  assert.equal(Dock.nextVisible("hide", true), false)
  assert.equal(Dock.nextVisible("flip", true), true)
})

const DISPLAYS = [
  { name: "HDMI-A-2", kind: "surface" },
  { name: "DP-1", kind: "dock" },
  { name: "DP-2", kind: "dock" }
]

test("dockTarget names a dock by output, or the first dock without one", () => {
  assert.deepEqual(plain(Dock.dockTarget(DISPLAYS, "DP-2")), { name: "DP-2", error: "" })
  assert.deepEqual(plain(Dock.dockTarget(DISPLAYS, "")), { name: "DP-1", error: "" })
  assert.deepEqual(plain(Dock.dockTarget(DISPLAYS, undefined)), { name: "DP-1", error: "" })
})

test("dockTarget refuses a surface, an unknown output and a Config without docks", () => {
  assert.deepEqual(plain(Dock.dockTarget(DISPLAYS, "HDMI-A-2")), { name: "", error: "HDMI-A-2 is not a dock" })
  assert.deepEqual(plain(Dock.dockTarget(DISPLAYS, "DP-9")), { name: "", error: "no dock DP-9" })
  assert.deepEqual(plain(Dock.dockTarget([DISPLAYS[0]], "")), { name: "", error: "no dock" })
  assert.deepEqual(plain(Dock.dockTarget(null, "")), { name: "", error: "no dock" })
})
