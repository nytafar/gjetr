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

test("priority ranks like herdr: blocked > done > working > idle > unknown", () => {
  const list = [
    a("w1:p1", "working"), a("w1:p2", "idle"), a("w1:p3", "unknown"), a("w2:p1", "done"),
    a("w2:p2", "blocked"), a("w2:p3", "idle"), a("w3:p1", "blocked"), a("w3:p2", "bogus")
  ]
  assert.deepEqual(ids(Sort.sortAgents(list, "priority")),
    ["w2:p2", "w3:p1", "w2:p1", "w1:p1", "w1:p2", "w2:p3", "w1:p3", "w3:p2"])
})

test("priority puts the most recent state change first within a rank, missing last", () => {
  const list = [
    { ...a("w1:p1", "idle"), stateChangeSeq: 344 },
    { ...a("w1:p2", "idle") },
    { ...a("w2:p1", "idle"), stateChangeSeq: 647 },
    { ...a("w2:p2", "blocked"), stateChangeSeq: 10 },
    { ...a("w3:p1", "idle"), stateChangeSeq: 508 }
  ]
  assert.deepEqual(ids(Sort.sortAgents(list, "priority")), ["w2:p2", "w2:p1", "w3:p1", "w1:p1", "w1:p2"])
})

test("priority matches herdr's live sidebar order for idle and working agents", () => {
  // From a live herdr 0.8.2 snapshot: status and state_change_seq per pane.
  const live = [
    ["w1:p2", "idle", 356], ["w1:p8", "idle", 508], ["w4:pT", "idle", 647],
    ["wA:p2", "working", 650], ["wB:p1", "working", 637], ["w2:pA", "idle", 649]
  ].map(([id, status, seq]) => ({ ...a(id, status), stateChangeSeq: seq }))
  assert.deepEqual(ids(Sort.sortAgents(live, "priority")), ["wA:p2", "wB:p1", "w2:pA", "w4:pT", "w1:p8", "w1:p2"])
})

test("cache is soonest-expiring first: least time left, then cold, then no timer", () => {
  const list = [
    a("w1:p1", "idle"), a("w1:p2", "idle"), a("w1:p3", "blocked"), a("w2:p1", "done"),
    a("w2:p2", "idle"), a("w2:p3", "working"), a("w3:p1", "blocked")
  ]
  const remaining = { "w1:p1": 2400, "w1:p2": 90, "w2:p1": -10, "w2:p2": 0, "w2:p3": 90 }
  // 90 s ties go to working over idle; cold ties go to done over idle.
  assert.deepEqual(ids(Sort.sortAgents(list, "cache", remaining)),
    ["w2:p3", "w1:p2", "w1:p1", "w2:p1", "w2:p2", "w1:p3", "w3:p1"])
})

test("cache keeps every live timer ahead of a cold one, however little is left", () => {
  const list = [a("w1:p1", "blocked"), a("w1:p2", "idle"), a("w1:p3", "idle")]
  const remaining = { "w1:p1": -3600, "w1:p2": 3599, "w1:p3": 1 }
  assert.deepEqual(ids(Sort.sortAgents(list, "cache", remaining)), ["w1:p3", "w1:p2", "w1:p1"])
})

test("cache breaks equal timers by attention, then recency, then herdr order", () => {
  const list = [
    { ...a("w1:p1", "working"), stateChangeSeq: 5 },
    { ...a("w1:p2", "blocked"), stateChangeSeq: 1 },
    { ...a("w1:p3", "working"), stateChangeSeq: 9 },
    { ...a("w1:p4", "working") }
  ]
  const remaining = { "w1:p1": 300, "w1:p2": 300, "w1:p3": 300, "w1:p4": 300 }
  assert.deepEqual(ids(Sort.sortAgents(list, "cache", remaining)), ["w1:p2", "w1:p3", "w1:p1", "w1:p4"])
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
