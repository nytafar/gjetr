.pragma library

// Where the dashboard goes on a Display and how much of it is usable.
//
// Screen selection follows the shape of lacuna-shell's ScreenModel.js
// (github.com/OldJobobo/lacuna-shell, MIT, Copyright (c) 2026 Lacuna Omarchy
// Plugins contributors), narrowed to pinning by output name.

function screenName(screen) {
  if (!screen || screen.name === undefined || screen.name === null) return ""
  return String(screen.name)
}

// Screens that show the Display. Empty while the output is unplugged, which is
// what lets a Variants over this list tear the surface down and bring it back.
function displayScreens(screens, displayName) {
  var wanted = String(displayName || "").trim()
  var source = screens && screens.length !== undefined ? screens : []
  var out = []
  if (wanted === "") return out
  for (var i = 0; i < source.length; i++) {
    if (screenName(source[i]) !== wanted) continue
    out.push(source[i])
    break
  }
  return out
}

function normalizeBarPosition(position) {
  var value = String(position || "")
  return value === "bottom" || value === "left" || value === "right" ? value : "top"
}

// Edge space the Omarchy bar covers. The surface uses ExclusionMode.Ignore and
// spans under the bar, so content must step out of the way itself.
function barInset(position, size, hidden) {
  var inset = { top: 0, right: 0, bottom: 0, left: 0 }
  if (hidden) return inset
  var amount = Number(size)
  if (!isFinite(amount) || amount <= 0) return inset
  inset[normalizeBarPosition(position)] = Math.round(amount)
  return inset
}

// The usable content rectangle of a surface. Surfaces report 0x0 before their
// first configure, so sizes clamp at zero.
function contentRect(width, height, inset) {
  var edges = inset || { top: 0, right: 0, bottom: 0, left: 0 }
  var w = Math.max(0, Number(width) || 0)
  var h = Math.max(0, Number(height) || 0)
  return {
    x: edges.left,
    y: edges.top,
    width: Math.max(0, w - edges.left - edges.right),
    height: Math.max(0, h - edges.top - edges.bottom)
  }
}

// Columns of Cards that fit a width without any column getting narrower than
// minColumnWidth. Portrait fits one; landscape and wide tiles fit more.
function columnsFor(width, minColumnWidth, maxColumns) {
  var w = Number(width)
  var min = Number(minColumnWidth)
  var max = Math.floor(Number(maxColumns))
  if (!isFinite(w) || !isFinite(min) || min <= 0 || !isFinite(max) || max < 1) return 1
  return Math.max(1, Math.min(max, Math.floor(w / min)))
}

// Where each Card goes when Cards may differ in height (an open Recap grows its
// Card). Cards fill rows left to right in key order; a row is as tall as its
// tallest Card, so an open Card pushes every row below it down. `heights` maps
// key -> measured height; a missing or unusable one is baseHeight. Each row is
// followed by `gap`, as a grid cell would be.
// -> { positions: { key: { column, y } }, contentHeight }
function cardPlacement(keys, heights, columns, baseHeight, gap) {
  var list = Array.isArray(keys) ? keys : []
  var sizes = heights !== null && typeof heights === "object" ? heights : {}
  var cols = Math.max(1, Math.floor(Number(columns)) || 1)
  var base = Math.max(0, Number(baseHeight) || 0)
  var spacing = Math.max(0, Number(gap) || 0)
  var positions = {}
  var y = 0
  for (var start = 0; start < list.length; start += cols) {
    var rowHeight = 0
    for (var i = start; i < Math.min(list.length, start + cols); i++) {
      var own = Object.prototype.hasOwnProperty.call(sizes, list[i]) ? Number(sizes[list[i]]) : NaN
      var height = isFinite(own) && own > 0 ? own : base
      Object.defineProperty(positions, list[i], { value: { column: i - start, y: y }, enumerable: true })
      rowHeight = Math.max(rowHeight, height)
    }
    y += rowHeight + spacing
  }
  return { positions: positions, contentHeight: y }
}

// The scroll offset after Cards changed height without changing order: the
// Card at the top edge of the view keeps its place on screen, so a Recap
// opening or refreshing above the view does not shift what is being read.
function keepScroll(before, after, keys, contentY) {
  var y = Number(contentY) || 0
  var list = Array.isArray(keys) ? keys : []
  if (!before || !after || !before.positions || !after.positions) return y
  var anchor = ""
  for (var i = 0; i < list.length; i++) {
    var was = before.positions[list[i]]
    if (!was || !Object.prototype.hasOwnProperty.call(before.positions, list[i])) continue
    if (was.y > y) break
    anchor = list[i]
  }
  if (anchor === "" || !Object.prototype.hasOwnProperty.call(after.positions, anchor)) return y
  return y + after.positions[anchor].y - before.positions[anchor].y
}

// The scroll offset after a list of equal-height rows changed (rows expanded,
// collapsed, added or removed): the row at the top edge of the view keeps its
// place on screen. When that row is gone, the nearest surviving row above it
// does. `pitch` is a row's height plus the gap after it.
function keepRowScroll(beforeKeys, afterKeys, pitch, contentY) {
  var y = Number(contentY) || 0
  var step = Number(pitch)
  var before = Array.isArray(beforeKeys) ? beforeKeys : []
  var after = Array.isArray(afterKeys) ? afterKeys : []
  if (!isFinite(step) || step <= 0 || y <= 0 || before.length === 0) return y
  var top = Math.min(before.length - 1, Math.floor(y / step))
  for (var i = top; i >= 0; i--) {
    var index = after.indexOf(before[i])
    if (index >= 0) return y + (index - i) * step
  }
  return y
}

// A scroll offset kept as it is, unless the content became too short for it.
function clampScroll(contentY, contentHeight, viewHeight) {
  var y = Number(contentY)
  var limit = Math.max(0, (Number(contentHeight) || 0) - (Number(viewHeight) || 0))
  if (!isFinite(y) || y < 0) return 0
  return Math.min(y, limit)
}

// Where each Module of a Layout goes in the content area. A landscape area
// places Modules side by side, a portrait one stacks them; either way each
// takes a share of the length by weight (a junk weight counts as 1), with
// `gap` between neighbours, and the last one takes the rounding.
// -> [{ x, y, width, height }], one per weight
function moduleRects(width, height, weights, gap) {
  var list = Array.isArray(weights) ? weights : []
  var w = Math.max(0, Math.floor(Number(width) || 0))
  var h = Math.max(0, Math.floor(Number(height) || 0))
  var spacing = Math.max(0, Math.floor(Number(gap) || 0))
  var row = w > h
  var length = row ? w : h
  var shares = list.map(function(value) {
    var n = Number(value)
    return typeof value === "number" && isFinite(n) && n > 0 ? n : 1
  })
  var total = shares.reduce(function(sum, n) { return sum + n }, 0)
  var available = Math.max(0, length - spacing * Math.max(0, shares.length - 1))
  var out = []
  var at = 0
  for (var i = 0; i < shares.length; i++) {
    var start = Math.min(length, at)
    var size = i === shares.length - 1 ? length - start : Math.min(length - start, Math.floor(available * shares[i] / total))
    size = Math.max(0, size)
    out.push(row ? { x: start, y: 0, width: size, height: h } : { x: 0, y: start, width: w, height: size })
    at = start + size + spacing
  }
  return out
}

if (typeof module !== "undefined") {
  module.exports = {
    screenName: screenName,
    displayScreens: displayScreens,
    normalizeBarPosition: normalizeBarPosition,
    barInset: barInset,
    contentRect: contentRect,
    columnsFor: columnsFor,
    cardPlacement: cardPlacement,
    clampScroll: clampScroll,
    keepScroll: keepScroll,
    moduleRects: moduleRects,
    keepRowScroll: keepRowScroll
  }
}
