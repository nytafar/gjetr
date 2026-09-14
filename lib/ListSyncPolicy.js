.pragma library
.import "LayoutPolicy.js" as LayoutPolicy

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

// What a keyed list does with a new set of items: the steps from its current
// keys, and what it publishes. An item's key is its `keyOf` field; items
// without a string key are dropped, and of a duplicate key the first wins.
// -> { steps, byKey: { key: item }, index: { key: position }, order: [key] }
function plan(currentKeys, items, keyOf) {
  var field = String(keyOf)
  var source = Array.isArray(items) ? items : []
  var byKey = {}
  var index = {}
  var order = []
  for (var i = 0; i < source.length; i++) {
    var item = source[i]
    if (item === null || typeof item !== "object") continue
    var key = item[field]
    if (typeof key !== "string" || Object.prototype.hasOwnProperty.call(byKey, key)) continue
    Object.defineProperty(byKey, key, { value: item, enumerable: true, writable: true, configurable: true })
    Object.defineProperty(index, key, { value: order.length, enumerable: true, writable: true, configurable: true })
    order.push(key)
  }
  return { steps: syncSteps(currentKeys, order), byKey: byKey, index: index, order: order }
}

// The scroll offset that keeps the row at the top of the view in place across
// a change, clamped to the content after it. Two strategies:
// - `pitch` > 0, rows of equal height: `before` and `after` are the key
//   orders around the change (LayoutPolicy.keepRowScroll); the content is
//   `after.length * pitch` tall.
// - otherwise `placement`, Cards placed by LayoutPolicy.cardPlacement: it is
//   the placement after the change, `before` the one before it and `keys` the
//   key order before it (LayoutPolicy.keepScroll).
// A view at the top (`contentY` 0) or `moving` under a finger keeps its offset,
// as does one without a strategy.
function heldScroll(args) {
  var a = args !== null && typeof args === "object" ? args : {}
  var y = Number(a.contentY)
  if (!isFinite(y)) y = 0
  if (a.moving || y <= 0) return y
  var pitch = Number(a.pitch)
  if (isFinite(pitch) && pitch > 0) {
    var after = Array.isArray(a.after) ? a.after : []
    return LayoutPolicy.clampScroll(LayoutPolicy.keepRowScroll(a.before, after, pitch, y), after.length * pitch, a.viewHeight)
  }
  var placement = a.placement
  if (placement && placement.positions) {
    return LayoutPolicy.clampScroll(LayoutPolicy.keepScroll(a.before, placement, a.keys, y), placement.contentHeight, a.viewHeight)
  }
  return y
}

if (typeof module !== "undefined") {
  module.exports = { syncSteps: syncSteps, apply: apply, plan: plan, heldScroll: heldScroll }
}
