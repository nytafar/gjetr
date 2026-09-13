"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")
const loadLib = require("./support/loadLib.cjs")

const Tree = loadLib("lib/WorkspaceTreeModel.js")

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

function pane(paneId, tabId, fields) {
  const workspaceId = tabId.split(":")[0]
  return Object.assign({
    paneId, tabId, workspaceId, kind: "", displayKind: "", status: "unknown", title: "", paneLabel: "",
    cwd: "", focused: false, tabLabel: "", tabNumber: 0, workspaceLabel: "", workspaceNumber: 0
  }, fields, fields.kind ? { displayKind: fields.displayKind || fields.kind } : {})
}

const tree = {
  focusedWorkspaceId: "w2",
  focusedTabId: "w2:t1",
  focusedPaneId: "w2:p1",
  workspaces: [
    { workspaceId: "w1", label: "~", number: 1, status: "", tabs: [
      { tabId: "w1:t1", workspaceId: "w1", label: "1", number: 1, status: "", panes: [
        pane("w1:p1", "w1:t1", { kind: "claude", status: "blocked", title: "Fix build", tabLabel: "1", tabNumber: 1 })
      ] },
      { tabId: "w1:t2", workspaceId: "w1", label: "logs", number: 3, status: "", panes: [
        pane("w1:p2", "w1:t2", { status: "unknown", title: "lasse@oma:~", tabLabel: "logs", tabNumber: 3 }),
        pane("w1:p3", "w1:t2", { kind: "codex", status: "working", title: "codex", tabLabel: "logs", tabNumber: 3 })
      ] }
    ] },
    { workspaceId: "w2", label: "", number: 2, status: "idle", tabs: [
      { tabId: "w2:t1", workspaceId: "w2", label: "", number: 4, status: "", panes: [
        pane("w2:p1", "w2:t1", { status: "unknown", cwd: "/home/x/code/gjetr", focused: true, tabNumber: 4, workspaceNumber: 2 })
      ] }
    ] }
  ]
}

const noAttention = { statuses: {}, attention: {} }

function open(keys) {
  let state = Tree.emptyExpanded()
  for (const key of keys) state = Tree.toggleExpanded(state, "ws#0", key)
  return state
}

test("collapsed, the tree is one row per workspace with its rolled-up status and tab count", () => {
  const rows = plain(Tree.rows(tree, open([]), "ws#0", noAttention))
  assert.deepEqual(rows.map(r => [r.key, r.type, r.depth, r.label, r.detail, r.status, r.expandable, r.expanded, r.focused]), [
    ["w:w1", "workspace", 0, "~", "2 tabs", "blocked", true, false, false],
    ["w:w2", "workspace", 0, "2", "1 tab", "idle", true, false, true]
  ])
})

test("herdr's own rolled-up status wins over the computed one", () => {
  // herdr's attention order: blocked, done, working, idle, unknown.
  assert.equal(Tree.rollupStatus(["idle", "unknown", "working"]), "working")
  assert.equal(Tree.rollupStatus(["idle", "working", "done"]), "done")
  assert.equal(Tree.rollupStatus(["blocked", "done"]), "blocked")
  assert.equal(Tree.rollupStatus([]), "unknown")
  assert.equal(Tree.rows(tree, open([]), "ws#0", noAttention)[1].status, "idle")
})

test("an expanded workspace shows its tabs: a one-pane tab is a leaf naming its agent's kind", () => {
  const rows = plain(Tree.rows(tree, open(["w:w1"]), "ws#0", noAttention))
  assert.deepEqual(rows.map(r => r.key), ["w:w1", "t:w1:t1", "t:w1:t2", "w:w2"])
  const single = rows[1]
  assert.deepEqual([single.type, single.depth, single.label, single.detail, single.status, single.expandable, single.paneId, single.kind],
    ["tab", 1, "1", "Claude", "blocked", false, "w1:p1", "claude"])
  const multi = rows[2]
  assert.deepEqual([multi.label, multi.detail, multi.status, multi.expandable, multi.paneId], ["logs", "2 panes", "working", true, ""])
})

test("an expanded tab shows its panes, with shells included and named like Agents", () => {
  const rows = plain(Tree.rows(tree, open(["w:w1", "t:w1:t2"]), "ws#0", noAttention))
  assert.deepEqual(rows.map(r => r.key), ["w:w1", "t:w1:t1", "t:w1:t2", "p:w1:p2", "p:w1:p3", "w:w2"])
  assert.deepEqual([rows[3].type, rows[3].depth, rows[3].name, rows[3].kindLabel, rows[3].isAgent, rows[3].expandable],
    ["pane", 2, "lasse@oma:~", "shell", false, false])
  // A generic title falls through to the renamed tab label, as on a Card.
  assert.deepEqual([rows[4].name, rows[4].kindLabel, rows[4].isAgent, rows[4].status], ["logs", "Codex", true, "working"])
})

test("a pane with herdr's agent name is named by it, as a Card is", () => {
  const named = plain(tree)
  named.workspaces[0].tabs[1].panes[1].name = "reviewer"
  const rows = plain(Tree.rows(named, open(["w:w1", "t:w1:t2"]), "ws#0", noAttention))
  assert.equal(rows.find(r => r.key === "p:w1:p3").name, "reviewer")
})

test("a tab stays hidden under a collapsed workspace even when it is expanded itself", () => {
  assert.deepEqual(plain(Tree.rows(tree, open(["t:w1:t2"]), "ws#0", noAttention)).map(r => r.key), ["w:w1", "w:w2"])
})

test("tab labels fall back to the tab number; focus follows herdr's focused ids", () => {
  const rows = plain(Tree.rows(tree, open(["w:w2"]), "ws#0", noAttention))
  assert.deepEqual([rows[2].key, rows[2].label, rows[2].focused, rows[2].detail], ["t:w2:t1", "4", true, "shell"])
})

test("Attention shows on the pane and on every row above it, blocked over done", () => {
  const attention = { statuses: {}, attention: { "p:w1:p1": "done", "p:w1:p3": "blocked" } }
  const rows = plain(Tree.rows(tree, open(["w:w1", "t:w1:t2"]), "ws#0", attention))
  const by = Object.fromEntries(rows.map(r => [r.key, r.attention]))
  assert.deepEqual(by, { "w:w1": "blocked", "t:w1:t1": "done", "t:w1:t2": "blocked", "p:w1:p2": "", "p:w1:p3": "blocked", "w:w2": "" })
})

test("expansion is kept per Module and toggles by node key", () => {
  let state = Tree.toggleExpanded(Tree.emptyExpanded(), "ws#0", "w:w1")
  assert.equal(Tree.isExpanded(state, "ws#0", "w:w1"), true)
  assert.equal(Tree.isExpanded(state, "other#1", "w:w1"), false)
  state = Tree.toggleExpanded(state, "ws#0", "w:w1")
  assert.equal(Tree.isExpanded(state, "ws#0", "w:w1"), false)
  assert.deepEqual(plain(state), {})
  for (const bad of [["", "w:w1"], ["ws#0", ""], ["ws#0", "x:w1"], ["ws#0", "__proto__"]]) {
    const same = Tree.emptyExpanded()
    assert.equal(Tree.toggleExpanded(same, bad[0], bad[1]), same, String(bad))
  }
})

test("pruneExpanded forgets workspaces and tabs that are gone, and keeps the same object otherwise", () => {
  const state = open(["w:w1", "t:w1:t2", "w:w9", "t:w9:t1"])
  const pruned = Tree.pruneExpanded(state, tree)
  assert.deepEqual(plain(pruned), { "ws#0": { "w:w1": true, "t:w1:t2": true } })
  assert.equal(Tree.pruneExpanded(pruned, tree), pruned)
})

test("expand mode: a tap toggles a parent and focuses a leaf pane", () => {
  const rows = Tree.rows(tree, open(["w:w1", "t:w1:t2"]), "ws#0", noAttention)
  const by = Object.fromEntries(rows.map(r => [r.key, r]))
  assert.deepEqual(plain(Tree.tapAction(by["w:w1"], "expand", "row")), { action: "toggle", key: "w:w1" })
  assert.deepEqual(plain(Tree.tapAction(by["t:w1:t2"], "expand", "row")), { action: "toggle", key: "t:w1:t2" })
  assert.deepEqual(plain(Tree.tapAction(by["t:w1:t1"], "expand", "row")), { action: "focus", kind: "pane", id: "w1:p1" })
  assert.deepEqual(plain(Tree.tapAction(by["p:w1:p2"], "expand", "row")), { action: "focus", kind: "pane", id: "w1:p2" })
  assert.deepEqual(plain(Tree.tapAction(by["w:w1"], "expand", "chevron")), { action: "toggle", key: "w:w1" })
})

test("focus mode: a tap focuses the workspace, tab or pane; the chevron expands", () => {
  const rows = Tree.rows(tree, open(["w:w1", "t:w1:t2"]), "ws#0", noAttention)
  const by = Object.fromEntries(rows.map(r => [r.key, r]))
  assert.deepEqual(plain(Tree.tapAction(by["w:w1"], "focus", "row")), { action: "focus", kind: "workspace", id: "w1" })
  assert.deepEqual(plain(Tree.tapAction(by["t:w1:t1"], "focus", "row")), { action: "focus", kind: "tab", id: "w1:t1" })
  assert.deepEqual(plain(Tree.tapAction(by["p:w1:p3"], "focus", "row")), { action: "focus", kind: "pane", id: "w1:p3" })
  assert.deepEqual(plain(Tree.tapAction(by["w:w1"], "focus", "chevron")), { action: "toggle", key: "w:w1" })
  assert.deepEqual(plain(Tree.tapAction(by["t:w1:t1"], "focus", "chevron")), { action: "focus", kind: "tab", id: "w1:t1" })
  assert.deepEqual(plain(Tree.tapAction(null, "focus", "row")), { action: "none" })
})

test("rows and tap tolerate a missing tree and junk", () => {
  assert.deepEqual(plain(Tree.rows(null, null, "ws#0", null)), [])
  assert.deepEqual(plain(Tree.rows({ workspaces: [null, { workspaceId: "w1", tabs: null }] }, {}, "ws#0", null)).map(r => [r.key, r.detail, r.expandable]),
    [["w:w1", "0 tabs", false]])
  assert.equal(Tree.normalizeTap("focus"), "focus")
  assert.equal(Tree.normalizeTap("wild"), "expand")
})

test("nodeExists finds workspaces, tabs and panes by node key", () => {
  assert.equal(Tree.nodeExists(tree, "w:w2"), true)
  assert.equal(Tree.nodeExists(tree, "t:w1:t2"), true)
  assert.equal(Tree.nodeExists(tree, "p:w1:p3"), true)
  assert.equal(Tree.nodeExists(tree, "p:w9:p1"), false)
  assert.equal(Tree.nodeExists(null, "w:w1"), false)
})

test("node keys with control characters or over 64 characters of id are refused", () => {
  const same = Tree.emptyExpanded()
  for (const bad of ["w:a\u0000b", "t:\u001fx", "w:x\u007f", "w:" + "x".repeat(65)]) {
    assert.equal(Tree.toggleExpanded(same, "ws#0", bad), same, JSON.stringify(bad))
  }
  assert.notEqual(Tree.toggleExpanded(same, "ws#0", "t:w1:t2"), same)
})
