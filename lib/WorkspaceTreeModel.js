.pragma library
.import "SortPolicy.js" as SortPolicy
.import "NamePolicy.js" as NamePolicy
.import "AttentionModel.js" as AttentionModel
.import "KindPolicy.js" as KindPolicy

// The Workspace List: herdr's workspace > tab > pane tree as the rows a Module
// draws, which of them are expanded, and what a tap on a row does. Pure; the
// service holds the expansion state per Module and feeds it herdr's tree
// (HerdrModel.tree) and Attention.
//
// Rows:
// - workspace: rolled-up status, label (or number), tab count
// - tab: rolled-up status, label (or number), pane count, or for a tab with
//   one pane that pane's agent kind ("shell" without an agent). A one-pane
//   tab is a leaf: expanding it would only repeat the tab.
// - pane: status, agent kind or "shell", name by NamePolicy like a Card
// A rolled-up status is herdr's own when the snapshot carries one, otherwise
// the most urgent status below it in herdr's attention order. Attention shows
// on a pane in Attention and on every row above it.
//
// Node keys: "w:<workspace id>", "t:<tab id>", "p:<pane id>".

var TAP_MODES = ["expand", "focus"]
var DEFAULT_TAP = "expand"
var STATUSES = ["idle", "working", "blocked", "done", "unknown"]

function str(value) {
  return value === undefined || value === null ? "" : String(value)
}

function own(object, key) {
  return object !== null && typeof object === "object" && Object.prototype.hasOwnProperty.call(object, key)
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function list(value) {
  return Array.isArray(value) ? value.filter(isObject) : []
}

// Own, enumerable property even for names like __proto__.
function put(object, key, value) {
  Object.defineProperty(object, key, { value: value, enumerable: true, writable: true, configurable: true })
}

function normalizeTap(mode) {
  return TAP_MODES.indexOf(mode) >= 0 ? mode : DEFAULT_TAP
}

function plural(count, one, many) {
  return count === 1 ? "1 " + one : count + " " + many
}

// ------------------------------------------------------------------ status

function rollupStatus(statuses) {
  var best = "unknown"
  var source = Array.isArray(statuses) ? statuses : []
  for (var i = 0; i < source.length; i++) {
    if (SortPolicy.attentionRank(source[i]) > SortPolicy.attentionRank(best)) best = source[i]
  }
  return best
}

function ownStatus(node, childStatuses) {
  var status = str(node.status)
  return STATUSES.indexOf(status) >= 0 ? status : rollupStatus(childStatuses)
}

// "blocked" beats "done"; "" when nothing below is in Attention.
function rollupAttention(values) {
  var out = ""
  for (var i = 0; i < values.length; i++) {
    if (values[i] === "blocked") return "blocked"
    if (values[i] === "done") out = "done"
  }
  return out
}

function label(node) {
  var text = str(node.label).trim()
  if (text !== "") return text
  return node.number !== undefined && node.number !== null && str(node.number) !== "" ? str(node.number) : ""
}

function kindLabel(pane) {
  return str(pane.kind) === "" ? "shell" : KindPolicy.kindLabel(str(pane.kind), str(pane.displayKind))
}

// ------------------------------------------------------------------ expansion

// { "<module key>": { "<node key>": true } }
function emptyExpanded() {
  return {}
}

function isNodeKey(value) {
  return typeof value === "string" && /^[wt]:[^\u0000-\u001f\u007f]{1,64}$/.test(value)
}

function isExpanded(state, moduleKey, nodeKey) {
  return own(state, moduleKey) && own(state[moduleKey], nodeKey) && state[moduleKey][nodeKey] === true
}

// A new state with the node flipped; the same state for junk keys.
function toggleExpanded(state, moduleKey, nodeKey) {
  var current = isObject(state) ? state : {}
  if (typeof moduleKey !== "string" || moduleKey === "" || !isNodeKey(nodeKey)) return current
  var next = {}
  var modules = Object.keys(current)
  for (var i = 0; i < modules.length; i++) if (modules[i] !== moduleKey) put(next, modules[i], current[modules[i]])
  var nodes = {}
  var keys = own(current, moduleKey) ? Object.keys(current[moduleKey]) : []
  for (var j = 0; j < keys.length; j++) {
    if (keys[j] !== nodeKey && current[moduleKey][keys[j]] === true) put(nodes, keys[j], true)
  }
  if (!isExpanded(current, moduleKey, nodeKey)) put(nodes, nodeKey, true)
  if (Object.keys(nodes).length > 0) put(next, moduleKey, nodes)
  return next
}

function nodeExists(tree, nodeKey) {
  var key = str(nodeKey)
  var workspaces = list(tree && tree.workspaces)
  for (var w = 0; w < workspaces.length; w++) {
    if (key === "w:" + str(workspaces[w].workspaceId)) return true
    var tabs = list(workspaces[w].tabs)
    for (var t = 0; t < tabs.length; t++) {
      if (key === "t:" + str(tabs[t].tabId)) return true
      var panes = list(tabs[t].panes)
      for (var p = 0; p < panes.length; p++) if (key === "p:" + str(panes[p].paneId)) return true
    }
  }
  return false
}

// Forgets workspaces and tabs that are gone. Returns the same state when
// nothing is dropped, so bindings on it do not re-evaluate on every update.
function pruneExpanded(state, tree) {
  var current = isObject(state) ? state : {}
  var changed = false
  var next = {}
  var modules = Object.keys(current)
  for (var m = 0; m < modules.length; m++) {
    var nodes = {}
    var keys = Object.keys(current[modules[m]] || {})
    for (var k = 0; k < keys.length; k++) {
      if (current[modules[m]][keys[k]] === true && nodeExists(tree, keys[k])) put(nodes, keys[k], true)
      else changed = true
    }
    if (Object.keys(nodes).length > 0) put(next, modules[m], nodes)
    else changed = true
  }
  return changed ? next : current
}

// ------------------------------------------------------------------ rows

function paneRow(pane, attention) {
  return {
    key: "p:" + str(pane.paneId),
    type: "pane",
    depth: 2,
    id: str(pane.paneId),
    paneId: str(pane.paneId),
    label: NamePolicy.agentName(pane),
    name: NamePolicy.agentName(pane),
    detail: kindLabel(pane),
    kindLabel: kindLabel(pane),
    kind: str(pane.kind),
    displayKind: str(pane.displayKind),
    isAgent: str(pane.kind) !== "",
    status: STATUSES.indexOf(str(pane.status)) >= 0 ? str(pane.status) : "unknown",
    focused: pane.focused === true,
    attention: AttentionModel.attentionOf(attention, str(pane.paneId)),
    expandable: false,
    expanded: false
  }
}

// The rows to draw, top to bottom, for one Module's expansion state.
function rows(tree, expanded, moduleKey, attention) {
  var out = []
  var focusedWorkspace = str(tree && tree.focusedWorkspaceId)
  var focusedTab = str(tree && tree.focusedTabId)
  var workspaces = list(tree && tree.workspaces)
  for (var w = 0; w < workspaces.length; w++) {
    var workspace = workspaces[w]
    var workspaceKey = "w:" + str(workspace.workspaceId)
    var tabs = list(workspace.tabs)
    var tabRows = []
    var tabStatuses = []
    var tabAttention = []
    for (var t = 0; t < tabs.length; t++) {
      var tab = tabs[t]
      var tabKey = "t:" + str(tab.tabId)
      var panes = list(tab.panes)
      var paneRows = panes.map(function(pane) { return paneRow(pane, attention) })
      var status = ownStatus(tab, paneRows.map(function(row) { return row.status }))
      var single = paneRows.length === 1 ? paneRows[0] : null
      var tabRow = {
        key: tabKey,
        type: "tab",
        depth: 1,
        id: str(tab.tabId),
        paneId: single ? single.paneId : "",
        label: label(tab),
        detail: single ? single.kindLabel : plural(paneRows.length, "pane", "panes"),
        kind: single ? single.kind : "",
        displayKind: single ? single.displayKind : "",
        isAgent: !!single && single.isAgent,
        status: status,
        focused: str(tab.tabId) === focusedTab,
        attention: rollupAttention(paneRows.map(function(row) { return row.attention })),
        expandable: paneRows.length > 1,
        expanded: paneRows.length > 1 && isExpanded(expanded, moduleKey, tabKey)
      }
      tabStatuses.push(status)
      tabAttention.push(tabRow.attention)
      tabRows.push(tabRow)
      if (tabRow.expanded) for (var p = 0; p < paneRows.length; p++) tabRows.push(paneRows[p])
    }
    var workspaceRow = {
      key: workspaceKey,
      type: "workspace",
      depth: 0,
      id: str(workspace.workspaceId),
      paneId: "",
      label: label(workspace),
      detail: plural(tabs.length, "tab", "tabs"),
      kind: "",
      displayKind: "",
      isAgent: false,
      status: ownStatus(workspace, tabStatuses),
      focused: str(workspace.workspaceId) === focusedWorkspace,
      attention: rollupAttention(tabAttention),
      expandable: tabs.length > 0,
      expanded: tabs.length > 0 && isExpanded(expanded, moduleKey, workspaceKey)
    }
    out.push(workspaceRow)
    if (workspaceRow.expanded) out = out.concat(tabRows)
  }
  return out
}

// ------------------------------------------------------------------ taps

// What a tap on a row does. `zone` is "row" or "chevron".
// - expand mode: a parent toggles, wherever it is tapped; a leaf focuses its
//   pane (a pane row, or a tab with one pane).
// - focus mode: the row focuses its workspace, tab or pane in herdr; the
//   chevron toggles a parent and acts like the row on a leaf.
// -> { action: "toggle", key } | { action: "focus", kind, id } | { action: "none" }
function tapAction(row, tapMode, zone) {
  if (!isObject(row) || str(row.key) === "") return { action: "none" }
  var mode = normalizeTap(tapMode)
  if (row.expandable === true && (mode === "expand" || zone === "chevron")) return { action: "toggle", key: row.key }
  if (mode === "focus") {
    if (row.type === "workspace" && str(row.id) !== "") return { action: "focus", kind: "workspace", id: row.id }
    if (row.type === "tab" && str(row.id) !== "") return { action: "focus", kind: "tab", id: row.id }
  }
  if (str(row.paneId) !== "") return { action: "focus", kind: "pane", id: row.paneId }
  return { action: "none" }
}

if (typeof module !== "undefined") {
  module.exports = {
    TAP_MODES: TAP_MODES,
    DEFAULT_TAP: DEFAULT_TAP,
    normalizeTap: normalizeTap,
    rollupStatus: rollupStatus,
    emptyExpanded: emptyExpanded,
    isExpanded: isExpanded,
    toggleExpanded: toggleExpanded,
    nodeExists: nodeExists,
    pruneExpanded: pruneExpanded,
    rows: rows,
    tapAction: tapAction
  }
}
