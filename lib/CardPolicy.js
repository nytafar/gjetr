.pragma library

// What a Card shows and how loud it is. Presets name the Fields; tones name
// Omarchy theme tokens (qs.Commons Color: foreground, accent, urgent, muted),
// which the Module resolves to colours. Pure, so a theme switch only changes
// the colours behind the tokens. How a status reads is StatusPolicy.

var FIELDS = ["status", "kind", "name", "location", "cache"]

var PRESETS = {
  compact: ["status", "kind", "name", "cache"],
  detailed: ["status", "kind", "name", "location", "cache"]
}
var PRESET_NAMES = ["compact", "detailed"]
var DEFAULT_PRESET = "detailed"

// Smallest tap target. The 7" 1024x600 panel is about 170 ppi, so 56 px is
// roughly 8 mm.
var MIN_TOUCH_PX = 56
var CARD_HEIGHT = { compact: 64, detailed: 88 }

var CACHE_TONES = { ok: "muted", warn: "accent", critical: "urgent", cold: "muted" }

// Marks Omarchy ships in shell/plugins/agents/assets, with the variant for
// light themes where the mark needs one.
var KIND_ICONS = {
  claude: { dark: "claude.svg", light: "claude.svg" },
  codex: { dark: "codex.svg", light: "codex-light.svg" }
}

function own(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key)
}

function normalizePreset(name) {
  var value = name === undefined || name === null ? "" : String(name).trim()
  return PRESET_NAMES.indexOf(value) >= 0 ? value : DEFAULT_PRESET
}

function fieldsFor(preset) {
  var chosen = PRESETS[normalizePreset(preset)]
  var out = {}
  for (var i = 0; i < FIELDS.length; i++) out[FIELDS[i]] = chosen.indexOf(FIELDS[i]) >= 0
  return out
}

function cardHeight(preset) {
  return Math.max(MIN_TOUCH_PX, CARD_HEIGHT[normalizePreset(preset)])
}

// Room for two lines of Recap under the Fields when it is shown inline.
var RECAP_INLINE_PX = 44

// Whether a Card shows its Recap inline: the Module says `inline` and this
// Agent has a Recap. A Card without one keeps its plain height.
function inlineRecapShown(recapMode, recapText) {
  return recapMode === "inline" && typeof recapText === "string" && recapText !== ""
}

function cardHeightFor(preset, recapMode, recapText) {
  return cardHeight(preset) + (inlineRecapShown(recapMode, recapText) ? RECAP_INLINE_PX : 0)
}

function cacheTone(level) {
  return own(CACHE_TONES, level) ? CACHE_TONES[level] : "muted"
}

function kindIconFile(kind, lightTheme) {
  var key = kind === undefined || kind === null ? "" : String(kind)
  if (!own(KIND_ICONS, key)) return ""
  return lightTheme ? KIND_ICONS[key].light : KIND_ICONS[key].dark
}

function kindGlyph(kind, displayKind) {
  var source = String(displayKind || kind || "").trim()
  return source === "" ? "?" : source.charAt(0).toUpperCase()
}

if (typeof module !== "undefined") {
  module.exports = {
    FIELDS: FIELDS,
    PRESETS: PRESETS,
    PRESET_NAMES: PRESET_NAMES,
    DEFAULT_PRESET: DEFAULT_PRESET,
    MIN_TOUCH_PX: MIN_TOUCH_PX,
    normalizePreset: normalizePreset,
    fieldsFor: fieldsFor,
    cardHeight: cardHeight,
    cardHeightFor: cardHeightFor,
    inlineRecapShown: inlineRecapShown,
    RECAP_INLINE_PX: RECAP_INLINE_PX,
    cacheTone: cacheTone,
    kindIconFile: kindIconFile,
    kindGlyph: kindGlyph
  }
}
