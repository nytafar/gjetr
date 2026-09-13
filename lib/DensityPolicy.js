.pragma library
.import "CardPolicy.js" as CardPolicy

// Density: how much room a Module gives each thing it draws, chosen from the
// space it has and how the Display is used. A touch surface keeps big,
// boxed, touch-sized Cards (comfortable); a pointer Display (a Dock) and a
// narrow touch column get compact rows: no boxes, Omarchy's own type sizes, a
// small kind mark, and padding, a gap between the lines and a hairline between
// rows so they stay calm to read, while about three times as many Agents fit.
// Density is orthogonal to a preset: the preset picks the Fields, density
// their size. Pure; the Module passes its size and the theme's type ramp and
// spacing.
//
// A Module's `density` setting: "auto" chooses as above; "compact" always
// draws compact; "full" draws an Agent List's full Cards (big name, status
// word, a draining Cache timer bar, repo and branch, two Recap lines), sized to
// be read leaning back from a 4K Dock, and the comfortable rendering in
// Modules that have no full one.

var DENSITIES = ["comfortable", "compact", "full"]
var SETTINGS = ["auto", "compact", "full"]
var DEFAULT_SETTING = "auto"
var INPUTS = ["touch", "pointer"]
// A touch column narrower than this goes compact (rows stay touch targets).
var COMPACT_TOUCH_BELOW = 360
// A compact row shows workspace › tab on a second line only when this many
// two-line rows fit in the Module.
var ROOM_ROWS = 14
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

// setting: a Module's density setting; moduleType: "agent-list" and the like.
function densityFor(width, height, input, setting, moduleType) {
  if (setting === "compact") return "compact"
  if (setting === "full") return moduleType === "agent-list" ? "full" : "comfortable"
  if (input === "pointer") return "compact"
  var w = Number(width)
  return isFinite(w) && w > 0 && w < COMPACT_TOUCH_BELOW ? "compact" : "comfortable"
}

// options: { width, height, input: "touch" | "pointer", setting, module,
// fonts: { caption, body, title }, spacing: { sm, lg, xxl }, dpr }
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
  var name = densityFor(o.width, o.height, input, o.setting, o.module)
  var touch = CardPolicy.MIN_TOUCH_PX
  var t

  if (name === "comfortable") {
    var scale = 1.25
    t = {
      name: name, input: input, boxed: true, textScale: scale,
      titlePx: Math.round(title * scale), bodyPx: Math.round(body * scale), captionPx: Math.round(caption * scale),
      namePx: Math.round(title * scale), detailPx: Math.round(body * scale),
      glyphPx: Math.round(title * scale * 1.3), iconPx: 28, statusWidth: 28,
      pad: xxl, gap: lg, headerHeight: touch, rowHeight: touch, rowGap: sm, dividerAlpha: 0, padY: 0, lineGap: 0,
      lineHeight: touch, secondLineHeight: 0, limitLineHeight: touch, indent: 28, minColumnWidth: 440, recapLines: 2
    }
  } else if (name === "full") {
    var namePx = Math.round(title * 1.3)
    var metaPx = Math.round(caption * 1.1)
    t = {
      name: name, input: input, boxed: false, textScale: 1,
      titlePx: Math.round(title), bodyPx: Math.round(body), captionPx: Math.round(caption),
      namePx: namePx, detailPx: metaPx, metaPx: metaPx, recapPx: metaPx,
      glyphPx: namePx, iconPx: Math.round(body * 1.1), statusWidth: namePx + 2,
      pad: Math.round(sm * 2.5), gap: lg, headerHeight: input === "touch" ? touch : Math.ceil(body * 2.5),
      rowHeight: 0, rowGap: Math.round(sm * 0.75), dividerAlpha: 0, padY: Math.round(sm * 1.25), lineGap: Math.round(sm * 0.5),
      lineHeight: Math.ceil(namePx * 1.2), secondLineHeight: Math.ceil(metaPx * 1.25),
      recapGap: Math.round(sm * 0.75), recapLineHeight: Math.ceil(metaPx * 1.25), recapLines: 2,
      cachePx: namePx, cacheBarWidth: Math.round(body * 3.5), cacheBarHeight: 3,
      limitLineHeight: Math.ceil(body * 1.4) + Math.round(sm * 1.5),
      indent: Math.round(sm * 3.5), minColumnWidth: 300
    }
    t.rowHeight = fullCardHeight(t, false)
  } else {
    var glyph = Math.round(body * 1.15)
    var line = Math.ceil(body * 1.4)
    t = {
      name: name, input: input, boxed: false, textScale: 1,
      titlePx: Math.round(title), bodyPx: Math.round(body), captionPx: Math.round(caption),
      namePx: Math.round(body), detailPx: Math.round(caption),
      glyphPx: glyph, iconPx: glyph, statusWidth: glyph + 2,
      pad: Math.round(sm * 2), gap: Math.round(sm * 1.5), headerHeight: input === "touch" ? touch : Math.ceil(body * 2.5),
      rowHeight: 0, rowGap: 1, dividerAlpha: 0.08, padY: Math.round(sm * 1.25), lineGap: Math.round(sm * 0.75),
      lineHeight: line, secondLineHeight: Math.ceil(caption * 1.3), limitLineHeight: line + Math.round(sm * 1.5),
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
  var h = t.padY * 2 + t.lineHeight + (twoLines ? t.lineGap + t.secondLineHeight : 0)
  return t.input === "touch" ? Math.max(CardPolicy.MIN_TOUCH_PX, h) : h
}

// The height of a full Card before an open Recap: padding, the name line, the
// status and repo line, and two Recap lines when it shows a Recap. On touch
// never below a touch target.
function fullCardHeight(t, hasRecap) {
  if (!t || t.name !== "full") return CardPolicy.MIN_TOUCH_PX
  var h = t.padY * 2 + t.lineHeight + t.lineGap + t.secondLineHeight
    + (hasRecap ? t.recapGap + t.recapLineHeight * t.recapLines : 0)
  return t.input === "touch" ? Math.max(CardPolicy.MIN_TOUCH_PX, h) : h
}

// A full Card shows its Recap's first lines whenever the Module shows Recaps
// (inline or expand) and the Agent has one; a click opens the rest.
function fullRecapShown(recapMode, recapText) {
  return (recapMode === "inline" || recapMode === "expand") && typeof recapText === "string" && recapText !== ""
}

function normalizeSetting(value) {
  return SETTINGS.indexOf(value) >= 0 ? value : DEFAULT_SETTING
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
    SETTINGS: SETTINGS,
    DEFAULT_SETTING: DEFAULT_SETTING,
    normalizeSetting: normalizeSetting,
    fullCardHeight: fullCardHeight,
    fullRecapShown: fullRecapShown,
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
