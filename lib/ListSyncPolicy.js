.pragma library

// Steps that turn one ordered key list into another in place: removals, then
// moves and inserts from the front. Applied to a ListModel, a view keeps its
// delegates and its scroll position across a re-sort or a new snapshot, where
// assigning a fresh array would rebuild every Card and jump back to the top.
// Keys must be unique strings; duplicates and non-strings in `next` are dropped.

function unique(list) {
  var seen = {}
  var out = []
  var source = Array.isArray(list) ? list : []
  for (var i = 0; i < source.length; i++) {
    var key = source[i]
    if (typeof key !== "string" || Object.prototype.hasOwnProperty.call(seen, key)) continue
    seen[key] = true
    out.push(key)
  }
  return out
}

// -> [{ op: "remove", index }, { op: "move", from, to }, { op: "insert", index, key }]
function syncSteps(current, next) {
  var list = unique(current)
  var wanted = unique(next)
  var keep = {}
  var steps = []
  var i
  for (i = 0; i < wanted.length; i++) keep[wanted[i]] = true
  for (i = list.length - 1; i >= 0; i--) {
    if (Object.prototype.hasOwnProperty.call(keep, list[i])) continue
    steps.push({ op: "remove", index: i })
    list.splice(i, 1)
  }
  for (i = 0; i < wanted.length; i++) {
    if (list[i] === wanted[i]) continue
    var from = list.indexOf(wanted[i])
    if (from >= 0) {
      steps.push({ op: "move", from: from, to: i })
      list.splice(i, 0, list.splice(from, 1)[0])
    } else {
      steps.push({ op: "insert", index: i, key: wanted[i] })
      list.splice(i, 0, wanted[i])
    }
  }
  return steps
}

// Applies steps to a plain array; the same arithmetic ListModel uses.
function apply(list, steps) {
  var out = Array.isArray(list) ? list.slice() : []
  for (var i = 0; i < steps.length; i++) {
    var s = steps[i]
    if (s.op === "remove") out.splice(s.index, 1)
    else if (s.op === "move") out.splice(s.to, 0, out.splice(s.from, 1)[0])
    else if (s.op === "insert") out.splice(s.index, 0, s.key)
  }
  return out
}

if (typeof module !== "undefined") {
  module.exports = { syncSteps: syncSteps, apply: apply }
}
