"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")
const loadLib = require("./support/loadLib.cjs")

const Latest = loadLib("lib/LatestPolicy.js")

test("only the newest of two starts is accepted", () => {
  const first = Latest.start({ sequence: 0 })
  const second = Latest.start(first.guard)
  assert.equal(Latest.accepts(second.guard, first.token), false)
  assert.equal(Latest.accepts(second.guard, second.token), true)
})
