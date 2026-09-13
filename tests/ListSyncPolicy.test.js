"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")
const loadLib = require("./support/loadLib.cjs")

const Sync = loadLib("lib/ListSyncPolicy.js")

function check(from, to) {
  const steps = Sync.syncSteps(from, to)
  assert.deepEqual(Array.from(Sync.apply(from, steps)), to, JSON.stringify({ from, to, steps }))
  return steps
}

test("an unchanged list needs no steps", () => {
  assert.deepEqual(Array.from(check(["a", "b", "c"], ["a", "b", "c"])), [])
})

test("a re-sort moves items instead of rebuilding them", () => {
  const steps = check(["a", "b", "c", "d"], ["d", "a", "c", "b"])
  assert.ok(steps.every(s => s.op === "move"))
})

test("removals, inserts and moves together reach the target", () => {
  check(["a", "b", "c", "d"], ["e", "c", "a", "f"])
  check([], ["a", "b"])
  check(["a", "b"], [])
  check(["x"], ["y"])
})

test("random permutations with churn always converge", () => {
  let seed = 7
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
  for (let round = 0; round < 200; round++) {
    const pool = Array.from({ length: 12 }, (_, i) => "k" + i)
    const pick = () => pool.filter(() => rand() < 0.6).sort(() => rand() - 0.5)
    check(pick(), pick())
  }
})

test("duplicates and junk keys are ignored", () => {
  const steps = Sync.syncSteps(["a", "a", 5], ["b", "b", null, "a"])
  assert.deepEqual(Array.from(Sync.apply(["a"], steps)), ["b", "a"])
})
