"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")
const loadLib = require("./support/loadLib.cjs")

const H = loadLib("lib/HerdrModel.js")

// Mirrors session.snapshot from herdr 0.8.2, trimmed to what the model reads.
function snapshot() {
  return {
    focused_workspace_id: "w1",
    focused_tab_id: "w1:t1",
    focused_pane_id: "w1:p1",
    workspaces: [
      { workspace_id: "w2", label: "hvelv", number: 2, focused: false, active_tab_id: "w2:t1", agent_status: "working", pane_count: 1, tab_count: 1 },
      { workspace_id: "w1", label: "~", number: 1, focused: true, active_tab_id: "w1:t1", agent_status: "idle", pane_count: 2, tab_count: 2 }
    ],
    tabs: [
      { tab_id: "w1:t1", workspace_id: "w1", label: "1", number: 1, focused: true, pane_count: 1, agent_status: "idle" },
      { tab_id: "w1:t2", workspace_id: "w1", label: "api", number: 2, focused: false, pane_count: 1, agent_status: "unknown" },
      { tab_id: "w2:t1", workspace_id: "w2", label: "1", number: 1, focused: false, pane_count: 1, agent_status: "working" }
    ],
    panes: [
      { pane_id: "w2:p1", tab_id: "w2:t1", workspace_id: "w2", terminal_id: "t3", agent: "codex", agent_status: "working", terminal_title: "", terminal_title_stripped: "", cwd: "/srv/b", foreground_cwd: "/srv/b/sub", focused: false, revision: 9 },
      { pane_id: "w1:p1", tab_id: "w1:t1", workspace_id: "w1", terminal_id: "t1", agent: "claude", agent_status: "idle", terminal_title: "✳ Fix bug", terminal_title_stripped: "Fix bug", cwd: "/home/x/a", foreground_cwd: "/home/x/a", focused: true, revision: 2, scroll: { offset_from_bottom: 0, max_offset_from_bottom: 0, viewport_rows: 40 } },
      { pane_id: "w1:p2", tab_id: "w1:t2", workspace_id: "w1", terminal_id: "t2", agent_status: "unknown", cwd: "/home/x", focused: false, revision: 0 }
    ],
    agents: []
  }
}

// A herdr-shaped PaneInfo for an event, taken from the snapshot fixture. It
// must not come from the model's own state, which holds a different shape.
function paneOf(_state, id) {
  const raw = snapshot().panes.find(p => p.pane_id === id)
  assert.ok(raw, "fixture has pane " + id)
  return JSON.parse(JSON.stringify(raw))
}

function ev(name, data) {
  return { event: name, data: Object.assign({ type: name }, data) }
}

// ---------------------------------------------------------------- snapshot

test("fromSnapshot yields one Agent per pane with an agent, excluding plain panes", () => {
  const agents = H.agents(H.fromSnapshot(snapshot()))
  assert.deepEqual(agents.map(a => a.paneId), ["w1:p1", "w2:p1"])
})

test("Agents carry the fields later policies need", () => {
  const [first, second] = H.agents(H.fromSnapshot(snapshot()))
  assert.deepEqual({ ...first }, {
    paneId: "w1:p1",
    tabId: "w1:t1",
    workspaceId: "w1",
    kind: "claude",
    displayKind: "claude",
    status: "idle",
    title: "Fix bug",
    paneLabel: "",
    cwd: "/home/x/a",
    stateChangeSeq: null,
    sessionId: "",
    focused: true,
    tabLabel: "1",
    tabNumber: 1,
    workspaceLabel: "~",
    workspaceNumber: 1
  })
  assert.equal(second.cwd, "/srv/b/sub", "foreground cwd wins over cwd")
  assert.equal(second.workspaceLabel, "hvelv")
})

test("Agents are ordered by workspace number, then tab number, then herdr's pane order", () => {
  const snap = snapshot()
  snap.panes.push({ pane_id: "w1:p3", tab_id: "w1:t1", workspace_id: "w1", terminal_id: "t4", agent: "claude", agent_status: "done", focused: false, revision: 1 })
  assert.deepEqual(H.agents(H.fromSnapshot(snap)).map(a => a.paneId), ["w1:p1", "w1:p3", "w2:p1"])
})

test("snapshot agents add state_change_seq, the Claude session id and herdr's Agent order", () => {
  const snap = snapshot()
  snap.agents = [
    { pane_id: "w2:p1", agent: "codex", state_change_seq: 650, agent_session: { agent: "codex", kind: "path", value: "/x" } },
    { pane_id: "w1:p1", agent: "claude", state_change_seq: 12, agent_session: { agent: "claude", kind: "id", value: "cf43ca7f-58ec-4ecd-a3ae-8efb244388cc" } },
    { pane_id: "w9:gone", state_change_seq: 1 }
  ]
  const agents = H.agents(H.fromSnapshot(snap))
  assert.deepEqual(agents.map(a => a.paneId), ["w2:p1", "w1:p1"], "herdr's order wins over workspace number")
  assert.equal(agents[0].stateChangeSeq, 650)
  assert.equal(agents[0].sessionId, "", "only kind id is a session id")
  assert.equal(agents[1].sessionId, "cf43ca7f-58ec-4ecd-a3ae-8efb244388cc")
})

test("unsafe session ids and bad sequence numbers are dropped", () => {
  const snap = snapshot()
  snap.agents = [{ pane_id: "w1:p1", state_change_seq: "x", agent_session: { kind: "id", value: "../../etc/passwd" } }]
  const agent = H.agents(H.fromSnapshot(snap)).find(a => a.paneId === "w1:p1")
  assert.equal(agent.stateChangeSeq, null)
  assert.equal(agent.sessionId, "")
})

test("pane events keep the Agent facts only the snapshot carries", () => {
  const snap = snapshot()
  snap.agents = [{ pane_id: "w1:p1", state_change_seq: 12, agent_session: { kind: "id", value: "cf43ca7f-58ec-4ecd-a3ae-8efb244388cc" } }]
  const state = H.fromSnapshot(snap)
  const out = H.applyEvent(state, ev("pane_updated", { pane: Object.assign(paneOf(state, "w1:p1"), { revision: 99 }) }))
  assert.equal(out.changed, false)
})

test("unknown or missing statuses normalise to unknown", () => {
  const snap = snapshot()
  snap.panes[1].agent_status = "pondering"
  delete snap.panes[0].agent_status
  const agents = H.agents(H.fromSnapshot(snap))
  assert.deepEqual(agents.map(a => a.status), ["unknown", "unknown"])
})

test("fromSnapshot tolerates a missing or partial snapshot", () => {
  assert.deepEqual(Array.from(H.agents(H.fromSnapshot(null))), [])
  assert.deepEqual(Array.from(H.agents(H.fromSnapshot({ panes: [{ pane_id: "w9:p1", agent: "claude" }] }))).map(a => a.paneId), ["w9:p1"])
})

// ---------------------------------------------------------------- collapsing

test("pane_updated that only moves revision or scroll is collapsed", () => {
  const state = H.fromSnapshot(snapshot())
  const pane = paneOf(state, "w1:p1")
  pane.revision = 3
  pane.scroll = { offset_from_bottom: 10, max_offset_from_bottom: 90, viewport_rows: 40 }
  const out = H.applyEvent(state, ev("pane_updated", { pane }))
  assert.equal(out.changed, false)
})

test("pane_updated that only changes the unstripped title glyph is collapsed", () => {
  const state = H.fromSnapshot(snapshot())
  const pane = paneOf(state, "w1:p1")
  pane.terminal_title = "⠋ Fix bug"
  assert.equal(H.applyEvent(state, ev("pane_updated", { pane })).changed, false)
})

test("pane_updated on a pane without an agent is collapsed", () => {
  const state = H.fromSnapshot(snapshot())
  const pane = paneOf(state, "w1:p2")
  pane.cwd = "/elsewhere"
  pane.terminal_title_stripped = "vim"
  assert.equal(H.applyEvent(state, ev("pane_updated", { pane })).changed, false)
})

test("pane_updated that changes status reaches the Agents", () => {
  const state = H.fromSnapshot(snapshot())
  const pane = paneOf(state, "w1:p1")
  pane.agent_status = "blocked"
  pane.revision = 4
  const out = H.applyEvent(state, ev("pane_updated", { pane }))
  assert.equal(out.changed, true)
  assert.equal(H.agents(out.state)[0].status, "blocked")
})

test("pane_updated that changes title or cwd reaches the Agents", () => {
  let state = H.fromSnapshot(snapshot())
  const pane = paneOf(state, "w1:p1")
  pane.terminal_title_stripped = "Write tests"
  let out = H.applyEvent(state, ev("pane_updated", { pane }))
  assert.equal(out.changed, true)
  assert.equal(H.agents(out.state)[0].title, "Write tests")
  const again = paneOf(out.state, "w1:p1")
  again.foreground_cwd = "/home/x/b"
  out = H.applyEvent(out.state, ev("pane_updated", { pane: again }))
  assert.equal(out.changed, true)
  assert.equal(H.agents(out.state)[0].cwd, "/home/x/b")
})

test("pane_updated that gives a plain pane an agent adds an Agent", () => {
  const state = H.fromSnapshot(snapshot())
  const pane = paneOf(state, "w1:p2")
  pane.agent = "claude"
  pane.agent_status = "working"
  const out = H.applyEvent(state, ev("pane_updated", { pane }))
  assert.equal(out.changed, true)
  assert.deepEqual(H.agents(out.state).map(a => a.paneId), ["w1:p1", "w1:p2", "w2:p1"])
})

test("applyEvent does not mutate the state it was given", () => {
  const state = H.fromSnapshot(snapshot())
  const before = JSON.stringify(state)
  const pane = paneOf(state, "w1:p1")
  pane.agent_status = "done"
  H.applyEvent(state, ev("pane_updated", { pane }))
  H.applyEvent(state, ev("pane_closed", { pane_id: "w2:p1", workspace_id: "w2" }))
  assert.equal(JSON.stringify(state), before)
})

test("repeated pane_focused on the focused pane is collapsed", () => {
  const state = H.fromSnapshot(snapshot())
  const out = H.applyEvent(state, ev("pane_focused", { pane_id: "w1:p1", workspace_id: "w1" }))
  assert.equal(out.changed, false)
})

test("pane_focused on another Agent moves focus", () => {
  const state = H.fromSnapshot(snapshot())
  const out = H.applyEvent(state, ev("pane_focused", { pane_id: "w2:p1", workspace_id: "w2" }))
  assert.equal(out.changed, true)
  assert.deepEqual(H.agents(out.state).map(a => [a.paneId, a.focused]), [["w1:p1", false], ["w2:p1", true]])
})

test("pane_focused on a plain pane clears Agent focus", () => {
  const state = H.fromSnapshot(snapshot())
  const out = H.applyEvent(state, ev("pane_focused", { pane_id: "w1:p2", workspace_id: "w1" }))
  assert.equal(out.changed, true)
  assert.ok(H.agents(out.state).every(a => !a.focused))
  const back = H.applyEvent(out.state, ev("pane_focused", { pane_id: "w1:p2", workspace_id: "w1" }))
  assert.equal(back.changed, false)
})

test("tab and workspace focus churn is collapsed", () => {
  const state = H.fromSnapshot(snapshot())
  assert.equal(H.applyEvent(state, ev("tab_focused", { tab_id: "w1:t2", workspace_id: "w1" })).changed, false)
  assert.equal(H.applyEvent(state, ev("workspace_focused", { workspace_id: "w2" })).changed, false)
})

// ---------------------------------------------------------------- lifecycle

test("pane_created without an agent is collapsed, and a later agent shows up", () => {
  let out = H.applyEvent(H.fromSnapshot(snapshot()), ev("pane_created", {
    pane: { pane_id: "w1:p9", tab_id: "w1:t2", workspace_id: "w1", terminal_id: "t9", agent_status: "unknown", focused: false, revision: 0 }
  }))
  assert.equal(out.changed, false)
  out = H.applyEvent(out.state, ev("pane_agent_detected", { pane_id: "w1:p9", workspace_id: "w1", agent: "claude" }))
  assert.equal(out.changed, true)
  const added = H.agents(out.state).find(a => a.paneId === "w1:p9")
  assert.equal(added.kind, "claude")
  assert.equal(added.tabLabel, "api")
})

test("pane_agent_detected with released removes the Agent", () => {
  const out = H.applyEvent(H.fromSnapshot(snapshot()), ev("pane_agent_detected", {
    pane_id: "w2:p1", workspace_id: "w2", agent: null, released: true, final_status: "done"
  }))
  assert.equal(out.changed, true)
  assert.deepEqual(H.agents(out.state).map(a => a.paneId), ["w1:p1"])
})

test("pane_agent_detected repeating the known agent is collapsed", () => {
  const out = H.applyEvent(H.fromSnapshot(snapshot()), ev("pane_agent_detected", { pane_id: "w1:p1", workspace_id: "w1", agent: "claude" }))
  assert.equal(out.changed, false)
})

test("pane_agent_status_changed updates status and display kind", () => {
  const out = H.applyEvent(H.fromSnapshot(snapshot()), ev("pane_agent_status_changed", {
    pane_id: "w1:p1", workspace_id: "w1", agent_status: "done", agent: "claude", display_agent: "Claude Code"
  }))
  assert.equal(out.changed, true)
  const agent = H.agents(out.state)[0]
  assert.equal(agent.status, "done")
  assert.equal(agent.displayKind, "Claude Code")
})

test("pane_closed and pane_exited remove the Agent", () => {
  const state = H.fromSnapshot(snapshot())
  for (const name of ["pane_closed", "pane_exited"]) {
    const out = H.applyEvent(state, ev(name, { pane_id: "w2:p1", workspace_id: "w2" }))
    assert.equal(out.changed, true, name)
    assert.deepEqual(H.agents(out.state).map(a => a.paneId), ["w1:p1"], name)
  }
  assert.equal(H.applyEvent(state, ev("pane_closed", { pane_id: "w1:p2", workspace_id: "w1" })).changed, false)
  assert.equal(H.applyEvent(state, ev("pane_closed", { pane_id: "nope", workspace_id: "w1" })).changed, false)
})

test("pane_moved re-homes the Agent, including created and closed containers", () => {
  const pane = paneOf(H.fromSnapshot(snapshot()), "w2:p1")
  Object.assign(pane, { pane_id: "w3:p1", tab_id: "w3:t1", workspace_id: "w3" })
  const out = H.applyEvent(H.fromSnapshot(snapshot()), ev("pane_moved", {
    previous_pane_id: "w2:p1", previous_tab_id: "w2:t1", previous_workspace_id: "w2",
    closed_tab_id: "w2:t1", closed_workspace_id: "w2",
    created_workspace: { workspace_id: "w3", label: "moved", number: 3 },
    created_tab: { tab_id: "w3:t1", workspace_id: "w3", label: "1", number: 1 },
    pane
  }))
  assert.equal(out.changed, true)
  const moved = H.agents(out.state).find(a => a.kind === "codex")
  assert.deepEqual([moved.paneId, moved.workspaceLabel, moved.workspaceNumber], ["w3:p1", "moved", 3])
  assert.equal(out.state.workspaces["w2"], undefined)
})

test("tab_renamed and workspace_renamed reach Agents in them only", () => {
  const state = H.fromSnapshot(snapshot())
  let out = H.applyEvent(state, ev("tab_renamed", { tab_id: "w1:t1", workspace_id: "w1", label: "bugs" }))
  assert.equal(out.changed, true)
  assert.equal(H.agents(out.state)[0].tabLabel, "bugs")
  assert.equal(H.applyEvent(state, ev("tab_renamed", { tab_id: "w1:t2", workspace_id: "w1", label: "x" })).changed, false)
  out = H.applyEvent(state, ev("workspace_renamed", { workspace_id: "w2", label: "prod" }))
  assert.equal(out.changed, true)
  assert.equal(H.agents(out.state)[1].workspaceLabel, "prod")
})

test("workspace_updated and workspace_moved refresh numbers", () => {
  const state = H.fromSnapshot(snapshot())
  const out = H.applyEvent(state, ev("workspace_moved", {
    workspace_id: "w2", insert_index: 0,
    workspaces: [
      { workspace_id: "w2", label: "hvelv", number: 1 },
      { workspace_id: "w1", label: "~", number: 2 }
    ]
  }))
  assert.equal(out.changed, true)
  assert.deepEqual(H.agents(out.state).map(a => a.paneId), ["w2:p1", "w1:p1"])
  const same = H.applyEvent(state, ev("workspace_updated", { workspace: { workspace_id: "w1", label: "~", number: 1 } }))
  assert.equal(same.changed, false)
})

test("tab_closed and workspace_closed drop their Agents", () => {
  const state = H.fromSnapshot(snapshot())
  let out = H.applyEvent(state, ev("tab_closed", { tab_id: "w1:t1", workspace_id: "w1" }))
  assert.deepEqual(H.agents(out.state).map(a => a.paneId), ["w2:p1"])
  out = H.applyEvent(state, ev("workspace_closed", { workspace_id: "w2" }))
  assert.deepEqual(H.agents(out.state).map(a => a.paneId), ["w1:p1"])
  assert.equal(out.changed, true)
})

test("unknown, irrelevant and malformed events never throw and never change", () => {
  const state = H.fromSnapshot(snapshot())
  for (const bad of [null, {}, { event: "layout_updated", data: { type: "layout_updated", layout: {} } },
    { event: "pane_output_changed", data: { pane_id: "w1:p1", revision: 7 } },
    { event: "pane_updated", data: {} }, { event: "pane_focused" }, { event: "martian", data: { x: 1 } }]) {
    const out = H.applyEvent(state, bad)
    assert.equal(out.changed, false, JSON.stringify(bad))
  }
})

test("applyEvents folds a burst and reports whether anything renderable changed", () => {
  const state = H.fromSnapshot(snapshot())
  const noisy = []
  for (let i = 0; i < 50; i++) {
    const pane = paneOf(state, "w1:p1")
    pane.revision = 10 + i
    noisy.push(ev("pane_updated", { pane }), ev("pane_focused", { pane_id: "w1:p1", workspace_id: "w1" }))
  }
  assert.equal(H.applyEvents(state, noisy).changed, false)
  const pane = paneOf(state, "w1:p1")
  pane.agent_status = "working"
  const out = H.applyEvents(state, noisy.concat([ev("pane_updated", { pane })]))
  assert.equal(out.changed, true)
  assert.equal(H.agents(out.state)[0].status, "working")
})

// ---------------------------------------------------------------- protocol

test("requestLine is one JSON line with id, method and params", () => {
  const line = H.requestLine("gjetr:1", "session.snapshot")
  assert.ok(line.endsWith("\n"))
  assert.equal(line.indexOf("\n"), line.length - 1)
  assert.deepEqual(JSON.parse(line), { id: "gjetr:1", method: "session.snapshot", params: {} })
})

test("subscribeLine asks only for global subscription types", () => {
  const request = JSON.parse(H.subscribeLine("gjetr:2"))
  assert.equal(request.method, "events.subscribe")
  const types = request.params.subscriptions.map(s => s.type)
  assert.ok(types.includes("pane.updated"))
  assert.ok(types.includes("pane.agent_detected"))
  assert.ok(types.includes("tab.renamed"))
  assert.ok(types.includes("workspace.closed"))
  for (const scoped of ["pane.agent_status_changed", "pane.scroll_changed", "pane.output_matched"])
    assert.ok(!types.includes(scoped), scoped + " needs pane_id and would fail the request")
  assert.ok(request.params.subscriptions.every(s => Object.keys(s).length === 1))
})

test("parseReplyLine matches on the first line, not the id", () => {
  assert.deepEqual({ ...H.parseReplyLine('{"id":"other","result":{"snapshot":{"panes":[]}}}') },
    { ok: true, result: { snapshot: { panes: [] } }, error: null })
  const failed = H.parseReplyLine('{"id":"","error":{"code":"invalid_request","message":"bad"}}')
  assert.equal(failed.ok, false)
  assert.deepEqual({ ...failed.error }, { code: "invalid_request", message: "bad" })
  assert.equal(H.parseReplyLine("not json").error.code, "invalid_json")
  assert.equal(H.parseReplyLine('{"id":"x"}').error.code, "invalid_reply")
})

test("snapshotFromReply extracts the snapshot or null", () => {
  assert.deepEqual(H.snapshotFromReply(H.parseReplyLine('{"id":"a","result":{"snapshot":{"panes":[]},"type":"session_snapshot"}}')), { panes: [] })
  assert.equal(H.snapshotFromReply(H.parseReplyLine('{"id":"a","result":{}}')), null)
  assert.equal(H.snapshotFromReply(H.parseReplyLine("{")), null)
})

test("classifyStreamLine separates the start reply, events and errors", () => {
  assert.equal(H.classifyStreamLine('{"id":"s","result":{"type":"subscription_started"}}').kind, "started")
  const event = H.classifyStreamLine('{"data":{"type":"pane_focused","pane_id":"w1:p1"},"event":"pane_focused"}')
  assert.equal(event.kind, "event")
  assert.equal(event.envelope.event, "pane_focused")
  const error = H.classifyStreamLine('{"id":"","error":{"code":"invalid_request","message":"missing field"}}')
  assert.deepEqual([error.kind, error.error.message], ["error", "missing field"])
  assert.equal(H.classifyStreamLine("garbage").kind, "invalid")
  assert.equal(H.classifyStreamLine('{"id":"s","result":{"type":"other"}}').kind, "invalid")
})

test("socketPath points at the default session socket", () => {
  assert.equal(H.socketPath("/home/lasse"), "/home/lasse/.config/herdr/herdr.sock")
})

// ---------------------------------------------------------------- backoff

test("backoff doubles from 500 ms and caps at 30 s", () => {
  const delays = []
  for (let attempt = 0; attempt < 9; attempt++) delays.push(H.backoffDelay(attempt))
  assert.deepEqual(delays, [500, 1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000])
})

// ---------------------------------------------------------------- reconciliation
// herdr replays recent history to every new subscriber (finding T01),
// so events cannot be trusted as state. They only decide when to re-snapshot.

test("eventInvalidates is false for noise and true for renderable changes", () => {
  const state = H.fromSnapshot(snapshot())
  const noisy = paneOf(state, "w1:p1")
  noisy.revision = 99
  assert.equal(H.eventInvalidates(state, ev("pane_updated", { pane: noisy })), false)
  const status = paneOf(state, "w1:p1")
  status.agent_status = "blocked"
  assert.equal(H.eventInvalidates(state, ev("pane_updated", { pane: status })), true)
  assert.equal(H.eventInvalidates(state, ev("pane_closed", { pane_id: "gone", workspace_id: "w9" })), false)
  assert.equal(H.eventInvalidates(state, ev("pane_focused", { pane_id: "w2:p1", workspace_id: "w2" })), true)
  assert.equal(H.eventInvalidates(state, null), false)
})

test("reconcileDelay debounces bursts but never waits past the max", () => {
  assert.equal(H.reconcileDelay(0), 250)
  assert.equal(H.reconcileDelay(600), 250)
  assert.equal(H.reconcileDelay(900), 100)
  assert.equal(H.reconcileDelay(1000), 0)
  assert.equal(H.reconcileDelay(5000), 0)
  assert.equal(H.reconcileDelay(-5), 250)
  assert.equal(H.reconcileDelay(NaN), 250)
})

test("sameAgents compares only what a Module renders", () => {
  const base = H.fromSnapshot(snapshot())
  assert.equal(H.sameAgents(base, H.fromSnapshot(snapshot())), true)
  const status = snapshot()
  status.panes[1].agent_status = "done"
  assert.equal(H.sameAgents(base, H.fromSnapshot(status)), false)
  const noisy = snapshot()
  noisy.panes[1].revision = 500
  noisy.panes[1].scroll = { offset_from_bottom: 3, max_offset_from_bottom: 9, viewport_rows: 40 }
  assert.equal(H.sameAgents(base, H.fromSnapshot(noisy)), true)
  assert.equal(H.sameAgents(null, base), false)
})

test("backoff treats nonsense attempts as the first", () => {
  assert.equal(H.backoffDelay(-3), 500)
  assert.equal(H.backoffDelay(NaN), 500)
  assert.equal(H.backoffDelay(undefined), 500)
  assert.equal(H.backoffDelay(1e9), 30000)
})

test("focusLine asks herdr to focus exactly one pane", () => {
  const line = H.focusLine("gjetr:9:focus", "w4:pT")
  assert.ok(line.endsWith("\n"))
  assert.deepEqual(JSON.parse(line), { id: "gjetr:9:focus", method: "pane.focus", params: { pane_id: "w4:pT" } })
})

test("focusLine refuses an empty pane id", () => {
  assert.equal(H.focusLine("x", ""), "")
  assert.equal(H.focusLine("x", undefined), "")
})

// ---------------------------------------------------------------- tree

function treeShape(tree) {
  return tree.workspaces.map(w => [w.workspaceId, w.label, w.status,
    w.tabs.map(t => [t.tabId, t.label, t.status, t.panes.map(p => [p.paneId, p.kind, p.status])])])
}

test("the tree holds every workspace, tab and pane, including panes without an agent", () => {
  const tree = H.tree(H.fromSnapshot(snapshot()))
  assert.deepEqual(treeShape(JSON.parse(JSON.stringify(tree))), [
    ["w1", "~", "idle", [["w1:t1", "1", "idle", [["w1:p1", "claude", "idle"]]], ["w1:t2", "api", "unknown", [["w1:p2", "", "unknown"]]]]],
    ["w2", "hvelv", "working", [["w2:t1", "1", "working", [["w2:p1", "codex", "working"]]]]]
  ])
  assert.deepEqual([tree.focusedWorkspaceId, tree.focusedTabId, tree.focusedPaneId], ["w1", "w1:t1", "w1:p1"])
  const shell = tree.workspaces[0].tabs[1].panes[0]
  assert.deepEqual([shell.tabLabel, shell.workspaceLabel, shell.cwd, shell.focused], ["api", "~", "/home/x", false])
})

test("workspaces follow their number; tabs and panes follow herdr's snapshot order", () => {
  const snap = snapshot()
  snap.tabs.reverse()
  const tree = H.tree(H.fromSnapshot(snap))
  assert.deepEqual(tree.workspaces.map(w => w.workspaceId), ["w1", "w2"])
  assert.deepEqual(tree.workspaces[0].tabs.map(t => t.tabId), ["w1:t2", "w1:t1"])
})

test("focus ids fall back to focused flags, and a missing rolled-up status stays empty", () => {
  const snap = snapshot()
  delete snap.focused_workspace_id
  delete snap.focused_tab_id
  delete snap.tabs[1].agent_status
  const tree = H.tree(H.fromSnapshot(snap))
  assert.equal(tree.focusedWorkspaceId, "w1")
  assert.equal(tree.focusedTabId, "w1:t1")
  assert.equal(tree.workspaces[0].tabs[1].status, "")
  assert.deepEqual(JSON.parse(JSON.stringify(H.tree(H.fromSnapshot(null)))),
    { focusedWorkspaceId: "", focusedTabId: "", focusedPaneId: "", workspaces: [] })
})

test("a shell's title change leaves the Agents alone but changes the tree", () => {
  const state = H.fromSnapshot(snapshot())
  const pane = paneOf(state, "w1:p2")
  pane.terminal_title_stripped = "lasse@oma:~/code"
  const out = H.applyEvent(state, ev("pane_updated", { pane }))
  assert.equal(out.changed, false)
  assert.equal(out.treeChanged, true)
  assert.equal(out.focusChanged, false)
  assert.equal(H.tree(out.state).workspaces[0].tabs[1].panes[0].title, "lasse@oma:~/code")
})

test("workspace and tab focus change the Focused workspace without touching the Agents", () => {
  const state = H.fromSnapshot(snapshot())
  const ws = H.applyEvent(state, ev("workspace_focused", { workspace_id: "w2" }))
  assert.deepEqual([ws.changed, ws.treeChanged, ws.focusChanged], [false, true, true])
  assert.equal(H.tree(ws.state).focusedWorkspaceId, "w2")
  const tab = H.applyEvent(state, ev("tab_focused", { tab_id: "w2:t1", workspace_id: "w2" }))
  assert.deepEqual([tab.changed, tab.focusChanged], [false, true])
  assert.deepEqual([H.tree(tab.state).focusedTabId, H.tree(tab.state).focusedWorkspaceId], ["w2:t1", "w2"])
  const again = H.applyEvent(state, ev("workspace_focused", { workspace_id: "w1" }))
  assert.deepEqual([again.changed, again.treeChanged, again.focusChanged], [false, false, false])
})

test("pane_focused on a plain pane moves the Focused workspace and tab with it", () => {
  const state = H.applyEvent(H.fromSnapshot(snapshot()), ev("workspace_focused", { workspace_id: "w2" })).state
  const out = H.applyEvent(state, ev("pane_focused", { pane_id: "w1:p2", workspace_id: "w1" }))
  assert.equal(out.focusChanged, true)
  assert.deepEqual([H.tree(out.state).focusedWorkspaceId, H.tree(out.state).focusedTabId], ["w1", "w1:t2"])
})

test("eventInvalidates can include tree changes; sameTree compares the rendered tree", () => {
  const state = H.fromSnapshot(snapshot())
  const pane = paneOf(state, "w1:p2")
  pane.terminal_title_stripped = "vim"
  const envelope = ev("pane_updated", { pane })
  assert.equal(H.eventInvalidates(state, envelope), false)
  assert.equal(H.eventInvalidates(state, envelope, true), true)
  assert.equal(H.eventInvalidates(state, ev("workspace_focused", { workspace_id: "w2" })), true)
  assert.equal(H.sameTree(state, H.fromSnapshot(snapshot())), true)
  const renamed = snapshot()
  renamed.tabs[1].label = "server"
  assert.equal(H.sameTree(state, H.fromSnapshot(renamed)), false)
  assert.equal(H.sameTree(null, state), false)
})

test("focusTargetLine focuses a workspace, tab or pane by id", () => {
  assert.deepEqual(JSON.parse(H.focusTargetLine("a", "workspace", "w2")), { id: "a", method: "workspace.focus", params: { workspace_id: "w2" } })
  assert.deepEqual(JSON.parse(H.focusTargetLine("b", "tab", "w2:t1")), { id: "b", method: "tab.focus", params: { tab_id: "w2:t1" } })
  assert.deepEqual(JSON.parse(H.focusTargetLine("c", "pane", "w1:p2")), { id: "c", method: "pane.focus", params: { pane_id: "w1:p2" } })
  assert.equal(H.focusTargetLine("d", "agent", "w1:p1"), "")
  assert.equal(H.focusTargetLine("e", "tab", ""), "")
})

test("subscribeLine follows workspace and tab focus for the Focused workspace", () => {
  const types = JSON.parse(H.subscribeLine("gjetr:3")).params.subscriptions.map(s => s.type)
  assert.ok(types.includes("workspace.focused"))
  assert.ok(types.includes("tab.focused"))
})
