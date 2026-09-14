"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")
const loadLib = require("./support/loadLib.cjs")

const CardModel = loadLib("lib/CardModel.js")

const NOW = 1789400000
const CWD = "/home/test/code/gjetr"

function agent(fields) {
  return Object.assign({ paneId: "wB:p9", status: "working", kind: "claude", displayKind: "", name: "GitHub issue #2 in gjetr",
    workspaceId: "wB", workspaceLabel: "herdr-panel", tabNumber: 4, cwd: CWD, sessionId: "s-1", focused: false }, fields)
}

function facts(fields) {
  return Object.assign({ recaps: {}, repos: { [CWD]: { repo: "gjetr", branch: "main", detached: false } },
    attention: { attention: {} }, cacheTimers: { "wB:p9": { lastTurn: NOW - 30, ttlSeconds: 3600 } },
    cacheSettings: undefined, recapOpen: {}, focusedWorkspaceId: "wB", home: "/home/test", lightBackground: false,
    moduleKey: "agents#0", densityName: "comfortable" }, fields)
}

test("summary is the state IPC card, as recorded from a live state call", () => {
  const card = CardModel.build(agent({}), { preset: "detailed" }, facts({}), NOW)
  assert.equal(JSON.stringify(CardModel.summary(card)),
    '{"paneId":"wB:p9","status":"working","attention":"","recap":false,"inFocusedWorkspace":true,' +
    '"name":"GitHub issue #2 in gjetr","kind":"claude","kindLabel":"Claude","kindMark":"claude.svg",' +
    '"location":"herdr-panel › 4","repo":"gjetr  main","cache":"59m ok"}')
})

test("no Agent is the empty Card", () => {
  assert.equal(CardModel.build(null, { preset: "detailed" }, facts({}), NOW), CardModel.EMPTY)
  assert.equal(CardModel.EMPTY.name, "")
  assert.equal(CardModel.EMPTY.cache, null)
  assert.equal(CardModel.EMPTY.recap.shown, false)
})

test("each status resolves its glyph, word and mark by tone name", () => {
  const expected = {
    working: { glyph: "◌", word: "working", tone: "accent", markTone: "accent", motion: "sweep" },
    idle: { glyph: "○", word: "idle", tone: "foreground", markTone: "foreground", motion: "" },
    blocked: { glyph: "▲", word: "blocked", tone: "urgent", markTone: "urgent", motion: "flash" },
    done: { glyph: "✓", word: "done", tone: "success", markTone: "success", motion: "" },
    unknown: { glyph: "·", word: "unknown", tone: "muted", markTone: "muted", motion: "" }
  }
  for (const [status, want] of Object.entries(expected)) {
    const card = CardModel.build(agent({ status }), { preset: "detailed" }, facts({}), NOW)
    assert.deepEqual({ glyph: card.indicator.glyph, word: card.indicator.label, tone: card.indicator.tone,
      markTone: card.mark.tone, motion: card.mark.motion }, want, status)
  }
})

test("a done Agent in Attention pulses its mark; blocked Attention is urgent, done is accent", () => {
  const done = CardModel.build(agent({ status: "done" }), {}, facts({ attention: { attention: { "p:wB:p9": "done" } } }), NOW)
  assert.equal(done.attention, "done")
  assert.equal(done.attentionTone, "accent")
  assert.equal(done.mark.motion, "pulse")
  const blocked = CardModel.build(agent({ status: "blocked" }), {}, facts({ attention: { attention: { "p:wB:p9": "blocked" } } }), NOW)
  assert.equal(blocked.attention, "blocked")
  assert.equal(blocked.attentionTone, "urgent")
  const none = CardModel.build(agent({ status: "done" }), {}, facts({}), NOW)
  assert.equal(none.attention, "")
  assert.equal(none.mark.motion, "")
})

test("a kind with an icon names its file; one without falls back to its letter", () => {
  const claude = CardModel.build(agent({}), {}, facts({}), NOW)
  assert.equal(claude.kindIconFile, "claude.svg")
  assert.equal(CardModel.summary(claude).kindMark, "claude.svg")
  const codexLight = CardModel.build(agent({ kind: "codex" }), {}, facts({ lightBackground: true }), NOW)
  assert.equal(codexLight.kindIconFile, "codex-light.svg")
  const aider = CardModel.build(agent({ kind: "aider", displayKind: "" }), {}, facts({}), NOW)
  assert.equal(aider.kindIconFile, "")
  assert.equal(aider.kindGlyph, "A")
  assert.equal(CardModel.summary(aider).kindMark, "A")
})

test("the Cache timer at each level, and absent", () => {
  const at = (remaining, densityName) => CardModel.build(agent({}), {},
    facts({ densityName, cacheTimers: { "wB:p9": { lastTurn: NOW - (3600 - remaining), ttlSeconds: 3600 } } }), NOW)
  const rows = [
    [1800, "comfortable", "30m", "ok", "muted", "success"],
    [1800, "full", "30m", "ok", "foreground", "success"],
    [500, "comfortable", "8:20", "warn", "accent", "accent"],
    [100, "compact", "1:40", "critical", "urgent", "urgent"],
    [-5, "comfortable", "cold", "cold", "muted", "muted"]
  ]
  for (const [remaining, density, label, level, tone, barTone] of rows) {
    const card = at(remaining, density)
    assert.deepEqual([card.cache.label, card.cache.level, card.cacheTone, card.cacheBarTone], [label, level, tone, barTone],
      remaining + " " + density)
  }
  const none = CardModel.build(agent({}), {}, facts({ cacheTimers: {} }), NOW)
  assert.equal(none.cache, null)
  assert.equal(CardModel.summary(none).cache, "")
})

test("a Recap is shown in the Card by one rule across modes, open state and Density", () => {
  const recaps = { "s-1": { text: "Fixed the parser." } }
  const open = { "agents#0": { "wB:p9": true } }
  // [recap, recap_open, open, density] -> [expandable, inline, shown]
  const rows = [
    ["expand", "card", true, "comfortable", true, false, true],
    ["expand", "card", true, "compact", true, false, true],
    ["expand", "card", true, "full", true, false, true],
    ["expand", "card", false, "compact", true, false, false],
    ["inline", "card", true, "comfortable", false, true, false],
    ["inline", "card", true, "compact", false, true, true],
    ["inline", "card", true, "full", false, true, true],
    ["inline", "card", false, "full", false, true, false],
    ["expand", "overlay", true, "compact", true, false, false],
    ["off", "card", true, "compact", false, false, false]
  ]
  for (const [mode, openMode, isOpen, densityName, expandable, inline, shown] of rows) {
    const card = CardModel.build(agent({}), { recap: mode, recapOpen: openMode },
      facts({ recaps, densityName, recapOpen: isOpen ? open : {} }), NOW)
    assert.deepEqual([card.recap.expandable, card.recap.inline, card.recap.shown], [expandable, inline, shown],
      [mode, openMode, isOpen, densityName].join(" "))
    assert.equal(card.recap.text, "Fixed the parser.")
  }
  const without = CardModel.build(agent({}), { recap: "expand", recapOpen: "card" }, facts({ recapOpen: open }), NOW)
  assert.deepEqual([without.recap.text, without.recap.expandable, without.recap.shown], ["", false, false])
  assert.equal(CardModel.summary(without).recap, false)
})

test("the Focused workspace: hit, miss, and highlight_workspace off", () => {
  const hit = CardModel.build(agent({}), {}, facts({}), NOW)
  assert.deepEqual([hit.inFocusedWorkspace, hit.highlighted], [true, true])
  const miss = CardModel.build(agent({ workspaceId: "w1" }), {}, facts({}), NOW)
  assert.deepEqual([miss.inFocusedWorkspace, miss.highlighted], [false, false])
  const off = CardModel.build(agent({}), { highlightWorkspace: false }, facts({}), NOW)
  assert.deepEqual([off.inFocusedWorkspace, off.highlighted], [true, false])
})

test("the preset chooses the Fields and the status word; indicator = icon hides the glyph", () => {
  const compact = CardModel.build(agent({}), { preset: "compact" }, facts({}), NOW)
  assert.equal(compact.fields.location, false)
  assert.equal(compact.showStatusWord, false)
  const detailed = CardModel.build(agent({}), {}, facts({}), NOW)
  assert.equal(detailed.fields.location, true)
  assert.equal(detailed.showStatusWord, true)
  assert.equal(detailed.showGlyph, true)
  assert.equal(detailed.marksState, false)
  const icon = CardModel.build(agent({}), { indicator: "icon" }, facts({}), NOW)
  assert.equal(icon.showGlyph, false)
  assert.equal(icon.marksState, true)
})

test("name, location and Repo outside a repository", () => {
  const card = CardModel.build(agent({ name: "", paneLabel: "reviewer", cwd: "/home/test/scratch/x", tabNumber: 2 }), {},
    facts({}), NOW)
  assert.equal(card.name, "reviewer")
  assert.equal(card.location, "herdr-panel › 2")
  assert.equal(card.repo.text, "~/scratch/x")
})
