.pragma library
.import "KindPolicy.js" as KindPolicy

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
// A draining Cache timer bar (full Cards): ok in the theme's green, so the
// levels read as a traffic light; an expired cache leaves only the track.
var CACHE_BAR_TONES = { ok: "success", warn: "accent", critical: "urgent", cold: "muted" }

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

// A list header narrower than this (a Dock, a thin column) shows its toggles
// as bare values ("priority", "herdr") instead of "sort  priority".
var COMPACT_HEADER_BELOW = 480

function compactHeader(width) {
  var w = Number(width)
  return isFinite(w) && w > 0 && w < COMPACT_HEADER_BELOW
}

function headerCaption(caption, value, compact) {
  return compact ? String(value) : caption + "  " + value
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

function cacheBarTone(level) {
  return own(CACHE_BAR_TONES, level) ? CACHE_BAR_TONES[level] : "muted"
}

// The kind mark: Omarchy's SVG where it ships one, else the letter drawn in
// its place (KindPolicy).
function kindIconFile(kind, lightTheme) {
  return KindPolicy.kindIconFile(kind, lightTheme)
}

function kindGlyph(kind, displayKind) {
  return KindPolicy.kindLetter(kind, displayKind)
}

function kindLabel(kind, displayKind) {
  return KindPolicy.kindLabel(kind, displayKind)
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
    COMPACT_HEADER_BELOW: COMPACT_HEADER_BELOW,
    compactHeader: compactHeader,
    headerCaption: headerCaption,
    RECAP_INLINE_PX: RECAP_INLINE_PX,
    cacheTone: cacheTone,
    cacheBarTone: cacheBarTone,
    kindIconFile: kindIconFile,
    kindGlyph: kindGlyph,
    kindLabel: kindLabel
  }
}
