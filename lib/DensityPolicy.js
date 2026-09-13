.pragma library
.import "CardPolicy.js" as CardPolicy

// Density: how much room a Module gives each thing it draws, chosen from the
// space it has and how the Display is used. A touch surface keeps big,
// boxed, touch-sized Cards (comfortable); a pointer Display (a Dock) and a
// narrow touch column get compact rows: no boxes, Omarchy's own type sizes, a
// small kind mark and tight padding, so many more Agents fit. Density is
// orthogonal to a preset: the preset picks the Fields, density their size.
// Pure; the Module passes its size and the theme's type ramp and spacing.

var DENSITIES = ["comfortable", "compact"]
var INPUTS = ["touch", "pointer"]
// A touch column narrower than this goes compact (rows stay touch targets).
var COMPACT_TOUCH_BELOW = 360
// A compact row shows workspace › tab on a second line only when this many
// two-line rows fit in the Module.
var ROOM_ROWS = 20
var MAX_DPR = 4

var DEFAULT_FONTS = { caption: 10, body: 12, title: 14 }
var DEFAULT_SPACING = { sm: 4, lg: 8, xxl: 12 }

function positive(value, fallback) {
  var n = Number(value)
  return typeof value === "number" && isFinite(n) && n > 0 ? n : fallback
}

// A Dock is used with a mouse; a surface is a touchscreen.
function inputFor(kind) {
  return kind === "dock" ? "pointer" : "touch"
}

function densityFor(width, height, input) {
  if (input === "pointer") return "compact"
  var w = Number(width)
  return isFinite(w) && w > 0 && w < COMPACT_TOUCH_BELOW ? "compact" : "comfortable"
}

// options: { width, height, input: "touch" | "pointer", fonts: { caption,
// body, title }, spacing: { sm, lg, xxl }, dpr }
// -> size tokens in logical pixels.
function tokens(options) {
  var o = options !== null && typeof options === "object" ? options : {}
  var fonts = o.fonts !== null && typeof o.fonts === "object" ? o.fonts : {}
  var spacing = o.spacing !== null && typeof o.spacing === "object" ? o.spacing : {}
  var caption = positive(fonts.caption, DEFAULT_FONTS.caption)
  var body = positive(fonts.body, DEFAULT_FONTS.body)
  var title = positive(fonts.title, DEFAULT_FONTS.title)
  var sm = positive(spacing.sm, DEFAULT_SPACING.sm)
  var lg = positive(spacing.lg, DEFAULT_SPACING.lg)
  var xxl = positive(spacing.xxl, DEFAULT_SPACING.xxl)
  var dpr = Math.min(MAX_DPR, Math.max(1, positive(o.dpr, 1)))
  var input = o.input === "pointer" ? "pointer" : "touch"
  var name = densityFor(o.width, o.height, input)
  var touch = CardPolicy.MIN_TOUCH_PX
  var t

  if (name === "comfortable") {
    var scale = 1.25
    t = {
      name: name, input: input, boxed: true, textScale: scale,
      titlePx: Math.round(title * scale), bodyPx: Math.round(body * scale), captionPx: Math.round(caption * scale),
      namePx: Math.round(title * scale), detailPx: Math.round(body * scale),
      glyphPx: Math.round(title * scale * 1.3), iconPx: 28, statusWidth: 28,
      pad: xxl, gap: lg, headerHeight: touch, rowHeight: touch, rowGap: sm, padY: 0,
      lineHeight: touch, secondLineHeight: 0, indent: 28, minColumnWidth: 440, recapLines: 2
    }
  } else {
    var glyph = Math.round(body * 1.15)
    t = {
      name: name, input: input, boxed: false, textScale: 1,
      titlePx: Math.round(title), bodyPx: Math.round(body), captionPx: Math.round(caption),
      namePx: Math.round(body), detailPx: Math.round(caption),
      glyphPx: glyph, iconPx: glyph, statusWidth: glyph + 2,
      pad: Math.round(sm * 1.5), gap: Math.round(sm), headerHeight: input === "touch" ? touch : Math.ceil(body * 2.5),
      rowHeight: 0, rowGap: 1, padY: 2,
      lineHeight: Math.ceil(body * 1.4), secondLineHeight: Math.ceil(caption * 1.2),
      indent: Math.round(sm * 3.5), minColumnWidth: 280, recapLines: 1
    }
    t.rowHeight = rowHeight(t, false)
  }
  t.iconSourcePx = Math.ceil(t.iconPx * dpr)
  return t
}

// The height of one list row: a compact row with one or two lines, never
// below a touch target on a touch Display. Comfortable rows are touch rows.
function rowHeight(t, twoLines) {
  if (!t || t.name !== "compact") return CardPolicy.MIN_TOUCH_PX
  var h = t.padY * 2 + t.lineHeight + (twoLines ? t.secondLineHeight : 0)
  return t.input === "touch" ? Math.max(CardPolicy.MIN_TOUCH_PX, h) : h
}

// What a compact Agent row shows under its name: "recap" (the inline Recap,
// clamped to one line), "location" (workspace › tab, when the preset shows it
// and ROOM_ROWS two-line rows fit in `height`), or "". Comfortable Cards lay
// out their own Fields.
function secondLine(t, preset, recapMode, recapText, height) {
  if (!t || t.name !== "compact") return ""
  if (CardPolicy.inlineRecapShown(recapMode, recapText)) return "recap"
  if (!CardPolicy.fieldsFor(preset).location) return ""
  var h = Number(height)
  return isFinite(h) && h >= (rowHeight(t, true) + t.rowGap) * ROOM_ROWS ? "location" : ""
}

if (typeof module !== "undefined") {
  module.exports = {
    DENSITIES: DENSITIES,
    INPUTS: INPUTS,
    COMPACT_TOUCH_BELOW: COMPACT_TOUCH_BELOW,
    ROOM_ROWS: ROOM_ROWS,
    inputFor: inputFor,
    densityFor: densityFor,
    tokens: tokens,
    rowHeight: rowHeight,
    secondLine: secondLine
  }
}
