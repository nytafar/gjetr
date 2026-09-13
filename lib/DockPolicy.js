.pragma library

// A Dock: a Display docked along one edge of an output beside ordinary
// windows, reserving its strip on every workspace. Decides where it anchors,
// how much it reserves, the orientation its shape gives it, where its Deck
// tabs go, what a visibility action does, and which Dock an IPC call names.
// Pure.
//
// A Dock never rotates its output or touch: left and right Docks are portrait,
// top and bottom Docks landscape.

var KINDS = ["surface", "dock"]
var DEFAULT_KIND = "surface"
var EDGES = ["left", "right", "top", "bottom"]
// The edge of a Dock whose Config names none.
var DEFAULT_EDGE = "left"
// Logical pixels: the width of a left or right Dock, the height of a top or
// bottom one.
var DEFAULT_SIZE = 360
var MIN_SIZE = 120
var MAX_SIZE = 2000
// A Dock never takes more than this share of its output's width or height, so
// windows always keep room beside it.
var MAX_SHARE = 0.5
var ACTIONS = ["toggle", "show", "hide"]

function isEdge(edge) {
  return typeof edge === "string" && EDGES.indexOf(edge) >= 0
}

function isSide(edge) {
  return edge === "left" || edge === "right"
}

function orientationFor(edge) {
  if (!isEdge(edge)) return ""
  return isSide(edge) ? "portrait" : "landscape"
}

// The size the Dock takes on its output: the configured size, capped at
// MAX_SHARE of the output's length across the edge once that is known.
function sizeFor(edge, size, screenWidth, screenHeight) {
  var n = Number(size)
  var value = typeof size === "number" && isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_SIZE
  var length = Number(isSide(edge) ? screenWidth : screenHeight)
  if (isFinite(length) && length > 0) value = Math.min(value, Math.floor(length * MAX_SHARE))
  return value
}

// Layer-shell placement: anchored to its edge and both neighbouring edges, so
// it spans the output along the edge. `width` and `height` are the implicit
// size (0 along the spanned axis); the compositor reserves `size` as the
// exclusive zone.
// -> { anchors: { top, bottom, left, right }, width, height, size }
function geometry(edge, size, screenWidth, screenHeight) {
  if (!isEdge(edge)) return { anchors: { top: false, bottom: false, left: false, right: false }, width: 0, height: 0, size: 0 }
  var s = sizeFor(edge, size, screenWidth, screenHeight)
  var side = isSide(edge)
  return {
    anchors: { top: edge !== "bottom", bottom: edge !== "top", left: edge !== "right", right: edge !== "left" },
    width: side ? s : 0,
    height: side ? 0 : s,
    size: s
  }
}

// Deck tabs go on a short edge, as on any Display: the top of a portrait Dock,
// the left of a landscape one. The Omarchy bar never sits inside a Dock.
function tabEdge(edge) {
  return orientationFor(edge) === "portrait" ? "top" : "left"
}

// "toggle", "show" or "hide" applied to the current visibility. An unknown
// action changes nothing.
function nextVisible(action, current) {
  var visible = current === true
  if (action === "toggle") return !visible
  if (action === "show") return true
  if (action === "hide") return false
  return visible
}

// The Dock an IPC call names: the Display on `output` when it is a Dock, or
// the first Dock when no output is given.
// -> { name, error }
function dockTarget(displays, output) {
  var list = Array.isArray(displays) ? displays : []
  var wanted = output === undefined || output === null ? "" : String(output).trim()
  for (var i = 0; i < list.length; i++) {
    var display = list[i]
    if (!display) continue
    if (wanted === "") {
      if (display.kind === "dock") return { name: String(display.name), error: "" }
      continue
    }
    if (display.name !== wanted) continue
    return display.kind === "dock" ? { name: wanted, error: "" } : { name: "", error: wanted + " is not a dock" }
  }
  return { name: "", error: wanted === "" ? "no dock" : "no dock " + wanted }
}

if (typeof module !== "undefined") {
  module.exports = {
    KINDS: KINDS,
    DEFAULT_KIND: DEFAULT_KIND,
    EDGES: EDGES,
    DEFAULT_EDGE: DEFAULT_EDGE,
    DEFAULT_SIZE: DEFAULT_SIZE,
    MIN_SIZE: MIN_SIZE,
    MAX_SIZE: MAX_SIZE,
    MAX_SHARE: MAX_SHARE,
    ACTIONS: ACTIONS,
    isEdge: isEdge,
    orientationFor: orientationFor,
    sizeFor: sizeFor,
    geometry: geometry,
    tabEdge: tabEdge,
    nextVisible: nextVisible,
    dockTarget: dockTarget
  }
}
