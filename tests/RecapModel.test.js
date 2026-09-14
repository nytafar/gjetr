"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")
const loadLib = require("./support/loadLib.cjs")

const Recap = loadLib("lib/RecapModel.js")

const ID = "cf43ca7f-58ec-4ecd-a3ae-8efb244388cc"
const DIR = "/home/test/.claude/projects"

function line(fields) {
  return JSON.stringify(Object.assign({ parentUuid: "x", isSidechain: false, type: "system", subtype: "away_summary",
    content: "Wrote the Deck.", timestamp: "2026-09-13T11:00:00.000Z", sessionId: ID }, fields))
}

test("session ids are lowercase UUIDs", () => {
  assert.equal(Recap.isSessionId(ID), true)
  for (const bad of ["", "../x", ID.toUpperCase(), ID + "0", null]) assert.equal(Recap.isSessionId(bad), false, String(bad))
})

test("transcript paths sit one directory below the projects dir", () => {
  assert.equal(Recap.projectsDir("/home/test/"), DIR)
  assert.equal(Recap.isTranscriptPath(`${DIR}/-home-test-code/${ID}.jsonl`, DIR, ID), true)
  assert.equal(Recap.isTranscriptPath(`${DIR}/${ID}.jsonl`, DIR, ID), false)
  assert.equal(Recap.isTranscriptPath(`${DIR}/a/b/${ID}.jsonl`, DIR, ID), false)
  assert.equal(Recap.isTranscriptPath(`${DIR}/../${ID}.jsonl`, DIR, ID), false)
  assert.equal(Recap.isTranscriptPath(`/elsewhere/p/${ID}.jsonl`, DIR, ID), false)
})

test("parseLocate picks the matching find line", () => {
  const text = `find: '/x': Permission denied\n${DIR}/-home-test/${ID}.jsonl\n${DIR}/-home-test-2/${ID}.jsonl\n`
  assert.equal(Recap.parseLocate(text, DIR, ID), `${DIR}/-home-test/${ID}.jsonl`)
  assert.equal(Recap.parseLocate("", DIR, ID), "")
})

test("parseStat keeps only the paths asked about", () => {
  const p = `${DIR}/-home-test/${ID}.jsonl`
  const stamps = Recap.parseStat(`1789297000 52311 ${p}\n1 2 /etc/passwd\n`, [p])
  assert.deepEqual({ ...stamps }, { [p]: "1789297000 52311" })
})

test("latestRecap returns the last away_summary", () => {
  const text = [line({ content: "First." }), line({ content: "Second recap.", timestamp: "2026-09-13T12:00:00.000Z" })].join("\n")
  assert.deepEqual({ ...Recap.latestRecap(text, ID) }, { text: "Second recap.", timestamp: "2026-09-13T12:00:00.000Z" })
})

test("latestRecap skips partial, foreign and empty lines", () => {
  const text = [
    line({ content: "Good one." }),
    line({ subtype: "compact_boundary", content: "no" }),
    line({ sessionId: "00000000-0000-0000-0000-000000000000", content: "other session" }),
    line({ content: "   " }),
    '{"type":"system","subtype":"away_summary","content":"trunc'
  ].join("\n")
  assert.equal(Recap.latestRecap(text, ID).text, "Good one.")
  assert.equal(Recap.latestRecap("", ID), null)
  assert.equal(Recap.latestRecap("not json", ID), null)
})

test("recap text is cleaned as untrusted input", () => {
  const esc = String.fromCharCode(27)
  const rlo = String.fromCharCode(0x202e)
  const nul = String.fromCharCode(0)
  const hostile = "Line one\n" + esc + "[31mred" + esc + "[0m <b>bold</b>" + rlo + "evil" + nul + " " + "x".repeat(2000)
  const out = Recap.latestRecap(line({ content: hostile }), ID).text
  assert.equal(/[\u0000-\u001f\u202e]/.test(out), false)
  assert.match(out, /^Line one \[31mred \[0m <b>bold<\/b> evil x/)
  assert.ok(out.length <= Recap.MAX_CHARS)
  assert.ok(out.endsWith("\u2026"))
})

test("modes are off, inline and expand, default off", () => {
  assert.deepEqual(Array.from(Recap.MODES), ["off", "inline", "expand"])
  assert.equal(Recap.normalizeMode("expand"), "expand")
  assert.equal(Recap.normalizeMode("loud"), "off")
})

test("a Recap opens in the card or an overlay, default card", () => {
  assert.deepEqual(Array.from(Recap.OPEN_MODES), ["card", "overlay"])
  assert.equal(Recap.DEFAULT_OPEN, "card")
  assert.equal(Recap.normalizeOpen("overlay"), "overlay")
  assert.equal(Recap.normalizeOpen("popup"), "card")
})

test("open Recaps are toggled per Module and pane, several at once", () => {
  let open = Recap.emptyOpen()
  open = Recap.toggleOpen(open, "triage#0", "w1:p2")
  open = Recap.toggleOpen(open, "triage#0", "w4:pT")
  open = Recap.toggleOpen(open, "wide#0", "w1:p2")
  assert.equal(Recap.isOpen(open, "triage#0", "w1:p2"), true)
  assert.equal(Recap.isOpen(open, "triage#0", "w4:pT"), true)
  assert.equal(Recap.isOpen(open, "cache#0", "w1:p2"), false)
  assert.deepEqual(Array.from(Recap.openPanes(open, "triage#0")), ["w1:p2", "w4:pT"])
  const before = open
  open = Recap.toggleOpen(open, "triage#0", "w1:p2")
  assert.equal(Recap.isOpen(open, "triage#0", "w1:p2"), false)
  assert.equal(Recap.isOpen(before, "triage#0", "w1:p2"), true, "toggling returns a new state")
  assert.deepEqual(Array.from(Recap.openPanes(open, "triage#0")), ["w4:pT"])
  assert.deepEqual(Array.from(Recap.openPanes(Recap.toggleOpen(open, "wide#0", "w1:p2"), "wide#0")), [])
})

test("open state ignores junk keys and prototype names", () => {
  const open = Recap.emptyOpen()
  assert.equal(Recap.toggleOpen(open, "", "w1:p2"), open)
  assert.equal(Recap.toggleOpen(open, "triage#0", ""), open)
  assert.equal(Recap.toggleOpen(open, "triage#0", 5), open)
  assert.equal(Recap.isOpen(open, "triage#0", "__proto__"), false)
  assert.equal(Recap.isOpen(null, "triage#0", "w1:p2"), false)
  assert.equal(Recap.isOpen(Recap.toggleOpen(open, "__proto__", "constructor"), "__proto__", "constructor"), true)
  assert.equal(({}).constructor === Object, true)
})

test("pruneOpen drops panes that are gone and keeps the state when nothing changed", () => {
  let open = Recap.toggleOpen(Recap.toggleOpen(Recap.emptyOpen(), "triage#0", "w1:p2"), "wide#0", "w9:p1")
  assert.equal(Recap.pruneOpen(open, ["w1:p2", "w9:p1", "w3:p3"]), open)
  const pruned = Recap.pruneOpen(open, ["w1:p2"])
  assert.deepEqual(Array.from(Recap.openPanes(pruned, "triage#0")), ["w1:p2"])
  assert.deepEqual(Array.from(Recap.openPanes(pruned, "wide#0")), [])
  assert.deepEqual(Object.keys(pruned), ["triage#0"])
})

// step: the Recap pipeline, driven by a script of events.

const HOME = "/home/test"
const ID2 = "0d6f1f3e-2b7a-4c1e-9a55-3f0c5b6d7e8f"

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

function transcript(id, project) {
  return `${DIR}/${project || "-home-test"}/${id}.jsonl`
}

function find(id) {
  return ["find", DIR, "-mindepth", "2", "-maxdepth", "2", "-type", "f", "-name", id + ".jsonl"]
}

test("step: Agents arriving locate each Claude session once; other kinds and bad ids are left alone", () => {
  const agents = [{ kind: "claude", sessionId: ID }, { kind: "claude", sessionId: ID }, { kind: "codex", sessionId: ID2 },
    { kind: "claude", sessionId: "../etc" }, { kind: "claude", sessionId: ID2 }]
  const out = Recap.step(Recap.initial(HOME), { type: "agents", agents }, 1000)
  assert.deepEqual(plain(out.commands), [{ id: "locate:" + ID, argv: find(ID) }, { id: "locate:" + ID2, argv: find(ID2) }])
})

test("step: a located transcript is statted at once, a changed one grepped, and its Recap published", () => {
  const agents = [{ kind: "claude", sessionId: ID }, { kind: "claude", sessionId: ID2 }]
  let out = Recap.step(Recap.initial(HOME), { type: "agents", agents }, 1000)
  // The second find answers first.
  out = Recap.step(out.state, { type: "reply", id: "locate:" + ID2, text: transcript(ID2, "-b") + "\n", code: 0 }, 1100)
  assert.deepEqual(plain(out.commands), [{ id: "stat", argv: ["stat", "-c", "%Y %s %n", "--", transcript(ID2, "-b")] }])
  // While that stat runs, the other find's answer starts no second stat.
  out = Recap.step(out.state, { type: "reply", id: "locate:" + ID, text: transcript(ID) + "\n", code: 0 }, 1150)
  assert.deepEqual(plain(out.commands), [])
  out = Recap.step(out.state, { type: "reply", id: "stat", text: `1789297000 52311 ${transcript(ID2, "-b")}\n`, code: 0 }, 1200)
  assert.deepEqual(plain(out.commands), [{ id: "grep:" + ID2, argv: ["grep", "-F", "--", '"subtype":"away_summary"', transcript(ID2, "-b")] }])
  out = Recap.step(out.state, { type: "reply", id: "grep:" + ID2, text: line({ sessionId: ID2, content: "Wrote the driver." }), code: 0 }, 1300)
  assert.equal(out.state.recaps[ID2].text, "Wrote the driver.")
  const recaps = out.state.recaps

  // Next poll: both transcripts, only the unchanged one's stamp is kept as is.
  out = Recap.step(out.state, { type: "tick" }, 6000)
  assert.deepEqual(plain(out.commands), [{ id: "stat", argv: ["stat", "-c", "%Y %s %n", "--", transcript(ID), transcript(ID2, "-b")] }])
  out = Recap.step(out.state, { type: "reply", id: "stat",
    text: `1789297100 100 ${transcript(ID)}\n1789297000 52311 ${transcript(ID2, "-b")}\n`, code: 0 }, 6100)
  assert.deepEqual(plain(out.commands.map(c => c.id)), ["grep:" + ID])
  // The same Recap read again changes nothing a binding reads.
  out = Recap.step(out.state, { type: "reply", id: "grep:" + ID2, text: line({ sessionId: ID2, content: "Wrote the driver." }), code: 0 }, 6200)
  assert.equal(out.state.recaps, recaps)
  const settled = out.state
  assert.equal(Recap.step(settled, { type: "reply", id: "stat", text: "", code: 0 }, 6300).state, settled, "no stat was in flight")
})

test("step: a session not found is looked for again only after 60 s", () => {
  let out = Recap.step(Recap.initial(HOME), { type: "agents", agents: [{ kind: "claude", sessionId: ID }] }, 1000)
  out = Recap.step(out.state, { type: "reply", id: "locate:" + ID, text: "", code: 0 }, 1100)
  assert.deepEqual(plain(out.commands), [])
  assert.deepEqual(plain(Recap.step(out.state, { type: "tick" }, 60000).commands), [])
  assert.deepEqual(plain(Recap.step(out.state, { type: "tick" }, 61001).commands), [{ id: "locate:" + ID, argv: find(ID) }])
})

test("step: grep finding no recap yet (exit 1), or failing, leaves the Recap as it was", () => {
  let out = Recap.step(Recap.initial(HOME), { type: "agents", agents: [{ kind: "claude", sessionId: ID }] }, 1000)
  out = Recap.step(out.state, { type: "reply", id: "locate:" + ID, text: transcript(ID), code: 0 }, 1100)
  out = Recap.step(out.state, { type: "reply", id: "stat", text: `1 2 ${transcript(ID)}`, code: 0 }, 1200)
  out = Recap.step(out.state, { type: "reply", id: "grep:" + ID, text: line({ content: "First." }), code: 0 }, 1300)
  const before = out.state
  assert.equal(Recap.step(before, { type: "reply", id: "grep:" + ID, text: "", code: 1 }, 1400).state, before)
  assert.equal(Recap.step(before, { type: "reply", id: "grep:" + ID, text: line({ content: "Other." }), code: 2 }, 1400).state, before)
  assert.equal(before.recaps[ID].text, "First.")
})

test("step: 65 located transcripts are statted 64 at a time", () => {
  const ids = Array.from({ length: 65 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`)
  let out = Recap.step(Recap.initial(HOME), { type: "agents", agents: ids.map(id => ({ kind: "claude", sessionId: id })) }, 1000)
  assert.equal(out.commands.length, 65)
  for (const id of ids.slice(0, 64)) out = Recap.step(out.state, { type: "reply", id: "locate:" + id, text: transcript(id), code: 0 }, 1100)
  out = Recap.step(out.state, { type: "reply", id: "stat", text: "", code: 0 }, 1200)
  out = Recap.step(out.state, { type: "reply", id: "locate:" + ids[64], text: transcript(ids[64]), code: 0 }, 1300)
  assert.deepEqual(plain(out.commands.map(c => c.id)), ["stat"])
  assert.equal(out.commands[0].argv.length, 4 + 64)
  assert.equal(out.commands[0].argv.includes(transcript(ids[64])), false)
})
