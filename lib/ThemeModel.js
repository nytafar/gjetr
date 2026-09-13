.pragma library
.import "vendor/toml.js" as Toml

// Colours gjetr needs from the Omarchy theme beyond the shell's own tokens
// (qs.Commons Color: foreground, background, accent, urgent, muted). Read from
// ~/.local/state/omarchy/current/theme/colors.toml, which every shipped theme
// fills. Pure; the service watches the file.

var MAX_BYTES = 16384
var HEX_RE = /^#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/

// The theme's green, used for `done`, or "" when the theme has none.
function successColor(text) {
  if (text === undefined || text === null) return ""
  var source = String(text)
  if (source.length > MAX_BYTES) return ""
  var table
  try {
    table = Toml.parse(source)
  } catch (error) {
    return ""
  }
  var value = table && Object.prototype.hasOwnProperty.call(table, "green") ? table.green : ""
  return typeof value === "string" && HEX_RE.test(value) ? value : ""
}

if (typeof module !== "undefined") {
  module.exports = { successColor: successColor }
}
