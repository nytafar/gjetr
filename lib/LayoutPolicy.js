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

// The most of a stacked Layout's height its pinned Modules take together.
var MAX_PIN_SHARE = 0.5

// Whether a content area stacks its Modules (portrait, or square) rather than
// placing them side by side (landscape).
function stacksModules(width, height) {
  return !(Math.floor(Number(width) || 0) > Math.floor(Number(height) || 0))
}

// Where each Module of a Layout goes in the content area. A landscape area
// places Modules side by side, a portrait one stacks them; either way each
// takes a share of the length by weight (a junk weight counts as 1), with
// `gap` between neighbours, and the last one takes the rounding.
//
// `pins`, optional, has one entry per Module: null when it is not pinned,
// else its content height. Pinned Modules go after the others, flush against
// the end: the bottom of a stack, the right edge side by side. Stacked, a
// pinned Module with a content height (a positive number) takes exactly that,
// the pinned Modules together at most MAX_PIN_SHARE of the height (shrunk in
// proportion beyond it), and the others share the rest by weight. Side by
// side, or before its content height is known, a pinned Module keeps its
// weight share. When every Module is pinned they split by weight, in order.
// -> [{ x, y, width, height }], one per weight
function moduleRects(width, height, weights, gap, pins) {
  var list = Array.isArray(weights) ? weights : []
  var pinList = Array.isArray(pins) ? pins : []
  var w = Math.max(0, Math.floor(Number(width) || 0))
  var h = Math.max(0, Math.floor(Number(height) || 0))
  var spacing = Math.max(0, Math.floor(Number(gap) || 0))
  var row = !stacksModules(w, h)
  var length = row ? w : h
  var shares = list.map(function(value) {
    var n = Number(value)
    return typeof value === "number" && isFinite(n) && n > 0 ? n : 1
  })

  var free = []
  var pinned = []
  for (var p = 0; p < shares.length; p++) {
    var entry = pinList[p]
    if (entry === undefined || entry === null || entry === false) free.push(p)
    else pinned.push(p)
  }
  if (free.length === 0) {
    free = pinned
    pinned = []
  }
  var order = free.concat(pinned)

  // Stacked, pinned Modules with a content height are fixed, capped together.
  var fixed = shares.map(function() { return -1 })
  var asked = 0
  if (!row) {
    for (var q = 0; q < pinned.length; q++) {
      var content = pinList[pinned[q]]
      if (typeof content === "number" && isFinite(content) && content > 0) {
        fixed[pinned[q]] = Math.ceil(content)
        asked += fixed[pinned[q]]
      }
    }
  }
  var cap = Math.floor(length * MAX_PIN_SHARE)
  var fixedTotal = 0
  for (var f = 0; f < fixed.length; f++) {
    if (fixed[f] < 0) continue
    if (asked > cap) fixed[f] = Math.floor(fixed[f] * cap / asked)
    fixedTotal += fixed[f]
  }

  var total = 0
  var lastFree = -1
  for (var o = 0; o < order.length; o++) {
    if (fixed[order[o]] >= 0) continue
    total += shares[order[o]]
    lastFree = order[o]
  }
  var available = Math.max(0, length - spacing * Math.max(0, shares.length - 1) - fixedTotal)
  var out = new Array(shares.length)
  var used = 0
  var at = 0
  for (var k = 0; k < order.length; k++) {
    var i = order[k]
    var start = Math.min(length, at)
    var size
    if (fixed[i] >= 0) {
      size = fixed[i]
    } else if (i === lastFree) {
      size = available - used
    } else {
      size = Math.floor(available * shares[i] / total)
      used += size
    }
    size = Math.max(0, Math.min(length - start, size))
    out[i] = row ? { x: start, y: 0, width: size, height: h } : { x: 0, y: start, width: w, height: size }
    at = start + size + spacing
  }
  return out
}

// A hairline in the middle of each gap between neighbouring Modules, in the
// order moduleRects placed them (a pinned Module may come first in Config).
// -> [{ x, y, width, height }], one fewer than the rectangles
function moduleDividers(width, height, rects, gap) {
  var source = rects && rects.length !== undefined ? rects : []
  var w = Math.max(0, Math.floor(Number(width) || 0))
  var h = Math.max(0, Math.floor(Number(height) || 0))
  var half = Math.ceil(Math.max(0, Math.floor(Number(gap) || 0)) / 2)
  var row = !stacksModules(w, h)
  var placed = []
  for (var i = 0; i < source.length; i++) {
    if (source[i] !== null && typeof source[i] === "object") placed.push(source[i])
  }
  placed.sort(function(a, b) { return row ? a.x - b.x : a.y - b.y })
  var out = []
  for (var n = 1; n < placed.length; n++) {
    out.push(row ? { x: placed[n].x - half, y: 0, width: 1, height: h }
      : { x: 0, y: placed[n].y - half, width: w, height: 1 })
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
    MAX_PIN_SHARE: MAX_PIN_SHARE,
    stacksModules: stacksModules,
    moduleRects: moduleRects,
    moduleDividers: moduleDividers,
    keepRowScroll: keepRowScroll
  }
}
