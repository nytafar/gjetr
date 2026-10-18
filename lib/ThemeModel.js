.pragma library
.import "vendor/toml.js" as Toml

// Colours gjetr needs from the Omarchy theme beyond the shell's own tokens
// (qs.Commons Color: foreground, background, accent, urgent, muted): the
// green for `done` and the palette for the `hue` working effect. Read from
// ~/.local/state/omarchy/current/theme/colors.toml, which every shipped theme
// fills. Pure; the service watches the file.
//
// gjetr draws on its Display's background (black by default), not on the
// theme's, so the theme's text colours can be unreadable there: a light
// theme's foreground is dark. readable() derives the colours gjetr draws with
// from the theme and the Display background: each theme colour is kept when it
// contrasts enough with that background (WCAG 2 contrast ratio), else text
// falls back to a neutral and an accent is nudged toward the far end until it
// does. It works either way round: a light `background` gets dark text.

var MAX_BYTES = 16384
var HEX_RE = /^#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/

// The palette the `hue` working effect cycles through, in this order.
var PALETTE_KEYS = ["accent", "red", "yellow", "green", "cyan", "blue", "magenta"]

function parse(text) {
  if (text === undefined || text === null) return null
  var source = String(text)
  if (source.length > MAX_BYTES) return null
  try {
    var table = Toml.parse(source)
    return table !== null && typeof table === "object" ? table : null
  } catch (error) {
    return null
  }
}

function colorOf(table, key) {
  var value = table && Object.prototype.hasOwnProperty.call(table, key) ? table[key] : ""
  return typeof value === "string" && HEX_RE.test(value) ? value : ""
}

// The theme's green, used for `done`, or "" when the theme has none.
function successColor(text) {
  return colorOf(parse(text), "green")
}

// The theme's accent and hues (PALETTE_KEYS) that it has, each colour once;
// [] when the file is missing or unreadable.
function palette(text) {
  var table = parse(text)
  var out = []
  var seen = []
  for (var i = 0; i < PALETTE_KEYS.length; i++) {
    var value = colorOf(table, PALETTE_KEYS[i])
    if (value === "" || seen.indexOf(value.toLowerCase()) >= 0) continue
    seen.push(value.toLowerCase())
    out.push(value)
  }
  return out
}

// Contrast ratios readable() keeps: WCAG AA for body text (foreground), and
// the large-text / non-text minimum for secondary text and accents.
var MIN_FOREGROUND_CONTRAST = 4.5
var MIN_MUTED_CONTRAST = 3
var MIN_ACCENT_CONTRAST = 3

// Neutrals text falls back to: light on a dark background, dark on a light one.
var LIGHT_FOREGROUND = "#e6e6e6"
var LIGHT_MUTED = "#9a9a9a"
var DARK_FOREGROUND = "#1a1a1a"
var DARK_MUTED = "#5c5c5c"

var NUDGE_STEP = 0.1

// "#rrggbb" or Qt's "#aarrggbb" (how a QML color prints, and how Config's
// background reads) to {r, g, b, a} in 0..1; null for anything else.
function rgbaOf(value) {
  var text = typeof value === "string" ? value : value === undefined || value === null ? "" : String(value)
  if (!HEX_RE.test(text)) return null
  var hex = text.slice(1)
  var a = 1
  if (hex.length === 8) {
    a = parseInt(hex.slice(0, 2), 16) / 255
    hex = hex.slice(2)
  }
  return { r: parseInt(hex.slice(0, 2), 16) / 255, g: parseInt(hex.slice(2, 4), 16) / 255,
    b: parseInt(hex.slice(4, 6), 16) / 255, a: a }
}

function hexOf(c) {
  function part(v) {
    var n = Math.max(0, Math.min(255, Math.round(v * 255)))
    return (n < 16 ? "0" : "") + n.toString(16)
  }
  return "#" + part(c.r) + part(c.g) + part(c.b)
}

// WCAG 2 relative luminance of an opaque colour.
function luminance(c) {
  function channel(v) { return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b)
}

// WCAG 2 contrast ratio between two opaque colours, 1..21.
function contrastOf(a, b) {
  var la = luminance(a)
  var lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

// The colour `over` makes on `under`, both {r, g, b, a}; opaque.
function composite(over, under) {
  return { r: over.r * over.a + under.r * (1 - over.a), g: over.g * over.a + under.g * (1 - over.a),
    b: over.b * over.a + under.b * (1 - over.a), a: 1 }
}

var BLACK = { r: 0, g: 0, b: 0, a: 1 }
var WHITE = { r: 1, g: 1, b: 1, a: 1 }

// The Display background as drawn: a translucent or transparent one (the
// wallpaper shows through) counts as over black, which is what is behind it
// when there is no wallpaper. Unreadable is black, gjetr's default.
function backdropOf(background) {
  var c = rgbaOf(background)
  return c ? composite(c, BLACK) : BLACK
}

// Contrast ratio between a colour (drawn on the background) and the Display
// background; 0 when the colour is unreadable.
function contrast(color, background) {
  var c = rgbaOf(color)
  if (!c) return 0
  var bg = backdropOf(background)
  return contrastOf(composite(c, bg), bg)
}

// True when dark text reads better than light text on this background.
function isLight(background) {
  var bg = backdropOf(background)
  return contrastOf(BLACK, bg) > contrastOf(WHITE, bg)
}

// `color` when it reaches `min` on the background, else `fallback`.
function keepOr(color, background, min, fallback) {
  return contrast(color, background) >= min ? String(color) : fallback
}

// `color` mixed toward white (dark background) or black (light background), in
// NUDGE_STEP steps, until it reaches `min`; `fallback` when it is unreadable.
function nudge(color, background, min, fallback) {
  var c = rgbaOf(color)
  if (!c) return fallback
  if (contrast(color, background) >= min) return String(color)
  var bg = backdropOf(background)
  var target = isLight(background) ? BLACK : WHITE
  var base = composite(c, bg)
  var mixed = base
  for (var t = NUDGE_STEP; t < 1 + NUDGE_STEP / 2; t += NUDGE_STEP) {
    var k = Math.min(1, t)
    mixed = { r: base.r + (target.r - base.r) * k, g: base.g + (target.g - base.g) * k,
      b: base.b + (target.b - base.b) * k, a: 1 }
    if (contrastOf(mixed, bg) >= min) break
  }
  return hexOf(mixed)
}

// The colours gjetr draws with on a Display whose background is `background`
// (a colour string; "#00000000" for transparent), from `theme`: { foreground,
// muted, accent, urgent, success, palette } as colour strings, `success` ""
// when the theme has no green. Returns { background, foreground, muted, accent,
// urgent, success, palette }: `background` is the backdrop as drawn (opaque),
// text keeps the theme's colour when it reads (foreground 4.5:1, muted 3:1)
// and is a neutral otherwise, accents (success is accent when missing, and
// each palette colour) are nudged to 3:1.
function readable(theme, background) {
  var t = theme && typeof theme === "object" ? theme : {}
  var light = isLight(background)
  var foreground = keepOr(t.foreground, background, MIN_FOREGROUND_CONTRAST,
    light ? DARK_FOREGROUND : LIGHT_FOREGROUND)
  var muted = keepOr(t.muted, background, MIN_MUTED_CONTRAST, light ? DARK_MUTED : LIGHT_MUTED)
  var accent = nudge(t.accent, background, MIN_ACCENT_CONTRAST, foreground)
  var urgent = nudge(t.urgent, background, MIN_ACCENT_CONTRAST, accent)
  var success = rgbaOf(t.success) ? nudge(t.success, background, MIN_ACCENT_CONTRAST, accent) : accent
  var source = Array.isArray(t.palette) ? t.palette : []
  var palette = []
  for (var i = 0; i < source.length; i++) {
    if (!rgbaOf(source[i])) continue
    var value = nudge(source[i], background, MIN_ACCENT_CONTRAST, accent)
    if (palette.indexOf(value) < 0) palette.push(value)
  }
  return { background: hexOf(backdropOf(background)), foreground: foreground, muted: muted, accent: accent,
    urgent: urgent, success: success, palette: palette }
}

if (typeof module !== "undefined") {
  module.exports = { PALETTE_KEYS: PALETTE_KEYS, successColor: successColor, palette: palette,
    MIN_FOREGROUND_CONTRAST: MIN_FOREGROUND_CONTRAST, MIN_MUTED_CONTRAST: MIN_MUTED_CONTRAST,
    MIN_ACCENT_CONTRAST: MIN_ACCENT_CONTRAST, contrast: contrast, isLight: isLight, readable: readable }
}
