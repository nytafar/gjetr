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

if (typeof module !== "undefined") {
  module.exports = {
    screenName: screenName,
    displayScreens: displayScreens,
    normalizeBarPosition: normalizeBarPosition,
    barInset: barInset,
    contentRect: contentRect,
    columnsFor: columnsFor
  }
}
