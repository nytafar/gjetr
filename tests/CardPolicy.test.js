"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")
const loadLib = require("./support/loadLib.cjs")

const Card = loadLib("lib/CardPolicy.js")

test("presets name the Fields a Card shows", () => {
  assert.deepEqual(Array.from(Card.PRESET_NAMES), ["compact", "detailed"])
  assert.deepEqual({ ...Card.fieldsFor("compact") }, { status: true, kind: true, name: true, location: false, cache: true })
  assert.deepEqual({ ...Card.fieldsFor("detailed") }, { status: true, kind: true, name: true, location: true, cache: true })
})

test("an unknown preset falls back to the default", () => {
  assert.equal(Card.normalizePreset("bogus"), Card.DEFAULT_PRESET)
  assert.equal(Card.normalizePreset(" compact "), "compact")
  assert.equal(Card.normalizePreset(undefined), Card.DEFAULT_PRESET)
  assert.deepEqual({ ...Card.fieldsFor("bogus") }, { ...Card.fieldsFor(Card.DEFAULT_PRESET) })
})

test("cards are at least a touch target tall", () => {
  for (const preset of Card.PRESET_NAMES) {
    assert.ok(Card.cardHeight(preset) >= Card.MIN_TOUCH_PX, preset)
  }
  assert.ok(Card.cardHeight("detailed") > Card.cardHeight("compact"))
  assert.ok(Card.MIN_TOUCH_PX >= 48)
})

test("cache levels map to theme tokens", () => {
  assert.equal(Card.cacheTone("ok"), "muted")
  assert.equal(Card.cacheTone("warn"), "accent")
  assert.equal(Card.cacheTone("critical"), "urgent")
  assert.equal(Card.cacheTone("cold"), "muted")
  assert.equal(Card.cacheTone(undefined), "muted")
})

test("kind icons are the kind table's: Omarchy's marks, gjetr's one-colour marks, else none", () => {
  assert.equal(Card.kindIconFile("claude", false), "claude.svg")
  assert.equal(Card.kindIconFile("claude", true), "claude.svg")
  assert.equal(Card.kindIconFile("codex", false), "codex.svg")
  assert.equal(Card.kindIconFile("codex", true), "codex-light.svg")
  assert.equal(Card.kindIconFile("pi", false), "pi.svg")
  assert.equal(Card.kindIconTinted("pi"), true)
  assert.equal(Card.kindIconTinted("claude"), false)
  assert.equal(Card.kindIconUrl("pi", false, "/o", "file:///g/assets/kinds"), "file:///g/assets/kinds/pi.svg")
  assert.equal(Card.kindIconUrl("codex", true, "/o", "file:///g/assets/kinds"), "file:///o/shell/plugins/agents/assets/codex-light.svg")
  assert.equal(Card.kindIconFile("droid", false), "")
  assert.equal(Card.kindIconFile("__proto__", false), "")
  assert.equal(Card.kindIconFile("../x", false), "")
})

test("kindGlyph is the kind table's letter, else the kind's first letter", () => {
  assert.equal(Card.kindGlyph("pi", ""), "π")
  assert.equal(Card.kindGlyph("copilot", "copilot"), "P")
  assert.equal(Card.kindGlyph("opencode", "OpenCode"), "O")
  assert.equal(Card.kindGlyph("aider", ""), "A")
  assert.equal(Card.kindGlyph("", ""), "?")
})

test("an inline Recap makes room for two lines", () => {
  assert.equal(Card.cardHeightFor("detailed", "off", "Fixed the parser."), Card.cardHeight("detailed"))
  assert.equal(Card.cardHeightFor("compact", "inline", "Fixed the parser."), Card.cardHeight("compact") + Card.RECAP_INLINE_PX)
})

test("a Card without a Recap does not grow when Recaps are inline", () => {
  for (const text of ["", null, undefined]) {
    assert.equal(Card.cardHeightFor("detailed", "inline", text), Card.cardHeight("detailed"))
    assert.equal(Card.inlineRecapShown("inline", text), false)
  }
  assert.equal(Card.inlineRecapShown("inline", "Fixed the parser."), true)
  assert.equal(Card.inlineRecapShown("expand", "Fixed the parser."), false)
  assert.equal(Card.cardHeightFor("detailed", "expand", "Fixed the parser."), Card.cardHeight("detailed"))
})

test("a narrow list header drops the sort and focus captions, keeping the values", () => {
  assert.equal(Card.compactHeader(360), true)
  assert.equal(Card.compactHeader(Card.COMPACT_HEADER_BELOW - 1), true)
  assert.equal(Card.compactHeader(Card.COMPACT_HEADER_BELOW), false)
  assert.equal(Card.compactHeader(940), false)
  assert.equal(Card.compactHeader(0), false)
  assert.equal(Card.headerCaption("sort", "priority", true), "priority")
  assert.equal(Card.headerCaption("focus", "herdr", false), "focus  herdr")
})

test("cache bar tones read as a traffic light", () => {
  assert.equal(Card.cacheBarTone("ok"), "success")
  assert.equal(Card.cacheBarTone("warn"), "accent")
  assert.equal(Card.cacheBarTone("critical"), "urgent")
  assert.equal(Card.cacheBarTone("cold"), "muted")
  assert.equal(Card.cacheBarTone("__proto__"), "muted")
})
