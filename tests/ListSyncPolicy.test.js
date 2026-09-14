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

const Layout = loadLib("lib/LayoutPolicy.js")

const agent = (paneId, extra) => Object.assign({ paneId }, extra)

test("plan fills an empty list with one insert per item and publishes its maps", () => {
  const items = [agent("a"), agent("b"), agent("c")]
  const p = Sync.plan([], items, "paneId")
  assert.deepEqual(Array.from(p.steps), [
    { op: "insert", index: 0, key: "a" },
    { op: "insert", index: 1, key: "b" },
    { op: "insert", index: 2, key: "c" }
  ])
  assert.deepEqual(Array.from(p.order), ["a", "b", "c"])
  assert.deepEqual({ ...p.index }, { a: 0, b: 1, c: 2 })
  assert.equal(p.byKey.b, items[1])
})

test("plan reorders by moves alone and indexes the new order", () => {
  const p = Sync.plan(["a", "b", "c"], [agent("c"), agent("a"), agent("b")], "paneId")
  assert.ok(p.steps.length > 0 && p.steps.every(s => s.op === "move"))
  assert.deepEqual(Array.from(Sync.apply(["a", "b", "c"], p.steps)), ["c", "a", "b"])
  assert.deepEqual({ ...p.index }, { c: 0, a: 1, b: 2 })
})

test("plan removes a middle item and reindexes the ones after it", () => {
  const p = Sync.plan(["a", "b", "c"], [agent("a"), agent("c")], "paneId")
  assert.deepEqual(Array.from(p.steps), [{ op: "remove", index: 1 }])
  assert.deepEqual({ ...p.index }, { a: 0, c: 1 })
  assert.equal(p.byKey.b, undefined)
})

test("plan keeps the first item of a duplicate key and drops items without a key", () => {
  const first = { nodeKey: "w1", n: 1 }
  const items = [first, { nodeKey: "w1", n: 2 }, { nodeKey: "t1" }, { nodeKey: 7 }, null, "w2"]
  const p = Sync.plan(["w1"], items, "nodeKey")
  assert.deepEqual(Array.from(p.order), ["w1", "t1"])
  assert.deepEqual({ ...p.index }, { w1: 0, t1: 1 })
  assert.equal(p.byKey.w1, first)
  assert.deepEqual(Array.from(Sync.apply(["w1"], p.steps)), ["w1", "t1"])
  assert.deepEqual(Array.from(Sync.plan([], "junk", "nodeKey").order), [])
})

test("plan keys are safe as object keys", () => {
  const p = Sync.plan([], [agent("__proto__"), agent("constructor")], "paneId")
  assert.deepEqual(Array.from(p.order), ["__proto__", "constructor"])
  assert.equal(p.index["__proto__"], 0)
  assert.equal(p.byKey.constructor.paneId, "constructor")
})

const rows = ["a", "b", "c", "d", "e"]

test("heldScroll with a row pitch holds the top row when rows appear above it", () => {
  // Row c (index 2) is at the top of the view; two rows open above it.
  const y = Sync.heldScroll({ before: rows, after: ["a", "x", "y", "b", "c", "d", "e"], pitch: 60, contentY: 130, viewHeight: 100 })
  assert.equal(y, 250)
})

test("heldScroll with a placement holds the top Card across a re-sort", () => {
  const before = Layout.cardPlacement(["a", "b", "c", "d"], {}, 1, 100, 0)
  const after = Layout.cardPlacement(["d", "c", "b", "a"], {}, 1, 100, 0)
  // Card c is at the top of the view (y 200, scrolled 50 into it); it moves to y 100.
  const y = Sync.heldScroll({ before, keys: ["a", "b", "c", "d"], placement: after, contentY: 250, viewHeight: 100 })
  assert.equal(y, 150)
})

test("heldScroll with a placement holds the top Card when a Card above it grows", () => {
  const keys = ["a", "b", "c", "d"]
  const before = Layout.cardPlacement(keys, {}, 1, 100, 0)
  const after = Layout.cardPlacement(keys, { a: 300 }, 1, 100, 0)
  assert.equal(Sync.heldScroll({ before, keys, placement: after, contentY: 250, viewHeight: 100 }), 450)
})

test("heldScroll leaves the view alone at the top or while it is moving", () => {
  const after = ["x", "a", "b", "c", "d", "e"]
  assert.equal(Sync.heldScroll({ before: rows, after, pitch: 60, contentY: 0, viewHeight: 100 }), 0)
  assert.equal(Sync.heldScroll({ before: rows, after, pitch: 60, contentY: 130, viewHeight: 100, moving: true }), 130)
  const placement = Layout.cardPlacement(["b", "a"], {}, 1, 100, 0)
  const before = Layout.cardPlacement(["a", "b"], {}, 1, 100, 0)
  assert.equal(Sync.heldScroll({ before, keys: ["a", "b"], placement, contentY: 0, viewHeight: 50 }), 0)
  assert.equal(Sync.heldScroll({ before, keys: ["a", "b"], placement, contentY: 120, viewHeight: 50, moving: true }), 120)
})

test("heldScroll clamps at the end of content that became shorter", () => {
  // Rows d and e go while d is at the top: b holds, then the view clamps to 2 rows.
  assert.equal(Sync.heldScroll({ before: rows, after: ["a", "b"], pitch: 60, contentY: 200, viewHeight: 100 }), 20)
  const before = Layout.cardPlacement(["a", "b", "c", "d"], { a: 400 }, 1, 100, 0)
  const after = Layout.cardPlacement(["a", "b", "c", "d"], {}, 1, 100, 0)
  // Card d was at 600 under the top edge; a shrinking moves it to 300 (held at 350),
  // and 400 of content in a 100 view leaves 300 to scroll.
  assert.equal(Sync.heldScroll({ before, keys: ["a", "b", "c", "d"], placement: after, contentY: 650, viewHeight: 100 }), 300)
})

test("heldScroll without a strategy keeps the offset", () => {
  assert.equal(Sync.heldScroll({ before: rows, after: rows, contentY: 130, viewHeight: 100 }), 130)
  assert.equal(Sync.heldScroll({}), 0)
})
