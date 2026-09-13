.pragma library
.import "vendor/toml.js" as Toml

// Colours gjetr needs from the Omarchy theme beyond the shell's own tokens
// (qs.Commons Color: foreground, background, accent, urgent, muted): the
// green for `done` and the palette for the `hue` working effect. Read from
// ~/.local/state/omarchy/current/theme/colors.toml, which every shipped theme
// fills. Pure; the service watches the file.

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

if (typeof module !== "undefined") {
  module.exports = { PALETTE_KEYS: PALETTE_KEYS, successColor: successColor, palette: palette }
}
