.pragma library

// How a status reads on a Card or a Workspace List row. Every status has its
// own glyph and short word, so it reads without colour; working also moves.
// Colours are theme tokens the Module resolves: accent, urgent, success (the
// theme's green), muted and foreground. Idle is only dimmed. Blocked and done
// keep the Attention pulse on top of this. Pure.
//
// Glyphs are in JetBrains Mono, the Omarchy shell's monospace font.

var STATUSES = ["working", "idle", "blocked", "done", "unknown"]

// opacity: of the glyph and word. textOpacity: of the rest of the Card or
// row text, for the subtle dim of an idle Agent.
var INDICATORS = {
  working: { glyph: "◌", label: "working", tone: "accent", motion: "spin", opacity: 1, textOpacity: 1 },
  idle: { glyph: "○", label: "idle", tone: "foreground", motion: "", opacity: 0.6, textOpacity: 0.85 },
  blocked: { glyph: "▲", label: "blocked", tone: "urgent", motion: "", opacity: 1, textOpacity: 1 },
  done: { glyph: "✓", label: "done", tone: "success", motion: "", opacity: 1, textOpacity: 1 },
  unknown: { glyph: "·", label: "unknown", tone: "muted", motion: "", opacity: 1, textOpacity: 1 }
}

function indicator(status) {
  var key = typeof status === "string" && STATUSES.indexOf(status) >= 0 ? status : "unknown"
  var source = INDICATORS[key]
  return { status: key, glyph: source.glyph, label: source.label, tone: source.tone, motion: source.motion,
    opacity: source.opacity, textOpacity: source.textOpacity }
}

// The compact preset keeps the glyph and drops the word.
function showsLabel(preset) {
  return preset !== "compact"
}

if (typeof module !== "undefined") {
  module.exports = {
    STATUSES: STATUSES,
    indicator: indicator,
    showsLabel: showsLabel
  }
}
