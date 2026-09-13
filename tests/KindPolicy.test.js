"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const loadLib = require("./support/loadLib.cjs")

const Kind = loadLib("lib/KindPolicy.js")

// Every agent kind herdr reports in `pane.agent`: `Agent::as_str` in herdr's
// src/detect/mod.rs, the list `herdr agent start --help` offers for `--kind`,
// captured per build in tests/fixtures/herdr-<version>/agent-kinds.json.
function fixtureKinds(version) {
  const file = path.join(__dirname, "fixtures", "herdr-" + version, "agent-kinds.json")
  return JSON.parse(fs.readFileSync(file, "utf8")).kinds
}
const HERDR_0_8_2_KINDS = fixtureKinds("0.8.2")
const HERDR_0_9_0_KINDS = fixtureKinds("0.9.0")

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

// Kinds gjetr ships a one-colour mark for in assets/kinds/.
const SHIPPED = ["pi", "gemini", "cursor", "cline", "opencode", "copilot", "kimi", "qwen", "devin", "agy",
  "mastracode", "kiro", "amp", "grok", "hermes", "kilo", "qodercli", "omp"]
const OMARCHY = ["claude", "codex"]
const LETTERS = ["droid", "maki", "muse"]

test("every kind is an Omarchy mark, a shipped mark or a letter", () => {
  assert.deepEqual([...Kind.KINDS].sort(), OMARCHY.concat(SHIPPED, LETTERS).sort())
})

test("claude and codex draw Omarchy's brand-colour SVGs, with the light variant where there is one", () => {
  assert.deepEqual({ ...Kind.kindIcon("claude", false) }, { file: "claude.svg", origin: "omarchy", tinted: false })
  assert.deepEqual({ ...Kind.kindIcon("claude", true) }, { file: "claude.svg", origin: "omarchy", tinted: false })
  assert.deepEqual({ ...Kind.kindIcon("codex", false) }, { file: "codex.svg", origin: "omarchy", tinted: false })
  assert.deepEqual({ ...Kind.kindIcon("codex", true) }, { file: "codex-light.svg", origin: "omarchy", tinted: false })
  assert.equal(Kind.kindIconFile("codex", true), "codex-light.svg")
})

test("the other kinds with a licensed logo draw gjetr's one-colour mark, in any theme", () => {
  for (const kind of SHIPPED) {
    for (const light of [false, true]) {
      assert.deepEqual({ ...Kind.kindIcon(kind, light) }, { file: kind + ".svg", origin: "gjetr", tinted: true }, kind)
    }
    assert.equal(Kind.kindIconTinted(kind), true, kind)
    assert.equal(Kind.kindMark(kind, "", false).tinted, true, kind)
  }
})

test("droid, maki and muse draw their letter", () => {
  for (const kind of LETTERS) {
    assert.deepEqual({ ...Kind.kindIcon(kind, false) }, { file: "", origin: "", tinted: false }, kind)
    assert.equal(Kind.kindIconFile(kind, false), "", kind)
    assert.equal(Kind.kindIconTinted(kind), false, kind)
  }
  for (const kind of OMARCHY) assert.equal(Kind.kindIconTinted(kind), false, kind)
})

test("kindIconUrl reads Omarchy's marks in place and gjetr's from its assets", () => {
  const omarchy = "/usr/share/omarchy"
  const assets = "file:///home/u/.config/omarchy/plugins/nytafar.gjetr/assets/kinds"
  assert.equal(Kind.kindIconUrl("claude", false, omarchy, assets), "file:///usr/share/omarchy/shell/plugins/agents/assets/claude.svg")
  assert.equal(Kind.kindIconUrl("codex", true, omarchy, assets), "file:///usr/share/omarchy/shell/plugins/agents/assets/codex-light.svg")
  assert.equal(Kind.kindIconUrl("pi", false, omarchy, assets), assets + "/pi.svg")
  assert.equal(Kind.kindIconUrl("pi", true, omarchy, assets + "/"), assets + "/pi.svg")
  assert.equal(Kind.kindIconUrl("antigravity_cli", false, omarchy, assets), assets + "/agy.svg")
  assert.equal(Kind.kindIconUrl("Kilo-Code", false, omarchy, assets), assets + "/kilo.svg")
  assert.equal(Kind.kindIconUrl("droid", false, omarchy, assets), "")
  assert.equal(Kind.kindIconUrl("aider", false, omarchy, assets), "")
  assert.equal(Kind.kindIconUrl("claude", false, "", assets), "", "no Omarchy path, no Omarchy mark")
  assert.equal(Kind.kindIconUrl("pi", false, omarchy, ""), "", "no assets URL, no shipped mark")
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
  assert.equal(Kind.kindIconFile("kiro-cli", false), "kiro.svg")
  assert.equal(Kind.kindIconTinted("Hermes-Agent"), true)
})

test("an unknown kind is never blank: its own name and first letter", () => {
  assert.equal(Kind.canonicalKind("aider"), "")
  assert.equal(Kind.kindLabel("aider"), "Aider")
  assert.equal(Kind.kindLetter("aider", ""), "A")
  assert.equal(Kind.kindLabel("aider", "Aider Chat"), "Aider Chat")
  assert.equal(Kind.kindLetter("aider", "Aider Chat"), "A")
  assert.equal(Kind.kindIconFile("aider", false), "")
  assert.equal(Kind.kindIconTinted("aider"), false)
  assert.deepEqual({ ...Kind.kindMark("", "", false) }, { kind: "", label: "", file: "", tinted: false, letter: "?" })
})

test("kind lookups ignore prototype names and paths", () => {
  for (const junk of ["__proto__", "constructor", "toString", "../x", null, undefined, 7]) {
    assert.equal(Kind.canonicalKind(junk), "", String(junk))
    assert.equal(Kind.kindIconFile(junk, false), "", String(junk))
    assert.equal(Kind.kindIconTinted(junk), false, String(junk))
    assert.equal(Kind.kindIconUrl(junk, false, "/o", "file:///g"), "", String(junk))
  }
})
