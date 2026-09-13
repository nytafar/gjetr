.pragma library

// Attention: an Agent that has become `blocked` or `done` and has not been
// focused since. Pure; the service feeds it every published Agent list and
// every tap.
//
// Agents come from snapshots only (herdr replays history to new subscribers,
// docs/findings/T01.md), so a status change between two Agent lists is a real
// transition. The rules:
//
// - Enter on a transition of a known Agent into blocked or done. An Agent seen
//   for the first time never enters, which is what keeps the initial load and
//   every reconnect from lighting up everything already blocked or done.
// - Not while herdr has the Agent focused: its pane is the one on screen.
// - Leave when herdr reports the Agent focused, when it is tapped, or when it
//   goes away. A later status change (blocked -> done) keeps Attention and
//   updates its tone.

var STATUSES = ["blocked", "done"]

function own(object, key) {
  return object !== null && typeof object === "object" && Object.prototype.hasOwnProperty.call(object, key)
}

function isAttentionStatus(status) {
  return STATUSES.indexOf(status) >= 0
}

function empty() {
  return { statuses: {}, attention: {} }
}

function key(paneId) {
  return "p:" + String(paneId)
}

// Returns a new model. `agents` is the published Agent list.
function update(model, agents) {
  var current = model && model.statuses && model.attention ? model : empty()
  var list = Array.isArray(agents) ? agents : []
  var next = empty()
  for (var i = 0; i < list.length; i++) {
    var agent = list[i]
    if (!agent || typeof agent !== "object" || String(agent.paneId || "") === "") continue
    var k = key(agent.paneId)
    var status = String(agent.status)
    next.statuses[k] = status
    if (agent.focused === true) continue
    var known = own(current.statuses, k)
    var entered = known && current.statuses[k] !== status && isAttentionStatus(status)
    if (entered) next.attention[k] = status
    else if (own(current.attention, k)) next.attention[k] = isAttentionStatus(status) ? status : current.attention[k]
  }
  return next
}

// Our own tap: the user has looked at the Agent.
function acknowledge(model, paneId) {
  var current = model && model.statuses && model.attention ? model : empty()
  var k = key(paneId)
  if (!own(current.attention, k)) return current
  var next = { statuses: current.statuses, attention: {} }
  for (var other in current.attention) if (other !== k) next.attention[other] = current.attention[other]
  return next
}

// The status that put the Agent in Attention ("blocked" or "done"), or "".
function attentionOf(model, paneId) {
  return model && own(model.attention, key(paneId)) ? model.attention[key(paneId)] : ""
}

function count(model) {
  return model && model.attention ? Object.keys(model.attention).length : 0
}

function same(a, b) {
  var ka = a && a.attention ? Object.keys(a.attention) : []
  var kb = b && b.attention ? Object.keys(b.attention) : []
  if (ka.length !== kb.length) return false
  for (var i = 0; i < ka.length; i++) if (b.attention[ka[i]] !== a.attention[ka[i]]) return false
  return true
}

if (typeof module !== "undefined") {
  module.exports = {
    STATUSES: STATUSES,
    empty: empty,
    update: update,
    acknowledge: acknowledge,
    attentionOf: attentionOf,
    count: count,
    same: same
  }
}
