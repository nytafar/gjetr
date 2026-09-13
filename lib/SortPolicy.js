.pragma library

// Sort modes for the Agent List. Pure and stable: equal keys keep herdr's
// order, which HerdrModel already groups by workspace and tab.
//
// - spaces:   herdr order, grouped by workspace in order of first appearance
// - priority: blocked > done > idle > working > unknown
// - cache:    live Cache timers first, least time left first; then expired
//             (cold) ones; then Agents without a Cache timer. Ties go to
//             priority, then herdr order. A cold cache is already lost, so it
//             ranks below any cache that can still be saved.

var MODES = ["spaces", "priority", "cache"]
var DEFAULT_MODE = "spaces"

var PRIORITY = { blocked: 0, done: 1, idle: 2, working: 3, unknown: 4 }

function normalizeMode(mode) {
  var value = mode === undefined || mode === null ? "" : String(mode).trim()
  return MODES.indexOf(value) >= 0 ? value : DEFAULT_MODE
}

function nextMode(mode) {
  var index = MODES.indexOf(normalizeMode(mode))
  return MODES[(index + 1) % MODES.length]
}

function priorityRank(status) {
  return Object.prototype.hasOwnProperty.call(PRIORITY, status) ? PRIORITY[status] : PRIORITY.unknown
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

function bySpaces(rows) {
  var groups = {}
  var next = 0
  for (var i = 0; i < rows.length; i++) {
    var key = "#" + String(rows[i].agent.workspaceId)
    if (!Object.prototype.hasOwnProperty.call(groups, key)) groups[key] = next++
    rows[i].group = groups[key]
  }
  return rows.sort(function(a, b) { return (a.group - b.group) || (a.order - b.order) })
}

function byPriority(rows) {
  return rows.sort(function(a, b) {
    return (priorityRank(a.agent.status) - priorityRank(b.agent.status)) || (a.order - b.order)
  })
}

// remaining: paneId -> remaining seconds (CacheTimerModel.remainingByPane).
function byCache(rows, remaining) {
  var map = remaining && typeof remaining === "object" ? remaining : {}
  for (var i = 0; i < rows.length; i++) {
    var id = rows[i].agent.paneId
    var has = Object.prototype.hasOwnProperty.call(map, id) && typeof map[id] === "number" && isFinite(map[id])
    rows[i].bucket = !has ? 2 : (map[id] > 0 ? 0 : 1)
    rows[i].remaining = rows[i].bucket === 0 ? map[id] : 0
  }
  return rows.sort(function(a, b) {
    return (a.bucket - b.bucket)
      || (a.remaining - b.remaining)
      || (priorityRank(a.agent.status) - priorityRank(b.agent.status))
      || (a.order - b.order)
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
    PRIORITY: PRIORITY,
    normalizeMode: normalizeMode,
    nextMode: nextMode,
    priorityRank: priorityRank,
    sortAgents: sortAgents,
    sameOrder: sameOrder
  }
}
