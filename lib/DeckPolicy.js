.pragma library

// The Deck on a Display: which Layouts it offers, which one is active, the
// orientation that asks for, where the tab bar goes, what a swipe does, and
// which tabs carry an Attention badge. Pure.
//
// Orientation. A Layout declares `portrait`, `landscape` or `any`. On a
// rotatable Display, selecting a Layout rotates the output to match; on any
// other Display, Layouts that do not fit the current orientation are skipped.
// If that would skip every Layout, all of them stay, so a Display never goes
// blank over a Config mismatch.

function str(value) {
  return value === undefined || value === null ? "" : String(value)
}

function isInteger(value) {
  return typeof value === "number" && isFinite(value) && Math.floor(value) === value
}

function orientationOf(width, height) {
  var w = Number(width)
  var h = Number(height)
  if (!isFinite(w) || !isFinite(h) || w <= 0 || h <= 0) return ""
  return w > h ? "landscape" : "portrait"
}

function fits(layoutOrientation, orientation) {
  return layoutOrientation === "any" || orientation === "" || layoutOrientation === orientation
}

// layouts: [{ name, orientation }] in Deck order.
// -> { names: [...], skipped: [...], fallback: bool }
function availableLayouts(layouts, rotatable, orientation) {
  var list = Array.isArray(layouts) ? layouts : []
  var names = []
  var skipped = []
  for (var i = 0; i < list.length; i++) {
    if (!list[i] || str(list[i].name) === "") continue
    if (rotatable === true || fits(list[i].orientation, orientation)) names.push(list[i].name)
    else skipped.push(list[i].name)
  }
  if (names.length === 0 && skipped.length > 0) return { names: skipped, skipped: [], fallback: true }
  return { names: names, skipped: skipped, fallback: false }
}

// The active Layout: the Override when it is still available, else the first.
function activeName(names, overrideName) {
  var list = Array.isArray(names) ? names : []
  if (list.length === 0) return ""
  return list.indexOf(overrideName) >= 0 ? overrideName : list[0]
}

// ------------------------------------------------------------------ rotation

// `hyprctl -j monitors` -> the output's current transform, position, scale and
// mode size (which does not change with the transform), or null.
function parseMonitor(text, output) {
  var list
  try {
    list = JSON.parse(str(text))
  } catch (error) {
    return null
  }
  if (!Array.isArray(list)) return null
  for (var i = 0; i < list.length; i++) {
    var m = list[i]
    if (!m || m.name !== output) continue
    if (!isInteger(m.transform) || !isInteger(m.x) || !isInteger(m.y) || !isInteger(m.width) || !isInteger(m.height)
      || typeof m.scale !== "number" || !isFinite(m.scale)) return null
    return { name: m.name, transform: m.transform, x: m.x, y: m.y, scale: m.scale, width: m.width, height: m.height }
  }
  return null
}

// The transform that shows `orientation` on an output currently at
// `transform`, or -1 when no change is needed. Rotating by a quarter turn
// flips the lowest bit (0 <-> 1, 2 <-> 3, and the flipped 4 <-> 5, 6 <-> 7), so
// a flipped or upside-down mounting keeps its sense.
function transformFor(orientation, monitor) {
  if (!monitor || (orientation !== "portrait" && orientation !== "landscape")) return -1
  var t = monitor.transform
  if (!isInteger(t) || t < 0 || t > 7) return -1
  var nativeLandscape = monitor.width >= monitor.height
  var quarter = (t & 1) === 1
  var current = nativeLandscape !== quarter ? "landscape" : "portrait"
  return current === orientation ? -1 : (t ^ 1)
}

// ------------------------------------------------------------------ tabs

// Tabs go on a short edge, the one opposite the bar when the bar sits on a
// short edge. Otherwise landscape uses the left edge and portrait the top.
function tabEdge(barPosition, barHidden, width, height) {
  var orientation = orientationOf(width, height)
  var shortEdges = orientation === "portrait" ? ["top", "bottom"] : ["left", "right"]
  var opposite = { top: "bottom", bottom: "top", left: "right", right: "left" }
  var bar = barHidden ? "" : str(barPosition)
  if (shortEdges.indexOf(bar) >= 0) return opposite[bar]
  return shortEdges[0]
}

function tabsVisible(names) {
  return Array.isArray(names) && names.length > 1
}

// Inset for content once the tab bar takes `thickness` on `edge`.
function withTabs(inset, edge, thickness, visible) {
  var out = { top: 0, right: 0, bottom: 0, left: 0 }
  var base = inset || out
  for (var key in out) out[key] = Number(base[key]) || 0
  if (visible && out.hasOwnProperty(edge)) out[edge] += Math.max(0, Number(thickness) || 0)
  return out
}

// Where the tab bar sits: along `edge`, inside the bar inset.
function tabRect(width, height, inset, edge, thickness) {
  var w = Math.max(0, Number(width) || 0)
  var h = Math.max(0, Number(height) || 0)
  var e = inset || { top: 0, right: 0, bottom: 0, left: 0 }
  var t = Math.max(0, Number(thickness) || 0)
  var inner = { x: e.left, y: e.top, width: Math.max(0, w - e.left - e.right), height: Math.max(0, h - e.top - e.bottom) }
  if (edge === "left") return { x: inner.x, y: inner.y, width: t, height: inner.height }
  if (edge === "right") return { x: inner.x + inner.width - t, y: inner.y, width: t, height: inner.height }
  if (edge === "bottom") return { x: inner.x, y: inner.y + inner.height - t, width: inner.width, height: t }
  return { x: inner.x, y: inner.y, width: inner.width, height: t }
}

// A horizontal swipe moves one Layout: towards the left shows the next one.
// Returns the new index, or `index` when the gesture is too short, mostly
// vertical (a list scroll) or at either end of the Deck.
function swipeTarget(index, count, dx, dy, threshold) {
  var n = Number(count)
  var i = Number(index)
  var x = Number(dx)
  var y = Number(dy)
  if (!isInteger(n) || n < 2 || !isInteger(i) || !isFinite(x) || !isFinite(y)) return i
  if (Math.abs(x) < Number(threshold) || Math.abs(x) < Math.abs(y) * 1.5) return i
  var next = x < 0 ? i + 1 : i - 1
  return next < 0 || next >= n ? i : next
}

// Badge counts per tab: Attention Agents on every Layout that is not shown and
// contains an Agent List or a Workspace List (each reaches every Agent).
function badges(names, layoutsByName, active, attentionCount) {
  var list = Array.isArray(names) ? names : []
  var out = []
  for (var i = 0; i < list.length; i++) {
    var layout = layoutsByName ? layoutsByName[list[i]] : null
    var modules = layout && Array.isArray(layout.modules) ? layout.modules : []
    var hasList = false
    for (var j = 0; j < modules.length; j++) {
      if (modules[j] && (modules[j].type === "agent-list" || modules[j].type === "workspace-list")) hasList = true
    }
    out.push(list[i] !== active && hasList ? Math.max(0, Number(attentionCount) || 0) : 0)
  }
  return out
}

if (typeof module !== "undefined") {
  module.exports = {
    orientationOf: orientationOf,
    fits: fits,
    availableLayouts: availableLayouts,
    activeName: activeName,
    parseMonitor: parseMonitor,
    transformFor: transformFor,
    tabEdge: tabEdge,
    tabsVisible: tabsVisible,
    withTabs: withTabs,
    tabRect: tabRect,
    swipeTarget: swipeTarget,
    badges: badges
  }
}
