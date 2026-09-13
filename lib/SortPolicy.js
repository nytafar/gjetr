.pragma library

// Sort modes for the Agent List. `spaces` and `priority` mirror herdr's own
// agent panel, so the Display never disagrees with the sidebar it replaces;
// `cache` is gjetr's own. Pure and stable.
//
// - spaces:   herdr order. herdr's `spaces` panel applies no sort; its entries
//             are built in workspace, tab and pane order, which is the order of
//             session.snapshot `agents` (herdr 0.8.2 src/app/agent_view.rs).
// - priority: herdr's `priority` panel ("attention queue"), apply_agent_view:
//             attention rank descending, then the most recent state change
//             first (state_change_seq descending, missing after present).
//             Rank is src/app/api_helpers.rs tab_attention_priority:
//             blocked 4, done 3, working 2, idle 1, unknown 0.
// - cache:    soonest-expiring first, so the prompt cache about to go cold is
//             on top: live timers by seconds left ascending, then expired
//             (cold) timers, then Agents without a Cache timer; ties by
//             attention rank, then recency. Deliberately the reverse of the
//             cache-ttl plugin's "warmest first" view.

var MODES = ["spaces", "priority", "cache"]
var DEFAULT_MODE = "spaces"

var ATTENTION = { blocked: 4, done: 3, working: 2, idle: 1, unknown: 0 }

function own(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key)
}

function normalizeMode(mode) {
  var value = mode === undefined || mode === null ? "" : String(mode).trim()
  return MODES.indexOf(value) >= 0 ? value : DEFAULT_MODE
}

function nextMode(mode) {
  var index = MODES.indexOf(normalizeMode(mode))
  return MODES[(index + 1) % MODES.length]
}

function attentionRank(status) {
  return own(ATTENTION, status) ? ATTENTION[status] : ATTENTION.unknown
}

function isNumber(value) {
  return typeof value === "number" && isFinite(value)
}

function decorate(agents) {
  var list = Array.isArray(agents) ? agents : []
  var rows = []
  for (var i = 0; i < list.length; i++) {
    if (list[i] && typeof list[i] === "object") rows.push({ agent: list[i], order: i })
  }
  return rows
}

function undecorate(rows) {
  return rows.map(function(row) { return row.agent })
}

// Descending, with a missing value after any present one (herdr's Reverse over
// an Option, and the agent view's "missing values stay after present values").
function descendingPresentFirst(a, b) {
  var hasA = isNumber(a)
  var hasB = isNumber(b)
  if (hasA && hasB) return b - a
  if (hasA) return -1
  if (hasB) return 1
  return 0
}

function byAttentionThenRecency(a, b) {
  return (attentionRank(b.agent.status) - attentionRank(a.agent.status))
    || descendingPresentFirst(a.agent.stateChangeSeq, b.agent.stateChangeSeq)
}

function bySpaces(rows) {
  var groups = {}
  var next = 0
  for (var i = 0; i < rows.length; i++) {
    var key = "#" + String(rows[i].agent.workspaceId)
    if (!own(groups, key)) groups[key] = next++
    rows[i].group = groups[key]
  }
  return rows.sort(function(a, b) { return (a.group - b.group) || (a.order - b.order) })
}

function byPriority(rows) {
  return rows.sort(function(a, b) { return byAttentionThenRecency(a, b) || (a.order - b.order) })
}

// remaining: paneId -> remaining seconds (CacheTimerModel.remainingByPane).
// Groups: a live timer (seconds left > 0) by seconds left ascending, then a
// cold one (expired), then no timer. Within a group, attention, then recency.
function byCache(rows, remaining) {
  var map = remaining && typeof remaining === "object" ? remaining : {}
  for (var i = 0; i < rows.length; i++) {
    var id = rows[i].agent.paneId
    var known = own(map, id) && isNumber(map[id])
    rows[i].cacheGroup = !known ? 2 : map[id] > 0 ? 0 : 1
    rows[i].cacheLeft = known && map[id] > 0 ? map[id] : 0
  }
  return rows.sort(function(a, b) {
    return (a.cacheGroup - b.cacheGroup) || (a.cacheLeft - b.cacheLeft)
      || byAttentionThenRecency(a, b) || (a.order - b.order)
  })
}

function sortAgents(agents, mode, remaining) {
  var rows = decorate(agents)
  var name = normalizeMode(mode)
  if (name === "priority") return undecorate(byPriority(rows))
  if (name === "cache") return undecorate(byCache(rows, remaining))
  return undecorate(bySpaces(rows))
}

// Same Agents, same objects, same order. Lets the service keep its model when
// a re-sort changes nothing, so Cards are not rebuilt every clock tick.
function sameOrder(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
  for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

if (typeof module !== "undefined") {
  module.exports = {
    MODES: MODES,
    DEFAULT_MODE: DEFAULT_MODE,
    ATTENTION: ATTENTION,
    normalizeMode: normalizeMode,
    nextMode: nextMode,
    attentionRank: attentionRank,
    sortAgents: sortAgents,
    sameOrder: sameOrder
  }
}
