"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")
const loadLib = require("./support/loadLib.cjs")

const Deck = loadLib("lib/DeckPolicy.js")

function names(read) {
  return { names: Array.from(read.names), skipped: Array.from(read.skipped), fallback: read.fallback }
}

const layouts = [
  { name: "agents", orientation: "portrait" },
  { name: "wide", orientation: "landscape" },
  { name: "both", orientation: "any" }
]

test("orientationOf compares the sides and tolerates a surface before configure", () => {
  assert.equal(Deck.orientationOf(1024, 600), "landscape")
  assert.equal(Deck.orientationOf(600, 1024), "portrait")
  assert.equal(Deck.orientationOf(0, 0), "")
})

test("a rotatable Display offers every Layout", () => {
  assert.deepEqual(names(Deck.availableLayouts(layouts, true, "landscape")),
    { names: ["agents", "wide", "both"], skipped: [], fallback: false })
})

test("a fixed Display skips Layouts built for the other orientation", () => {
  assert.deepEqual(names(Deck.availableLayouts(layouts, false, "landscape")),
    { names: ["wide", "both"], skipped: ["agents"], fallback: false })
  assert.deepEqual(names(Deck.availableLayouts(layouts, false, "portrait")),
    { names: ["agents", "both"], skipped: ["wide"], fallback: false })
})

test("a fixed Display that would skip every Layout keeps them all", () => {
  assert.deepEqual(names(Deck.availableLayouts([layouts[0]], false, "landscape")),
    { names: ["agents"], skipped: [], fallback: true })
})

test("an unknown orientation (no surface yet) skips nothing", () => {
  assert.deepEqual(Array.from(Deck.availableLayouts(layouts, false, "").names), ["agents", "wide", "both"])
})

test("activeName takes the Override only while it is available", () => {
  assert.equal(Deck.activeName(["a", "b"], "b"), "b")
  assert.equal(Deck.activeName(["a", "b"], "gone"), "a")
  assert.equal(Deck.activeName([], "a"), "")
})

const monitors = JSON.stringify([
  { name: "DP-1", width: 3840, height: 2160, x: 0, y: 0, scale: 2, transform: 0 },
  { name: "HDMI-A-2", width: 1024, height: 600, x: 1920, y: 0, scale: 1, transform: 0 }
])

test("parseMonitor reads the named output", () => {
  assert.deepEqual({ ...Deck.parseMonitor(monitors, "HDMI-A-2") },
    { name: "HDMI-A-2", transform: 0, x: 1920, y: 0, scale: 1, width: 1024, height: 600 })
  assert.equal(Deck.parseMonitor(monitors, "HDMI-A-1"), null)
  assert.equal(Deck.parseMonitor("nope", "HDMI-A-2"), null)
  assert.equal(Deck.parseMonitor('[{"name":"HDMI-A-2","transform":"1"}]', "HDMI-A-2"), null)
})

test("transformFor turns a landscape panel a quarter for portrait and back", () => {
  const panel = { width: 1024, height: 600 }
  assert.equal(Deck.transformFor("portrait", { ...panel, transform: 0 }), 1)
  assert.equal(Deck.transformFor("landscape", { ...panel, transform: 1 }), 0)
  assert.equal(Deck.transformFor("portrait", { ...panel, transform: 2 }), 3)
  assert.equal(Deck.transformFor("landscape", { ...panel, transform: 3 }), 2)
  assert.equal(Deck.transformFor("portrait", { ...panel, transform: 4 }), 5)
})

test("transformFor leaves a matching or free output alone", () => {
  const panel = { width: 1024, height: 600 }
  assert.equal(Deck.transformFor("landscape", { ...panel, transform: 0 }), -1)
  assert.equal(Deck.transformFor("portrait", { ...panel, transform: 3 }), -1)
  assert.equal(Deck.transformFor("any", { ...panel, transform: 0 }), -1)
  assert.equal(Deck.transformFor("portrait", null), -1)
  assert.equal(Deck.transformFor("portrait", { ...panel, transform: 9 }), -1)
})

test("transformFor respects a natively portrait panel", () => {
  const tall = { width: 480, height: 1920 }
  assert.equal(Deck.transformFor("portrait", { ...tall, transform: 0 }), -1)
  assert.equal(Deck.transformFor("landscape", { ...tall, transform: 0 }), 1)
})

test("tabs sit on the short edge opposite the bar", () => {
  assert.equal(Deck.tabEdge("right", false, 1024, 600), "left")
  assert.equal(Deck.tabEdge("left", false, 1024, 600), "right")
  assert.equal(Deck.tabEdge("top", false, 600, 1024), "bottom")
  assert.equal(Deck.tabEdge("bottom", false, 600, 1024), "top")
})

test("tabs fall back to left (landscape) or top (portrait) when the bar is on a long edge or hidden", () => {
  assert.equal(Deck.tabEdge("top", false, 1024, 600), "left")
  assert.equal(Deck.tabEdge("right", false, 600, 1024), "top")
  assert.equal(Deck.tabEdge("right", true, 1024, 600), "left")
})

test("the tab bar shows only with more than one Layout and insets content", () => {
  assert.equal(Deck.tabsVisible(["a"]), false)
  assert.equal(Deck.tabsVisible(["a", "b"]), true)
  const inset = { top: 0, right: 28, bottom: 0, left: 0 }
  assert.deepEqual({ ...Deck.withTabs(inset, "left", 56, true) }, { top: 0, right: 28, bottom: 0, left: 56 })
  assert.deepEqual({ ...Deck.withTabs(inset, "left", 56, false) }, { top: 0, right: 28, bottom: 0, left: 0 })
})

test("a horizontal swipe moves one Layout and stops at the ends", () => {
  assert.equal(Deck.swipeTarget(0, 3, -120, 10, 60), 1)
  assert.equal(Deck.swipeTarget(1, 3, 120, -10, 60), 0)
  assert.equal(Deck.swipeTarget(2, 3, -120, 0, 60), 2)
  assert.equal(Deck.swipeTarget(0, 3, 120, 0, 60), 0)
})

test("short, vertical or single-Layout gestures do nothing", () => {
  assert.equal(Deck.swipeTarget(0, 3, -40, 0, 60), 0)
  assert.equal(Deck.swipeTarget(0, 3, -100, 90, 60), 0)
  assert.equal(Deck.swipeTarget(0, 1, -300, 0, 60), 0)
  assert.equal(Deck.swipeTarget(0, 3, NaN, 0, 60), 0)
})

test("badges count Attention on hidden tabs that list Agents", () => {
  const byName = {
    agents: { modules: [{ type: "agent-list" }] },
    wide: { modules: [{ type: "agent-list" }] },
    empty: { modules: [] }
  }
  assert.deepEqual(Array.from(Deck.badges(["agents", "wide", "empty"], byName, "agents", 2)), [0, 2, 0])
  assert.deepEqual(Array.from(Deck.badges(["agents", "wide"], byName, "wide", 0)), [0, 0])
})

test("tabRect places the tab bar on its edge inside the bar inset", () => {
  const inset = { top: 0, right: 28, bottom: 0, left: 0 }
  assert.deepEqual({ ...Deck.tabRect(1024, 600, inset, "left", 56) }, { x: 0, y: 0, width: 56, height: 600 })
  assert.deepEqual({ ...Deck.tabRect(1024, 600, { top: 0, right: 0, bottom: 0, left: 28 }, "right", 56) },
    { x: 968, y: 0, width: 56, height: 600 })
  assert.deepEqual({ ...Deck.tabRect(600, 1024, inset, "top", 56) }, { x: 0, y: 0, width: 572, height: 56 })
  assert.deepEqual({ ...Deck.tabRect(600, 1024, inset, "bottom", 56) }, { x: 0, y: 968, width: 572, height: 56 })
})
