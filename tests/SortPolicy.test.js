"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")
const loadLib = require("./support/loadLib.cjs")

const Sort = loadLib("lib/SortPolicy.js")

function a(paneId, status, workspaceId) {
  return { paneId, status, workspaceId: workspaceId || paneId.split(":")[0] }
}

function ids(list) {
  return Array.from(list, (item) => item.paneId)
}

test("modes cycle spaces -> priority -> cache -> spaces", () => {
  assert.deepEqual(Array.from(Sort.MODES), ["spaces", "priority", "cache"])
  assert.equal(Sort.nextMode("spaces"), "priority")
  assert.equal(Sort.nextMode("priority"), "cache")
  assert.equal(Sort.nextMode("cache"), "spaces")
  assert.equal(Sort.nextMode("bogus"), "priority")
})

test("normalizeMode accepts only known modes", () => {
  assert.equal(Sort.normalizeMode("cache"), "cache")
  assert.equal(Sort.normalizeMode(" priority "), "priority")
  assert.equal(Sort.normalizeMode("CACHE"), "spaces")
  assert.equal(Sort.normalizeMode(undefined), "spaces")
})

test("spaces keeps herdr order and groups by workspace", () => {
  const list = [a("w1:p1", "idle"), a("w2:p1", "done"), a("w1:p2", "blocked"), a("w3:p1", "idle"), a("w2:p2", "idle")]
  assert.deepEqual(ids(Sort.sortAgents(list, "spaces")), ["w1:p1", "w1:p2", "w2:p1", "w2:p2", "w3:p1"])
})

test("priority is blocked > done > idle > working > unknown, stable", () => {
  const list = [
    a("w1:p1", "working"), a("w1:p2", "idle"), a("w1:p3", "unknown"), a("w2:p1", "done"),
    a("w2:p2", "blocked"), a("w2:p3", "idle"), a("w3:p1", "blocked"), a("w3:p2", "bogus")
  ]
  assert.deepEqual(ids(Sort.sortAgents(list, "priority")),
    ["w2:p2", "w3:p1", "w2:p1", "w1:p2", "w2:p3", "w1:p1", "w1:p3", "w3:p2"])
})

test("cache puts the most urgent live timer first, then cold, then no timer", () => {
  const list = [
    a("w1:p1", "idle"), a("w1:p2", "idle"), a("w1:p3", "blocked"), a("w2:p1", "done"),
    a("w2:p2", "idle"), a("w2:p3", "working"), a("w3:p1", "blocked")
  ]
  const remaining = { "w1:p1": 2400, "w1:p2": 90, "w2:p1": -10, "w2:p2": 0, "w2:p3": 90 }
  assert.deepEqual(ids(Sort.sortAgents(list, "cache", remaining)),
    ["w1:p2", "w2:p3", "w1:p1", "w2:p1", "w2:p2", "w1:p3", "w3:p1"])
})

test("cache breaks equal timers by priority, then herdr order", () => {
  const list = [a("w1:p1", "working"), a("w1:p2", "blocked"), a("w1:p3", "working")]
  const remaining = { "w1:p1": 300, "w1:p2": 300, "w1:p3": 300 }
  assert.deepEqual(ids(Sort.sortAgents(list, "cache", remaining)), ["w1:p2", "w1:p1", "w1:p3"])
})

test("cache without any timers is priority order", () => {
  const list = [a("w1:p1", "working"), a("w1:p2", "done")]
  assert.deepEqual(ids(Sort.sortAgents(list, "cache")), ["w1:p2", "w1:p1"])
})

test("sortAgents never mutates its input and tolerates junk", () => {
  const list = [a("w1:p1", "working"), a("w1:p2", "blocked")]
  const copy = list.slice()
  Sort.sortAgents(list, "priority")
  assert.deepEqual(list, copy)
  assert.deepEqual(Array.from(Sort.sortAgents(null, "priority")), [])
  assert.deepEqual(ids(Sort.sortAgents(list, "nonsense")), ["w1:p1", "w1:p2"])
})

test("sameOrder compares by identity, so unchanged sorts can skip a model reset", () => {
  const x = a("w1:p1", "idle")
  const y = a("w1:p2", "idle")
  assert.equal(Sort.sameOrder([x, y], [x, y]), true)
  assert.equal(Sort.sameOrder([x, y], [y, x]), false)
  assert.equal(Sort.sameOrder([x], [x, y]), false)
  assert.equal(Sort.sameOrder([x], [a("w1:p1", "idle")]), false)
  assert.equal(Sort.sameOrder(null, []), false)
})
