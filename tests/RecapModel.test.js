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
