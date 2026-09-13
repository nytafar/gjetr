"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")
const loadLib = require("./support/loadLib.cjs")

const Status = loadLib("lib/StatusPolicy.js")

const STATES = ["working", "idle", "blocked", "done", "unknown"]

test("every status has its own glyph and word, so it reads without colour", () => {
  const glyphs = STATES.map(s => Status.indicator(s).glyph)
  const labels = STATES.map(s => Status.indicator(s).label)
  assert.deepEqual(glyphs, ["◌", "○", "▲", "✓", "·"])
  assert.deepEqual(labels, STATES)
  assert.equal(new Set(glyphs).size, STATES.length)
})

test("colours are theme tokens: working accent, blocked urgent, done success, unknown muted", () => {
  assert.deepEqual(STATES.map(s => Status.indicator(s).tone), ["accent", "foreground", "urgent", "success", "muted"])
})

test("idle is only dimmed, never recoloured; nothing else dims", () => {
  const idle = Status.indicator("idle")
  assert.equal(idle.tone, "foreground")
  assert.ok(idle.opacity > 0.4 && idle.opacity < 1, String(idle.opacity))
  assert.ok(idle.textOpacity > idle.opacity && idle.textOpacity < 1)
  for (const s of ["working", "blocked", "done", "unknown"]) {
    assert.equal(Status.indicator(s).opacity, 1, s)
    assert.equal(Status.indicator(s).textOpacity, 1, s)
  }
})

test("only working moves", () => {
  assert.deepEqual(STATES.map(s => Status.indicator(s).motion), ["spin", "", "", "", ""])
})

test("junk statuses show as unknown, and callers get a copy", () => {
  for (const junk of [undefined, null, "", "sleeping", "__proto__", 4]) {
    assert.equal(Status.indicator(junk).label, "unknown", String(junk))
  }
  const copy = Status.indicator("done")
  copy.glyph = "x"
  assert.equal(Status.indicator("done").glyph, "✓")
})

test("the compact preset drops the word and keeps the glyph", () => {
  assert.equal(Status.showsLabel("compact"), false)
  assert.equal(Status.showsLabel("detailed"), true)
  assert.equal(Status.showsLabel("huge"), true)
})
