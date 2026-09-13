"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")
const loadLib = require("./support/loadLib.cjs")

const Name = loadLib("lib/NamePolicy.js")

function agent(fields) {
  return {
    paneId: "w1:p1", tabId: "w1:t1", workspaceId: "w1", kind: "claude", displayKind: "claude",
    status: "idle", title: "", paneLabel: "", cwd: "", focused: false,
    tabLabel: "", tabNumber: 1, workspaceLabel: "", workspaceNumber: 1,
    ...fields
  }
}

test("herdr's agent name wins over pane label and title", () => {
  assert.equal(Name.agentName(agent({ name: "touchdisplay", paneLabel: "reviewer", title: "Noracle review" })), "touchdisplay")
  assert.equal(Name.agentName(agent({ name: "claude", title: "Fix bug" })), "claude", "a name that matches the kind is still the user's name")
})

test("an empty or missing herdr name leaves the Agent named as before", () => {
  assert.equal(Name.agentName(agent({ name: " ", paneLabel: "reviewer" })), "reviewer")
  assert.equal(Name.agentName(agent({ name: null, title: "Fix bug" })), "Fix bug")
  assert.equal(Name.agentName(agent({ title: "Fix bug" })), "Fix bug")
})

test("pane label wins when present", () => {
  assert.equal(Name.agentName(agent({ paneLabel: "reviewer", title: "Noracle review", tabLabel: "efforts" })), "reviewer")
})

test("terminal title comes next", () => {
  assert.equal(Name.agentName(agent({ title: "Noracle codebase review", tabLabel: "efforts", workspaceLabel: "hvelv" })), "Noracle codebase review")
})

test("a generic agent title is not a name", () => {
  const a = agent({ title: "Claude Code", tabLabel: "efforts", workspaceLabel: "hvelv" })
  assert.equal(Name.agentName(a), "efforts")
  assert.equal(Name.agentName(agent({ title: "claude", workspaceLabel: "hvelv" })), "hvelv")
  assert.equal(Name.agentName(agent({ kind: "codex", displayKind: "Codex", title: "codex", workspaceLabel: "hvelv" })), "hvelv")
})

test("a renamed tab label comes before the workspace label", () => {
  assert.equal(Name.agentName(agent({ tabLabel: "noracle fiken", tabNumber: 4, workspaceLabel: "hvelv" })), "noracle fiken")
})

test("a tab label that is still its default number is skipped", () => {
  // herdr's default tab label is the tab's position, which differs from the
  // tab `number` (an id counter): live snapshot tab w4:tA has label "2", number 10.
  assert.equal(Name.agentName(agent({ tabLabel: "2", tabNumber: 10, workspaceLabel: "inbox" })), "inbox")
  assert.equal(Name.agentName(agent({ tabLabel: "1", tabNumber: 1, workspaceLabel: "inbox" })), "inbox")
})

test("cwd basename is the last resort before the kind", () => {
  assert.equal(Name.agentName(agent({ cwd: "/home/lasse/code/nytafar/gjetr/" })), "gjetr")
  assert.equal(Name.agentName(agent({ cwd: "/" })), "/")
  assert.equal(Name.agentName(agent({})), "claude")
  assert.equal(Name.agentName(agent({ kind: "", displayKind: "" })), "w1:p1")
})

test("whitespace-only sources are skipped", () => {
  assert.equal(Name.agentName(agent({ paneLabel: "  ", title: " \t", workspaceLabel: " work " })), "work")
})

test("agentName tolerates junk", () => {
  assert.equal(Name.agentName(null), "")
  assert.equal(Name.agentName({}), "")
})

test("isRenamedTab", () => {
  assert.equal(Name.isRenamedTab("efforts", 2), true)
  assert.equal(Name.isRenamedTab("3", 3), false)
  assert.equal(Name.isRenamedTab("2", 10), false)
  assert.equal(Name.isRenamedTab("", 1), false)
  assert.equal(Name.isRenamedTab("v2", 2), true)
})

test("basename", () => {
  assert.equal(Name.basename("/home/lasse"), "lasse")
  assert.equal(Name.basename("relative/dir//"), "dir")
  assert.equal(Name.basename("/"), "/")
  assert.equal(Name.basename(""), "")
  assert.equal(Name.basename(undefined), "")
})

test("location is workspace › tab, falling back to numbers", () => {
  assert.equal(Name.location(agent({ workspaceLabel: "hvelv", tabLabel: "efforts" })), "hvelv › efforts")
  assert.equal(Name.location(agent({ workspaceLabel: "inbox", tabLabel: "2", tabNumber: 10 })), "inbox › 2")
  assert.equal(Name.location(agent({ workspaceLabel: "", workspaceNumber: 3, tabLabel: "", tabNumber: 4 })), "3 › 4")
  assert.equal(Name.location(null), "")
})
