.pragma library
.import "HerdrSchema.js" as HerdrSchema

// All herdr protocol knowledge lives here: request and subscription lines,
// reply parsing, snapshot + events -> Agents, collapsing, and the reconnect
// schedule. Pure; the QML connection only moves bytes and timers. What each
// supported herdr build names is in the generated HerdrSchema.js, and
// tests/HerdrSchema.test.js holds this file to it.
//
// Protocol facts (herdr 0.8.2, socket protocol 20), verified in
// finding T01, and unchanged in 0.9.0 (protocol 22) unless noted:
// - one JSON request line per connection; only events.subscribe stays open
// - match a reply on the first line back, not the id (parse errors use id "")
// - events arrive as {"event":"pane_updated","data":{"type":"pane_updated",...}}
// - pane.agent_status_changed, pane.scroll_changed and pane.output_matched
//   need a pane_id; asking for them unscoped fails the whole subscription
// - in 0.8.2 every new subscriber first receives a paced replay of recent
//   history; 0.9.0 starts a lifecycle subscription with live events and asks
//   clients to subscribe before their first snapshot. Both are met by
//   subscribing first and treating events as never state: published Agents
//   come from session.snapshot only, and events decide when to take the next
//   one (see reconciliation below)

var STATUSES = ["idle", "working", "blocked", "done", "unknown"]

// Claude session ids are UUIDs; they later name a transcript file.
var SESSION_ID_RE = /^[0-9A-Za-z][0-9A-Za-z_-]{7,63}$/

var BACKOFF_MIN_MS = 500
var BACKOFF_MAX_MS = 30000

// herdr builds gjetr is tested against: one per schema fixture. A ping per
// connection records the server's version and protocol; a protocol outside
// this set is published as a mismatch and shown quietly, never refused:
// herdr's API changes additively.
var SUPPORTED = HerdrSchema.SUPPORTED

// Every event name `reduce` folds; each must exist in every supported build.
var HANDLED_EVENTS = [
  "pane_created", "pane_updated", "pane_focused", "tab_focused", "workspace_focused",
  "pane_closed", "pane_exited", "pane_moved", "pane_agent_detected", "pane_agent_status_changed",
  "tab_created", "tab_moved", "tab_renamed", "tab_closed",
  "workspace_created", "workspace_updated", "workspace_metadata_updated", "worktree_created", "worktree_opened",
  "workspace_moved", "workspace_reordered", "workspace_renamed", "workspace_closed"
]

// Global subscription types only. Focus of tabs and workspaces is the noisiest
// part of the stream; it is followed for the Focused workspace, and collapses to
// nothing unless the focused id actually changes.
var SUBSCRIPTION_TYPES = [
  "workspace.created", "workspace.updated", "workspace.renamed",
  "workspace.moved", "workspace.reordered", "workspace.closed", "workspace.focused",
  "worktree.created", "worktree.opened",
  "tab.created", "tab.closed", "tab.renamed", "tab.moved", "tab.focused",
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
    name: str(base.name),
    stateChangeSeq: base.stateChangeSeq === undefined ? null : base.stateChangeSeq,
    sessionId: str(base.sessionId),
    herdrOrder: base.herdrOrder === undefined ? -1 : base.herdrOrder
  }
}

// The facts herdr keeps per Agent rather than per pane: its name (null unless
// the agent was named), when its status last changed (herdr's priority
// tiebreak), its agent session, and herdr's own Agent order.
function applyAgentInfo(record, info, index) {
  record.name = str(info.name)
  var seq = Number(info.state_change_seq)
  record.stateChangeSeq = info.state_change_seq !== undefined && info.state_change_seq !== null && isFinite(seq) && seq >= 0
    ? seq : null
  var session = isObject(info.agent_session) ? info.agent_session : null
  record.sessionId = session && session.kind === "id" && SESSION_ID_RE.test(str(session.value)) ? str(session.value) : ""
  record.herdrOrder = index
}

// herdr's rolled-up agent_status of a tab or workspace. Only the snapshot is
// known to carry it; a record without one keeps the last, or "".
function rolledStatus(item, previous) {
  if (item.agent_status !== undefined && item.agent_status !== null) return normalizeStatus(item.agent_status)
  return previous ? str(previous.status) : ""
}

function tabRecord(tab, previous) {
  return { tabId: str(tab.tab_id), workspaceId: str(tab.workspace_id), label: str(tab.label), number: num(tab.number),
    status: rolledStatus(tab, previous) }
}

function workspaceRecord(workspace, previous) {
  return { workspaceId: str(workspace.workspace_id), label: str(workspace.label), number: num(workspace.number),
    status: rolledStatus(workspace, previous) }
}

function sameRecord(a, b) {
  if (!a || !b) return false
  for (var key in a) if (a[key] !== b[key]) return false
  for (var other in b) if (!(other in a)) return false
  return true
}

// ------------------------------------------------------------------ state

function emptyState() {
  return { panes: {}, tabs: {}, workspaces: {}, focusedPaneId: "", focusedTabId: "", focusedWorkspaceId: "",
    tabOrder: [], paneOrder: [], agentList: [], agentsKey: "[]", treeData: null, treeKey: "", focusKey: "" }
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
        name: pane.name,
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

// Position of an id in herdr's snapshot order; ids herdr has not listed yet
// (created by an event) come after, in the order they arrived.
function orderOf(order, id, fallback) {
  var index = Array.isArray(order) ? order.indexOf(id) : -1
  return index >= 0 ? index : Number.MAX_SAFE_INTEGER / 2 + fallback
}

// The workspace > tab > pane tree the Workspace List draws, with every pane,
// agent or not. Workspaces follow their number (their position in herdr);
// tabs and panes follow herdr's snapshot order, since a tab's number is an id
// counter rather than its position. Panes carry the same fields as Agents, so
// NamePolicy names them the same way.
function buildTree(state) {
  var workspaces = []
  var index = 0
  for (var wid in state.workspaces) workspaces.push({ record: state.workspaces[wid], order: index++, tabs: [] })
  workspaces.sort(function(a, b) { return (a.record.number - b.record.number) || (a.order - b.order) })
  var byWorkspace = {}
  for (var w = 0; w < workspaces.length; w++) byWorkspace["#" + workspaces[w].record.workspaceId] = workspaces[w]
  var tabs = []
  index = 0
  for (var tid in state.tabs) tabs.push({ record: state.tabs[tid], order: orderOf(state.tabOrder, tid, index++), panes: [] })
  tabs.sort(function(a, b) { return a.order - b.order })
  var byTab = {}
  for (var t = 0; t < tabs.length; t++) {
    var owner = byWorkspace["#" + tabs[t].record.workspaceId]
    if (!owner) continue
    owner.tabs.push(tabs[t])
    byTab["#" + tabs[t].record.tabId] = tabs[t]
  }
  var panes = []
  index = 0
  for (var pid in state.panes) panes.push({ record: state.panes[pid], order: orderOf(state.paneOrder, pid, index++) })
  panes.sort(function(a, b) { return a.order - b.order })
  for (var p = 0; p < panes.length; p++) {
    var pane = panes[p].record
    var home = byTab["#" + pane.tabId]
    if (!home) continue
    var workspace = state.workspaces[pane.workspaceId] || state.workspaces[home.record.workspaceId]
    home.panes.push({
      paneId: pane.paneId,
      tabId: pane.tabId,
      workspaceId: home.record.workspaceId,
      kind: pane.kind,
      displayKind: pane.displayKind || pane.kind,
      status: pane.status,
      title: pane.title,
      name: pane.name,
      paneLabel: pane.paneLabel,
      cwd: pane.cwd,
      focused: pane.paneId === state.focusedPaneId,
      tabLabel: home.record.label,
      tabNumber: home.record.number,
      workspaceLabel: workspace ? workspace.label : "",
      workspaceNumber: workspace ? workspace.number : 0
    })
  }
  return {
    focusedWorkspaceId: state.focusedWorkspaceId,
    focusedTabId: state.focusedTabId,
    focusedPaneId: state.focusedPaneId,
    workspaces: workspaces.map(function(entry) {
      return {
        workspaceId: entry.record.workspaceId,
        label: entry.record.label,
        number: entry.record.number,
        status: entry.record.status,
        tabs: entry.tabs.map(function(tab) {
          return { tabId: tab.record.tabId, workspaceId: tab.record.workspaceId, label: tab.record.label,
            number: tab.record.number, status: tab.record.status, panes: tab.panes }
        })
      }
    })
  }
}

function finish(state) {
  state.agentList = buildAgents(state)
  state.agentsKey = JSON.stringify(state.agentList)
  state.treeData = buildTree(state)
  state.treeKey = JSON.stringify(state.treeData)
  state.focusKey = state.focusedWorkspaceId + "|" + state.focusedTabId
  return state
}

function derive(state) {
  return {
    panes: state.panes,
    tabs: state.tabs,
    workspaces: state.workspaces,
    focusedPaneId: state.focusedPaneId,
    focusedTabId: state.focusedTabId,
    focusedWorkspaceId: state.focusedWorkspaceId,
    tabOrder: state.tabOrder,
    paneOrder: state.paneOrder,
    agentList: state.agentList,
    agentsKey: state.agentsKey,
    treeData: state.treeData,
    treeKey: state.treeKey,
    focusKey: state.focusKey
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
    if (!isObject(tabs[i]) || !tabs[i].tab_id) continue
    state.tabs[str(tabs[i].tab_id)] = tabRecord(tabs[i])
    state.tabOrder.push(str(tabs[i].tab_id))
    if (tabs[i].focused === true) state.focusedTabId = str(tabs[i].tab_id)
  }
  var panes = Array.isArray(snap.panes) ? snap.panes : []
  for (i = 0; i < panes.length; i++) {
    if (!isObject(panes[i]) || !panes[i].pane_id) continue
    state.panes[str(panes[i].pane_id)] = paneRecord(panes[i])
    state.paneOrder.push(str(panes[i].pane_id))
    if (panes[i].focused === true && !snap.focused_pane_id) state.focusedPaneId = str(panes[i].pane_id)
  }
  if (snap.focused_pane_id) state.focusedPaneId = str(snap.focused_pane_id)
  for (i = 0; i < workspaces.length; i++) {
    if (isObject(workspaces[i]) && workspaces[i].focused === true) state.focusedWorkspaceId = str(workspaces[i].workspace_id)
  }
  if (snap.focused_tab_id) state.focusedTabId = str(snap.focused_tab_id)
  if (snap.focused_workspace_id) state.focusedWorkspaceId = str(snap.focused_workspace_id)
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

function tree(state) {
  return state && state.treeData ? state.treeData : buildTree(emptyState())
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
  if (pane.focused === true) {
    if (record.tabId !== "") next.focusedTabId = record.tabId
    if (record.workspaceId !== "") next.focusedWorkspaceId = record.workspaceId
  }
  return next
}

// Focus moved: any of the ids may be "" to leave it as it is.
function refocus(state, paneId, tabId, workspaceId) {
  var pane = str(paneId) || state.focusedPaneId
  var tab = str(tabId) || state.focusedTabId
  var workspace = str(workspaceId) || state.focusedWorkspaceId
  if (pane === state.focusedPaneId && tab === state.focusedTabId && workspace === state.focusedWorkspaceId) return null
  var next = derive(state)
  next.focusedPaneId = pane
  next.focusedTabId = tab
  next.focusedWorkspaceId = workspace
  return next
}

function reorderTabs(state, list) {
  var order = []
  for (var i = 0; i < list.length; i++) if (isObject(list[i]) && list[i].tab_id) order.push(str(list[i].tab_id))
  for (var j = 0; j < state.tabOrder.length; j++) if (order.indexOf(state.tabOrder[j]) < 0) order.push(state.tabOrder[j])
  if (order.join("\n") === state.tabOrder.join("\n")) return null
  var next = derive(state)
  next.tabOrder = order
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
    var source = next || state
    var record = tabRecord(list[i], source.tabs[str(list[i].tab_id)])
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
    var source = next || state
    var record = workspaceRecord(list[i], source.workspaces[str(list[i].workspace_id)])
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
    if (!focused) return null
    var record = state.panes[focused]
    return refocus(state, focused, record ? record.tabId : "", str(data.workspace_id) || (record ? record.workspaceId : ""))
  }
  case "tab_focused": {
    var tabId = str(data.tab_id) || (isObject(data.tab) ? str(data.tab.tab_id) : "")
    if (!tabId) return null
    var tab = state.tabs[tabId]
    return refocus(state, "", tabId, str(data.workspace_id) || (tab ? tab.workspaceId : ""))
  }
  case "workspace_focused": {
    var workspaceId = str(data.workspace_id) || (isObject(data.workspace) ? str(data.workspace.workspace_id) : "")
    return workspaceId ? refocus(state, "", "", workspaceId) : null
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
    if (!Array.isArray(data.tabs)) return null
    return chain(state, [
      function(s) { return upsertTabs(s, data.tabs) },
      function(s) { return reorderTabs(s, data.tabs) }
    ])
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
// would render differ, so noise never reaches the UI. `treeChanged` covers the
// whole workspace tree, panes without an agent included; `focusChanged` the
// Focused workspace and tab.
function applyEvent(state, envelope) {
  var current = state || fromSnapshot(null)
  var none = { state: current, changed: false, treeChanged: false, focusChanged: false }
  if (!isObject(envelope) || !isObject(envelope.data)) return none
  var name = str(envelope.event) || str(envelope.data.type)
  var next = null
  try {
    next = reduce(current, name, envelope.data)
  } catch (error) {
    next = null
  }
  if (!next) return none
  finish(next)
  return { state: next, changed: next.agentsKey !== current.agentsKey, treeChanged: next.treeKey !== current.treeKey,
    focusChanged: next.focusKey !== current.focusKey }
}

function applyEvents(state, envelopes) {
  var start = state || fromSnapshot(null)
  var current = start
  var list = Array.isArray(envelopes) ? envelopes : []
  for (var i = 0; i < list.length; i++) current = applyEvent(current, list[i]).state
  return { state: current, changed: current.agentsKey !== start.agentsKey, treeChanged: current.treeKey !== start.treeKey,
    focusChanged: current.focusKey !== start.focusKey }
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

// Focus a workspace, tab or pane: herdr switches to it as its own sidebar does.
function focusTargetLine(id, kind, targetId) {
  var target = str(targetId)
  if (target === "") return ""
  if (kind === "pane") return focusLine(id, target)
  if (kind === "tab") return requestLine(id, "tab.focus", { tab_id: target })
  if (kind === "workspace") return requestLine(id, "workspace.focus", { workspace_id: target })
  return ""
}

// Subscribe to `types`, SUBSCRIPTION_TYPES by default. A connection passes
// fewer after herdr refused one as an unknown variant.
function subscribeLine(id, types) {
  var list = Array.isArray(types) ? types : SUBSCRIPTION_TYPES
  return requestLine(id, "events.subscribe", {
    subscriptions: list.map(function(type) { return { type: str(type) } })
  })
}

function withoutType(types, type) {
  var list = Array.isArray(types) ? types : []
  return list.filter(function(item) { return item !== type })
}

function pingLine(id) {
  return requestLine(id, "ping")
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

// { version, protocol } from a `ping` reply, or null. herdr's pong is
// {"type":"pong","version":"0.8.2","protocol":20,"capabilities":{...}}.
function pongFromReply(reply) {
  if (!reply || !reply.ok || !isObject(reply.result) || reply.result.type !== "pong") return null
  var protocol = reply.result.protocol
  if (typeof protocol !== "number" || !isFinite(protocol) || protocol < 0 || Math.floor(protocol) !== protocol) return null
  return { version: typeof reply.result.version === "string" ? reply.result.version : "", protocol: protocol }
}

function supportedProtocol(protocol) {
  for (var i = 0; i < SUPPORTED.length; i++) if (SUPPORTED[i].protocol === protocol) return true
  return false
}

// The server as a ping found it. `mismatch` is set only when herdr answered
// with a protocol outside SUPPORTED; before a pong nothing is known and
// nothing is a mismatch.
function protocolStatus(pong) {
  if (!isObject(pong) || typeof pong.protocol !== "number") return { version: "", protocol: null, supported: false, mismatch: null }
  var version = str(pong.version)
  var supported = supportedProtocol(pong.protocol)
  return {
    version: version,
    protocol: pong.protocol,
    supported: supported,
    mismatch: supported ? null : {
      version: version,
      protocol: pong.protocol,
      supported: SUPPORTED.map(function(entry) { return { version: entry.version, protocol: entry.protocol } })
    }
  }
}

// One quiet line for a Module to show while connected to an untested herdr.
function mismatchCue(mismatch) {
  if (!isObject(mismatch) || typeof mismatch.protocol !== "number") return ""
  var version = str(mismatch.version)
  return "untested herdr" + (version !== "" ? " " + version : "") + " (protocol " + mismatch.protocol + ")"
}

// herdr rejects a method or subscription type it does not know while parsing
// the request, as invalid_request "unknown variant `x`, expected one of ...".
// That names a feature this server lacks, not a broken connection. Returns
// the variant, or "" for any other error.
function unsupportedVariant(error) {
  if (!isObject(error) || error.code !== "invalid_request") return ""
  var match = /unknown variant `([^`]{1,128})`/.exec(str(error.message))
  return match ? match[1] : ""
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
// herdr 0.8.2 replays recent history to every new subscriber (0.9.0 no longer
// does), so events are never folded into published state. An event only says
// "a snapshot is due".

var RECONCILE_DEBOUNCE_MS = 250
var RECONCILE_MAX_WAIT_MS = 1000

// True when the event would change what a Module renders from `state`: the
// Agents, the Focused workspace, and with `includeTree` any pane of the tree.
function eventInvalidates(state, envelope, includeTree) {
  var out = applyEvent(state, envelope)
  return out.changed || out.focusChanged || (includeTree === true && out.treeChanged)
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

// True when two states would render the same workspace tree.
function sameTree(a, b) {
  return !!a && !!b && typeof a.treeKey === "string" && a.treeKey !== "" && a.treeKey === b.treeKey
}

if (typeof module !== "undefined") {
  module.exports = {
    RECONCILE_DEBOUNCE_MS: RECONCILE_DEBOUNCE_MS,
    RECONCILE_MAX_WAIT_MS: RECONCILE_MAX_WAIT_MS,
    eventInvalidates: eventInvalidates,
    reconcileDelay: reconcileDelay,
    sameAgents: sameAgents,
    sameTree: sameTree,
    tree: tree,
    focusTargetLine: focusTargetLine,
    STATUSES: STATUSES,
    SUBSCRIPTION_TYPES: SUBSCRIPTION_TYPES,
    SUPPORTED: SUPPORTED,
    HANDLED_EVENTS: HANDLED_EVENTS,
    pingLine: pingLine,
    pongFromReply: pongFromReply,
    protocolStatus: protocolStatus,
    mismatchCue: mismatchCue,
    unsupportedVariant: unsupportedVariant,
    withoutType: withoutType,
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
