.pragma library

// All herdr protocol knowledge lives here: request and subscription lines,
// reply parsing, snapshot + events -> Agents, collapsing, and the reconnect
// schedule. Pure; the QML connection only moves bytes and timers.
//
// Protocol facts (herdr 0.8.2, socket protocol 20), verified in
// docs/findings/T01.md:
// - one JSON request line per connection; only events.subscribe stays open
// - match a reply on the first line back, not the id (parse errors use id "")
// - events arrive as {"event":"pane_updated","data":{"type":"pane_updated",...}}
// - pane.agent_status_changed, pane.scroll_changed and pane.output_matched
//   need a pane_id; asking for them unscoped fails the whole subscription
// - every new subscriber first receives a paced replay of recent history, so
//   events are not state: published Agents come from session.snapshot only,
//   and events decide when to take the next one (see reconciliation below)

var STATUSES = ["idle", "working", "blocked", "done", "unknown"]

// Claude session ids are UUIDs; they later name a transcript file.
var SESSION_ID_RE = /^[0-9A-Za-z][0-9A-Za-z_-]{7,63}$/

var BACKOFF_MIN_MS = 500
var BACKOFF_MAX_MS = 30000

// Global subscription types only. Focus of tabs and workspaces is left out:
// it is the noisiest part of the stream and no Agent field depends on it.
var SUBSCRIPTION_TYPES = [
  "workspace.created", "workspace.updated", "workspace.renamed",
  "workspace.moved", "workspace.reordered", "workspace.closed",
  "worktree.created", "worktree.opened",
  "tab.created", "tab.closed", "tab.renamed", "tab.moved",
  "pane.created", "pane.updated", "pane.closed", "pane.exited",
  "pane.focused", "pane.moved", "pane.agent_detected"
]

// ------------------------------------------------------------------ helpers

function str(value) {
  return value === undefined || value === null ? "" : String(value)
}

function num(value) {
  var n = Number(value)
  return isFinite(n) ? n : 0
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function copyMap(map) {
  var out = {}
  for (var key in map) out[key] = map[key]
  return out
}

function normalizeStatus(value) {
  var status = str(value)
  return STATUSES.indexOf(status) >= 0 ? status : "unknown"
}

// ------------------------------------------------------------------ records

// Only the pane fields an Agent can show. Anything else herdr sends, such as
// revision, scroll or the glyph-prefixed terminal_title, is dropped here, which
// is what collapses most of the pane_updated stream.
function paneRecord(pane, previous) {
  var base = previous || {}
  return {
    paneId: str(pane.pane_id),
    tabId: pane.tab_id !== undefined ? str(pane.tab_id) : str(base.tabId),
    workspaceId: pane.workspace_id !== undefined ? str(pane.workspace_id) : str(base.workspaceId),
    kind: str(pane.agent),
    displayKind: str(pane.display_agent),
    status: normalizeStatus(pane.agent_status),
    title: str(pane.terminal_title_stripped),
    paneLabel: str(pane.label),
    cwd: str(pane.foreground_cwd) || str(pane.cwd),
    // Only session.snapshot `agents` carries these; pane events keep the last.
    stateChangeSeq: base.stateChangeSeq === undefined ? null : base.stateChangeSeq,
    sessionId: str(base.sessionId),
    herdrOrder: base.herdrOrder === undefined ? -1 : base.herdrOrder
  }
}

// The facts herdr keeps per Agent rather than per pane: when its status last
// changed (herdr's priority tiebreak), its agent session, and herdr's own
// Agent order.
function applyAgentInfo(record, info, index) {
  var seq = Number(info.state_change_seq)
  record.stateChangeSeq = info.state_change_seq !== undefined && info.state_change_seq !== null && isFinite(seq) && seq >= 0
    ? seq : null
  var session = isObject(info.agent_session) ? info.agent_session : null
  record.sessionId = session && session.kind === "id" && SESSION_ID_RE.test(str(session.value)) ? str(session.value) : ""
  record.herdrOrder = index
}

function tabRecord(tab) {
  return { tabId: str(tab.tab_id), workspaceId: str(tab.workspace_id), label: str(tab.label), number: num(tab.number) }
}

function workspaceRecord(workspace) {
  return { workspaceId: str(workspace.workspace_id), label: str(workspace.label), number: num(workspace.number) }
}

function sameRecord(a, b) {
  if (!a || !b) return false
  for (var key in a) if (a[key] !== b[key]) return false
  for (var other in b) if (!(other in a)) return false
  return true
}

// ------------------------------------------------------------------ state

function emptyState() {
  return { panes: {}, tabs: {}, workspaces: {}, focusedPaneId: "", agentList: [], agentsKey: "[]" }
}

function buildAgents(state) {
  var rows = []
  var index = 0
  for (var id in state.panes) {
    var pane = state.panes[id]
    index++
    if (pane.kind === "") continue
    var tab = state.tabs[pane.tabId]
    var workspace = state.workspaces[pane.workspaceId]
    rows.push({
      order: index,
      agent: {
        paneId: pane.paneId,
        tabId: pane.tabId,
        workspaceId: pane.workspaceId,
        kind: pane.kind,
        displayKind: pane.displayKind || pane.kind,
        status: pane.status,
        title: pane.title,
        paneLabel: pane.paneLabel,
        cwd: pane.cwd,
        stateChangeSeq: pane.stateChangeSeq,
        sessionId: pane.sessionId,
        focused: pane.paneId === state.focusedPaneId,
        tabLabel: tab ? tab.label : "",
        tabNumber: tab ? tab.number : 0,
        workspaceLabel: workspace ? workspace.label : "",
        workspaceNumber: workspace ? workspace.number : 0
      },
      herdrKey: pane.herdrOrder >= 0 ? pane.herdrOrder : Number.MAX_SAFE_INTEGER,
      workspaceKey: workspace ? workspace.number : Number.MAX_SAFE_INTEGER,
      tabKey: tab ? tab.number : Number.MAX_SAFE_INTEGER
    })
  }
  // herdr's own Agent order when the snapshot gave one; otherwise workspace,
  // tab and pane order, which is how herdr builds that list.
  rows.sort(function(a, b) {
    return (a.herdrKey - b.herdrKey) || (a.workspaceKey - b.workspaceKey) || (a.tabKey - b.tabKey) || (a.order - b.order)
  })
  return rows.map(function(row) { return row.agent })
}

function finish(state) {
  state.agentList = buildAgents(state)
  state.agentsKey = JSON.stringify(state.agentList)
  return state
}

function derive(state) {
  return {
    panes: state.panes,
    tabs: state.tabs,
    workspaces: state.workspaces,
    focusedPaneId: state.focusedPaneId,
    agentList: state.agentList,
    agentsKey: state.agentsKey
  }
}

function fromSnapshot(snapshot) {
  var state = emptyState()
  var snap = isObject(snapshot) ? snapshot : {}
  var i
  var workspaces = Array.isArray(snap.workspaces) ? snap.workspaces : []
  for (i = 0; i < workspaces.length; i++) {
    if (isObject(workspaces[i]) && workspaces[i].workspace_id)
      state.workspaces[str(workspaces[i].workspace_id)] = workspaceRecord(workspaces[i])
  }
  var tabs = Array.isArray(snap.tabs) ? snap.tabs : []
  for (i = 0; i < tabs.length; i++) {
    if (isObject(tabs[i]) && tabs[i].tab_id) state.tabs[str(tabs[i].tab_id)] = tabRecord(tabs[i])
  }
  var panes = Array.isArray(snap.panes) ? snap.panes : []
  for (i = 0; i < panes.length; i++) {
    if (!isObject(panes[i]) || !panes[i].pane_id) continue
    state.panes[str(panes[i].pane_id)] = paneRecord(panes[i])
    if (panes[i].focused === true && !snap.focused_pane_id) state.focusedPaneId = str(panes[i].pane_id)
  }
  if (snap.focused_pane_id) state.focusedPaneId = str(snap.focused_pane_id)
  var infos = Array.isArray(snap.agents) ? snap.agents : []
  for (i = 0; i < infos.length; i++) {
    if (!isObject(infos[i]) || !infos[i].pane_id) continue
    var record = state.panes[str(infos[i].pane_id)]
    if (record) applyAgentInfo(record, infos[i], i)
  }
  return finish(state)
}

function agents(state) {
  return state && Array.isArray(state.agentList) ? state.agentList : []
}

// ------------------------------------------------------------------ reducers
// Each returns a new state (not yet finished) or null when nothing changed.

function upsertPane(state, pane) {
  if (!isObject(pane) || !pane.pane_id) return null
  var id = str(pane.pane_id)
  var record = paneRecord(pane, state.panes[id])
  var focusedPaneId = pane.focused === true ? id : state.focusedPaneId
  if (sameRecord(record, state.panes[id]) && focusedPaneId === state.focusedPaneId) return null
  var next = derive(state)
  next.panes = copyMap(state.panes)
  next.panes[id] = record
  next.focusedPaneId = focusedPaneId
  return next
}

function removePanes(state, predicate) {
  var panes = {}
  var removed = false
  for (var id in state.panes) {
    if (predicate(state.panes[id])) removed = true
    else panes[id] = state.panes[id]
  }
  if (!removed) return null
  var next = derive(state)
  next.panes = panes
  return next
}

function removePane(state, paneId) {
  var id = str(paneId)
  if (!id || !state.panes[id]) return null
  return removePanes(state, function(pane) { return pane.paneId === id })
}

function patchPane(state, paneId, patch) {
  var id = str(paneId)
  var current = state.panes[id]
  if (!current) return null
  var record = copyMap(current)
  for (var key in patch) record[key] = patch[key]
  if (sameRecord(record, current)) return null
  var next = derive(state)
  next.panes = copyMap(state.panes)
  next.panes[id] = record
  return next
}

function upsertTabs(state, list) {
  var next = null
  for (var i = 0; i < list.length; i++) {
    if (!isObject(list[i]) || !list[i].tab_id) continue
    var record = tabRecord(list[i])
    var source = next || state
    if (sameRecord(record, source.tabs[record.tabId])) continue
    if (!next) {
      next = derive(state)
      next.tabs = copyMap(state.tabs)
    }
    next.tabs[record.tabId] = record
  }
  return next
}

function upsertWorkspaces(state, list) {
  var next = null
  for (var i = 0; i < list.length; i++) {
    if (!isObject(list[i]) || !list[i].workspace_id) continue
    var record = workspaceRecord(list[i])
    var source = next || state
    if (sameRecord(record, source.workspaces[record.workspaceId])) continue
    if (!next) {
      next = derive(state)
      next.workspaces = copyMap(state.workspaces)
    }
    next.workspaces[record.workspaceId] = record
  }
  return next
}

function relabel(state, mapName, id, label) {
  var key = str(id)
  var current = state[mapName][key]
  if (!current || current.label === str(label)) return null
  var next = derive(state)
  next[mapName] = copyMap(state[mapName])
  var record = copyMap(current)
  record.label = str(label)
  next[mapName][key] = record
  return next
}

function removeTab(state, tabId) {
  var id = str(tabId)
  if (!id) return null
  var next = removePanes(state, function(pane) { return pane.tabId === id })
  if (!state.tabs[id]) return next
  next = next || derive(state)
  next.tabs = copyMap(state.tabs)
  delete next.tabs[id]
  return next
}

function removeWorkspace(state, workspaceId) {
  var id = str(workspaceId)
  if (!id) return null
  var next = removePanes(state, function(pane) { return pane.workspaceId === id })
  var source = next || state
  var tabs = {}
  var tabsRemoved = false
  for (var tabId in source.tabs) {
    if (source.tabs[tabId].workspaceId === id) tabsRemoved = true
    else tabs[tabId] = source.tabs[tabId]
  }
  if (tabsRemoved) {
    next = next || derive(state)
    next.tabs = tabs
  }
  if (source.workspaces[id]) {
    next = next || derive(state)
    next.workspaces = copyMap(source.workspaces)
    delete next.workspaces[id]
  }
  return next
}

// Applies f(state) -> state|null and keeps the last non-null result.
function chain(state, steps) {
  var current = state
  var touched = false
  for (var i = 0; i < steps.length; i++) {
    var result = steps[i](current)
    if (result) {
      current = result
      touched = true
    }
  }
  return touched ? current : null
}

function reduce(state, name, data) {
  switch (name) {
  case "pane_created":
  case "pane_updated":
    return upsertPane(state, data.pane)
  case "pane_focused": {
    var focused = str(data.pane_id)
    if (!focused || focused === state.focusedPaneId) return null
    var next = derive(state)
    next.focusedPaneId = focused
    return next
  }
  case "pane_closed":
  case "pane_exited":
    return removePane(state, data.pane_id)
  case "pane_moved":
    if (!isObject(data.pane) || !data.pane.pane_id) return null
    return chain(state, [
      function(s) {
        var moved = removePane(s, data.previous_pane_id)
        if (moved && s.focusedPaneId === str(data.previous_pane_id)) moved.focusedPaneId = str(data.pane.pane_id)
        return moved
      },
      function(s) { return data.closed_tab_id ? removeTab(s, data.closed_tab_id) : null },
      function(s) { return data.closed_workspace_id ? removeWorkspace(s, data.closed_workspace_id) : null },
      function(s) { return isObject(data.created_workspace) ? upsertWorkspaces(s, [data.created_workspace]) : null },
      function(s) { return isObject(data.created_tab) ? upsertTabs(s, [data.created_tab]) : null },
      function(s) { return upsertPane(s, data.pane) }
    ])
  case "pane_agent_detected":
    return patchPane(state, data.pane_id, { kind: data.released === true ? "" : str(data.agent) })
  case "pane_agent_status_changed": {
    var patch = { status: normalizeStatus(data.agent_status) }
    if (data.agent !== undefined && data.agent !== null) patch.kind = str(data.agent)
    if (data.display_agent !== undefined) patch.displayKind = str(data.display_agent)
    return patchPane(state, data.pane_id, patch)
  }
  case "tab_created":
    return isObject(data.tab) ? upsertTabs(state, [data.tab]) : null
  case "tab_moved":
    return Array.isArray(data.tabs) ? upsertTabs(state, data.tabs) : null
  case "tab_renamed":
    return relabel(state, "tabs", data.tab_id, data.label)
  case "tab_closed":
    return removeTab(state, data.tab_id)
  case "workspace_created":
  case "workspace_updated":
  case "workspace_metadata_updated":
  case "worktree_created":
  case "worktree_opened":
    return isObject(data.workspace) ? upsertWorkspaces(state, [data.workspace]) : null
  case "workspace_moved":
  case "workspace_reordered":
    return Array.isArray(data.workspaces) ? upsertWorkspaces(state, data.workspaces) : null
  case "workspace_renamed":
    return relabel(state, "workspaces", data.workspace_id, data.label)
  case "workspace_closed":
    return removeWorkspace(state, data.workspace_id)
  default:
    return null
  }
}

// Folds one event envelope. `changed` is true only when the Agents a Module
// would render differ, so noise never reaches the UI.
function applyEvent(state, envelope) {
  var current = state || fromSnapshot(null)
  if (!isObject(envelope) || !isObject(envelope.data)) return { state: current, changed: false }
  var name = str(envelope.event) || str(envelope.data.type)
  var next = null
  try {
    next = reduce(current, name, envelope.data)
  } catch (error) {
    next = null
  }
  if (!next) return { state: current, changed: false }
  finish(next)
  return { state: next, changed: next.agentsKey !== current.agentsKey }
}

function applyEvents(state, envelopes) {
  var current = state || fromSnapshot(null)
  var startKey = current.agentsKey
  var list = Array.isArray(envelopes) ? envelopes : []
  for (var i = 0; i < list.length; i++) current = applyEvent(current, list[i]).state
  return { state: current, changed: current.agentsKey !== startKey }
}

// ------------------------------------------------------------------ protocol

function socketPath(home) {
  return str(home).replace(/\/+$/, "") + "/.config/herdr/herdr.sock"
}

function requestLine(id, method, params) {
  return JSON.stringify({ id: str(id), method: str(method), params: isObject(params) ? params : {} }) + "\n"
}

// Focus the exact pane, switching herdr's workspace and tab to it. pane.focus
// takes a pane id only, where agent.focus resolves a looser target.
function focusLine(id, paneId) {
  var pane = str(paneId)
  return pane === "" ? "" : requestLine(id, "pane.focus", { pane_id: pane })
}

function subscribeLine(id) {
  return requestLine(id, "events.subscribe", {
    subscriptions: SUBSCRIPTION_TYPES.map(function(type) { return { type: type } })
  })
}

function parseJson(line) {
  try {
    return JSON.parse(str(line))
  } catch (error) {
    return undefined
  }
}

function errorOf(payload) {
  var error = isObject(payload.error) ? payload.error : {}
  return { code: str(error.code) || "error", message: str(error.message) }
}

function parseReplyLine(line) {
  var payload = parseJson(line)
  if (!isObject(payload)) return { ok: false, result: null, error: { code: "invalid_json", message: "" } }
  if (payload.error !== undefined && payload.error !== null) return { ok: false, result: null, error: errorOf(payload) }
  if (!("result" in payload)) return { ok: false, result: null, error: { code: "invalid_reply", message: "" } }
  return { ok: true, result: payload.result, error: null }
}

function snapshotFromReply(reply) {
  if (!reply || !reply.ok || !isObject(reply.result) || !isObject(reply.result.snapshot)) return null
  return reply.result.snapshot
}

function classifyStreamLine(line) {
  var payload = parseJson(line)
  if (!isObject(payload)) return { kind: "invalid" }
  if (payload.error !== undefined && payload.error !== null) return { kind: "error", error: errorOf(payload) }
  if (isObject(payload.result) && payload.result.type === "subscription_started") return { kind: "started" }
  if (typeof payload.event === "string" && isObject(payload.data)) return { kind: "event", envelope: payload }
  return { kind: "invalid" }
}

// Delay before reconnect attempt `attempt` (0-based): 500 ms doubling to 30 s.
function backoffDelay(attempt) {
  var n = Number(attempt)
  if (!isFinite(n) || n < 0) n = 0
  n = Math.floor(n)
  if (n >= 16) return BACKOFF_MAX_MS
  return Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * Math.pow(2, n))
}

// ------------------------------------------------------------------ reconciliation
// herdr replays recent history to every new subscriber, so events are never
// folded into published state. An event only says "a snapshot is due".

var RECONCILE_DEBOUNCE_MS = 250
var RECONCILE_MAX_WAIT_MS = 1000

// True when the event would change what a Module renders from `state`.
function eventInvalidates(state, envelope) {
  return applyEvent(state, envelope).changed
}

// Delay before the next re-snapshot, given how long a change has been pending.
// Debounces bursts, but a steady stream still refreshes within the max wait.
function reconcileDelay(pendingForMs) {
  var since = Number(pendingForMs)
  if (!isFinite(since) || since < 0) since = 0
  return Math.min(RECONCILE_DEBOUNCE_MS, Math.max(0, RECONCILE_MAX_WAIT_MS - since))
}

// True when two states would render the same Agents.
function sameAgents(a, b) {
  return !!a && !!b && typeof a.agentsKey === "string" && a.agentsKey === b.agentsKey
}

if (typeof module !== "undefined") {
  module.exports = {
    RECONCILE_DEBOUNCE_MS: RECONCILE_DEBOUNCE_MS,
    RECONCILE_MAX_WAIT_MS: RECONCILE_MAX_WAIT_MS,
    eventInvalidates: eventInvalidates,
    reconcileDelay: reconcileDelay,
    sameAgents: sameAgents,
    STATUSES: STATUSES,
    SUBSCRIPTION_TYPES: SUBSCRIPTION_TYPES,
    BACKOFF_MIN_MS: BACKOFF_MIN_MS,
    BACKOFF_MAX_MS: BACKOFF_MAX_MS,
    normalizeStatus: normalizeStatus,
    fromSnapshot: fromSnapshot,
    agents: agents,
    applyEvent: applyEvent,
    applyEvents: applyEvents,
    socketPath: socketPath,
    requestLine: requestLine,
    focusLine: focusLine,
    subscribeLine: subscribeLine,
    parseReplyLine: parseReplyLine,
    snapshotFromReply: snapshotFromReply,
    classifyStreamLine: classifyStreamLine,
    backoffDelay: backoffDelay
  }
}
