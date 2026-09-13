"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")
const loadLib = require("./support/loadLib.cjs")

const Kind = loadLib("lib/KindPolicy.js")

// Every agent kind herdr reports in `pane.agent`: `Agent::as_str` in herdr's
// src/detect/mod.rs, the same list `herdr agent start --help` offers for
// `--kind`. herdr 0.8.2 (protocol 20):
const HERDR_0_8_2_KINDS = [
  "pi", "claude", "codex", "gemini", "cursor", "devin", "agy", "cline", "omp", "mastracode", "opencode",
  "copilot", "kimi", "kiro", "droid", "amp", "grok", "hermes", "kilo", "qodercli", "qwen", "maki"
]
// herdr 0.9.0 (protocol 22) adds muse.
const HERDR_0_9_0_KINDS = HERDR_0_8_2_KINDS.concat(["muse"])

for (const [version, kinds] of [["0.8.2", HERDR_0_8_2_KINDS], ["0.9.0", HERDR_0_9_0_KINDS]]) {
  test(`every kind herdr ${version} reports has a label and a mark or a letter`, () => {
    for (const kind of kinds) {
      const mark = Kind.kindMark(kind, "", false)
      assert.equal(mark.kind, kind, kind)
      assert.ok(mark.label.length > 0, `${kind} has a label`)
      assert.notEqual(mark.label, kind, `${kind} has a written label, not its id`)
      assert.ok(mark.file !== "" || mark.letter !== "", `${kind} has a mark or a letter`)
      assert.equal(Array.from(mark.letter).length, 1, `${kind} letter is one character`)
    }
  })
}

test("the table covers exactly the kinds herdr reports", () => {
  assert.deepEqual([...Kind.KINDS].sort(), [...HERDR_0_9_0_KINDS].sort())
})

test("kinds drawn as a letter each get a different letter", () => {
  const seen = {}
  for (const kind of Kind.KINDS) {
    if (Kind.kindIconFile(kind, false) !== "") continue
    const letter = Kind.kindLetter(kind, "")
    assert.equal(seen[letter], undefined, `${kind} and ${seen[letter]} share ${letter}`)
    seen[letter] = kind
  }
})

test("marks are the SVGs Omarchy ships, with the light variant where there is one", () => {
  assert.equal(Kind.kindIconFile("claude", false), "claude.svg")
  assert.equal(Kind.kindIconFile("claude", true), "claude.svg")
  assert.equal(Kind.kindIconFile("codex", false), "codex.svg")
  assert.equal(Kind.kindIconFile("codex", true), "codex-light.svg")
  for (const kind of Kind.KINDS.filter(k => k !== "claude" && k !== "codex")) assert.equal(Kind.kindIconFile(kind, false), "", kind)
})

test("labels read as the product is called", () => {
  assert.equal(Kind.kindLabel("claude"), "Claude")
  assert.equal(Kind.kindLabel("agy"), "Antigravity")
  assert.equal(Kind.kindLabel("omp"), "Oh My Pi")
  assert.equal(Kind.kindLabel("copilot"), "GitHub Copilot")
  assert.equal(Kind.kindLabel("muse"), "Muse")
})

test("herdr's aliases for a kind resolve to it, whatever the case", () => {
  assert.equal(Kind.canonicalKind("antigravity_cli"), "agy")
  assert.equal(Kind.canonicalKind("Antigravity-CLI"), "agy")
  assert.equal(Kind.canonicalKind(" github-copilot "), "copilot")
  assert.equal(Kind.canonicalKind("kiro-cli"), "kiro")
  assert.equal(Kind.canonicalKind("mastra code"), "mastracode")
  assert.equal(Kind.kindLabel("claude-code"), "Claude")
  assert.equal(Kind.kindIconFile("CLAUDE", false), "claude.svg")
})

test("an unknown kind is never blank: its own name and first letter", () => {
  assert.equal(Kind.canonicalKind("aider"), "")
  assert.equal(Kind.kindLabel("aider"), "Aider")
  assert.equal(Kind.kindLetter("aider", ""), "A")
  assert.equal(Kind.kindLabel("aider", "Aider Chat"), "Aider Chat")
  assert.equal(Kind.kindLetter("aider", "Aider Chat"), "A")
  assert.equal(Kind.kindIconFile("aider", false), "")
  assert.deepEqual({ ...Kind.kindMark("", "", false) }, { kind: "", label: "", file: "", letter: "?" })
})

test("kind lookups ignore prototype names and paths", () => {
  for (const junk of ["__proto__", "constructor", "toString", "../x", null, undefined, 7]) {
    assert.equal(Kind.canonicalKind(junk), "", String(junk))
    assert.equal(Kind.kindIconFile(junk, false), "", String(junk))
  }
})
