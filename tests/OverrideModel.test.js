"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")
const loadLib = require("./support/loadLib.cjs")

const Override = loadLib("lib/OverrideModel.js")

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

test("an empty or missing state file is no Overrides", () => {
  for (const text of [null, undefined, ""]) {
    const read = Override.parse(text)
    assert.deepEqual(plain(read.overrides), { version: 1, modules: {} })
    assert.equal(read.error, "")
  }
})

test("parse keeps valid module Overrides", () => {
  const read = Override.parse('{"version":1,"modules":{"agents#0":{"sort":"cache","focus":"window"}}}')
  assert.equal(read.error, "")
  assert.deepEqual(plain(read.overrides), { version: 1, modules: { "agents#0": { sort: "cache", focus: "window" } } })
})

test("parse drops invalid keys and values as untrusted input", () => {
  const read = Override.parse(JSON.stringify({
    version: 1,
    modules: {
      "agents#0": { sort: "random", focus: "window", colour: "red" },
      "../x#0": { sort: "cache" },
      "side#1": "cache",
      "empty#2": { sort: 5 }
    }
  }))
  assert.deepEqual(plain(read.overrides), { version: 1, modules: { "agents#0": { focus: "window" } } })
})

test("parse reports an unreadable file and starts clean", () => {
  for (const text of ["{", "[]", '{"version":2,"modules":{}}']) {
    const read = Override.parse(text)
    assert.notEqual(read.error, "", text)
    assert.deepEqual(plain(read.overrides), { version: 1, modules: {} }, text)
  }
})

test("parse ignores a __proto__ module key", () => {
  const read = Override.parse('{"version":1,"modules":{"__proto__":{"sort":"cache"}}}')
  assert.deepEqual(plain(read.overrides.modules), {})
  assert.equal(({}).sort, undefined)
})

test("moduleKey names a Module by Layout and position", () => {
  assert.equal(Override.moduleKey("agents", 0), "agents#0")
  assert.equal(Override.moduleKey("../x", 0), "")
  assert.equal(Override.moduleKey("agents", -1), "")
})

test("get returns the Override or the Config value", () => {
  const o = Override.parse('{"version":1,"modules":{"agents#0":{"sort":"cache"}}}').overrides
  assert.equal(Override.effective(o, "agents#0", "sort", "spaces"), "cache")
  assert.equal(Override.effective(o, "agents#0", "focus", "herdr"), "herdr")
  assert.equal(Override.effective(o, "side#0", "sort", "priority"), "priority")
  assert.equal(Override.effective(null, "agents#0", "sort", "priority"), "priority")
})

test("set is immutable and validates", () => {
  const empty = Override.empty()
  const next = Override.set(empty, "agents#0", "sort", "priority", "spaces")
  assert.deepEqual(plain(empty), { version: 1, modules: {} })
  assert.deepEqual(plain(next), { version: 1, modules: { "agents#0": { sort: "priority" } } })
  assert.equal(Override.set(empty, "agents#0", "sort", "bogus", "spaces"), empty)
  assert.equal(Override.set(empty, "agents#0", "colour", "red", "black"), empty)
  assert.equal(Override.set(empty, "", "sort", "cache", "spaces"), empty)
})

test("an Override equal to Config clears itself, so Config edits apply again", () => {
  let o = Override.set(Override.empty(), "agents#0", "sort", "cache", "spaces")
  o = Override.set(o, "agents#0", "sort", "spaces", "spaces")
  assert.deepEqual(plain(o), { version: 1, modules: {} })
})

test("clear removes one Module's Overrides or all of them", () => {
  let o = Override.set(Override.empty(), "agents#0", "sort", "cache", "spaces")
  o = Override.set(o, "side#0", "sort", "priority", "spaces")
  assert.deepEqual(Object.keys(Override.clear(o, "agents#0").modules), ["side#0"])
  assert.deepEqual(plain(Override.clear(o)), { version: 1, modules: {} })
})

test("serialize is stable, so equal Overrides write equal bytes", () => {
  let a = Override.set(Override.empty(), "b#0", "sort", "cache", "spaces")
  a = Override.set(a, "a#0", "focus", "window", "herdr")
  let b = Override.set(Override.empty(), "a#0", "focus", "window", "herdr")
  b = Override.set(b, "b#0", "sort", "cache", "spaces")
  assert.equal(Override.serialize(a), Override.serialize(b))
  assert.ok(Override.serialize(a).endsWith("\n"))
  assert.deepEqual(plain(Override.parse(Override.serialize(a)).overrides), plain(a))
})
