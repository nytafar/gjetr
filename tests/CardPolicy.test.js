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

test("status maps to theme tokens, attention states loudest", () => {
  assert.equal(Card.statusTone("blocked"), "urgent")
  assert.equal(Card.statusTone("done"), "accent")
  assert.equal(Card.statusTone("working"), "foreground")
  assert.equal(Card.statusTone("idle"), "muted")
  assert.equal(Card.statusTone("unknown"), "muted")
  assert.equal(Card.statusTone("bogus"), "muted")
})

test("cache levels map to theme tokens", () => {
  assert.equal(Card.cacheTone("ok"), "muted")
  assert.equal(Card.cacheTone("warn"), "accent")
  assert.equal(Card.cacheTone("critical"), "urgent")
  assert.equal(Card.cacheTone("cold"), "muted")
  assert.equal(Card.cacheTone(undefined), "muted")
})

test("kind icons exist only for kinds Omarchy ships a mark for", () => {
  assert.equal(Card.kindIconFile("claude", false), "claude.svg")
  assert.equal(Card.kindIconFile("claude", true), "claude.svg")
  assert.equal(Card.kindIconFile("codex", false), "codex.svg")
  assert.equal(Card.kindIconFile("codex", true), "codex-light.svg")
  assert.equal(Card.kindIconFile("pi", false), "")
  assert.equal(Card.kindIconFile("__proto__", false), "")
  assert.equal(Card.kindIconFile("../x", false), "")
})

test("kindGlyph is the fallback letter", () => {
  assert.equal(Card.kindGlyph("pi", ""), "P")
  assert.equal(Card.kindGlyph("opencode", "OpenCode"), "O")
  assert.equal(Card.kindGlyph("", ""), "?")
})

test("an inline Recap makes room for two lines", () => {
  assert.equal(Card.cardHeightFor("detailed", false), Card.cardHeight("detailed"))
  assert.equal(Card.cardHeightFor("compact", true), Card.cardHeight("compact") + Card.RECAP_INLINE_PX)
})
