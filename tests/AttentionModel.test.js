"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")
const loadLib = require("./support/loadLib.cjs")

const Attention = loadLib("lib/AttentionModel.js")

function agent(paneId, status, focused) {
  return { paneId, status, focused: !!focused }
}

function run(lists) {
  let model = Attention.empty()
  for (const list of lists) model = Attention.update(model, list)
  return model
}

test("the initial load never enters Attention, even for blocked and done Agents", () => {
  const model = run([[agent("a", "blocked"), agent("b", "done"), agent("c", "idle")]])
  assert.equal(Attention.count(model), 0)
})

test("a transition into blocked or done enters Attention with its tone", () => {
  const model = run([
    [agent("a", "working"), agent("b", "working"), agent("c", "working")],
    [agent("a", "blocked"), agent("b", "done"), agent("c", "idle")]
  ])
  assert.equal(Attention.attentionOf(model, "a"), "blocked")
  assert.equal(Attention.attentionOf(model, "b"), "done")
  assert.equal(Attention.attentionOf(model, "c"), "")
  assert.equal(Attention.count(model), 2)
})

test("an Agent that first appears blocked is not a transition", () => {
  const model = run([[agent("a", "idle")], [agent("a", "idle"), agent("new", "blocked")]])
  assert.equal(Attention.attentionOf(model, "new"), "")
})

test("an unchanged status keeps Attention without re-entering it", () => {
  const model = run([[agent("a", "working")], [agent("a", "done")], [agent("a", "done")], [agent("a", "done")]])
  assert.equal(Attention.attentionOf(model, "a"), "done")
})

test("herdr focusing the Agent clears Attention, and it stays clear", () => {
  const model = run([
    [agent("a", "working")],
    [agent("a", "blocked")],
    [agent("a", "blocked", true)],
    [agent("a", "blocked", false)]
  ])
  assert.equal(Attention.attentionOf(model, "a"), "")
})

test("a transition on the focused Agent does not enter Attention", () => {
  const model = run([[agent("a", "working", true)], [agent("a", "done", true)], [agent("a", "done", false)]])
  assert.equal(Attention.attentionOf(model, "a"), "")
})

test("a tap acknowledges immediately, without waiting for the snapshot", () => {
  let model = run([[agent("a", "working"), agent("b", "working")], [agent("a", "blocked"), agent("b", "done")]])
  model = Attention.acknowledge(model, "a")
  assert.equal(Attention.attentionOf(model, "a"), "")
  assert.equal(Attention.attentionOf(model, "b"), "done")
  assert.equal(Attention.acknowledge(model, "zzz"), model)
})

test("blocked then done keeps Attention and follows the tone; leaving to working keeps it until focus", () => {
  let model = run([[agent("a", "working")], [agent("a", "blocked")], [agent("a", "done")]])
  assert.equal(Attention.attentionOf(model, "a"), "done")
  model = Attention.update(model, [agent("a", "working")])
  assert.equal(Attention.attentionOf(model, "a"), "done")
})

test("a new transition after acknowledging enters again", () => {
  let model = run([[agent("a", "working")], [agent("a", "done")]])
  model = Attention.acknowledge(model, "a")
  model = Attention.update(model, [agent("a", "working")])
  model = Attention.update(model, [agent("a", "blocked")])
  assert.equal(Attention.attentionOf(model, "a"), "blocked")
})

test("Agents that go away leave Attention", () => {
  const model = run([[agent("a", "working")], [agent("a", "done")], []])
  assert.equal(Attention.count(model), 0)
})

test("junk input is tolerated and same compares Attention only", () => {
  const model = Attention.update(null, [null, {}, { paneId: "" }, agent("a", "idle")])
  assert.equal(Attention.count(model), 0)
  assert.equal(Attention.same(Attention.empty(), model), true)
  const lit = run([[agent("a", "working")], [agent("a", "done")]])
  assert.equal(Attention.same(lit, model), false)
  assert.equal(Attention.attentionOf(null, "a"), "")
})
