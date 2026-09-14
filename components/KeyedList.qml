import QtQuick
import "../lib/ListSyncPolicy.js" as ListSyncPolicy

// A list Module's rows, keyed and updated in place: a ListModel of `{ key }`
// that a new set of items reaches by removes, moves and inserts
// (ListSyncPolicy.plan), so a snapshot or a re-sort keeps every delegate, its
// running animations and the scroll position. A delegate finds its item in
// `byKey` and its place in `index`. With a `view`, the row at the top of it
// stays where it is on screen across a sync or a height change
// (ListSyncPolicy.heldScroll): rows `pitch` apart, or Cards at `placement`.
// It applies steps and assigns contentY; every decision is in lib/.
QtObject {
  id: keyed

  // Objects, each with a string key in its `keyOf` field.
  property var items: []
  property string keyOf: "paneId"
  property Flickable view: null
  // One scroll strategy: a uniform row pitch (row height plus gap), or the
  // LayoutPolicy.cardPlacement of `order` for rows that differ in height.
  property int pitch: 0
  property var placement: null

  readonly property ListModel model: ListModel {}
  readonly property var byKey: published.byKey
  readonly property var index: published.index
  readonly property var order: published.order

  // What the last sync published; read byKey, index and order instead.
  property var published: ({ byKey: ({}), index: ({}), order: [] })

  function sync() {
    var current = []
    for (var i = 0; i < model.count; i++) current.push(model.get(i).key)
    var next = ListSyncPolicy.plan(current, items, keyOf)
    var hold = capture()
    // Published before the steps, so an inserted delegate finds its item.
    published = { byKey: next.byKey, index: next.index, order: next.order }
    for (var k = 0; k < next.steps.length; k++) {
      var step = next.steps[k]
      if (step.op === "remove") model.remove(step.index, 1)
      else if (step.op === "move") model.move(step.from, step.to, 1)
      else model.insert(step.index, { key: step.key })
    }
    release(hold)
  }

  // Runs fn, a change to row heights, and holds the top row across it.
  function holdScroll(fn) {
    var hold = capture()
    fn()
    release(hold)
  }

  function capture() {
    return { order: order, placement: placement, contentY: view ? view.contentY : 0, moving: view ? view.moving : false }
  }

  function release(hold) {
    if (!view || hold.moving || hold.contentY <= 0) return
    var y = ListSyncPolicy.heldScroll({
      before: pitch > 0 ? hold.order : hold.placement, after: order, keys: hold.order,
      pitch: pitch, placement: placement, contentY: hold.contentY, viewHeight: view.height, moving: hold.moving
    })
    if (y !== view.contentY) view.contentY = y
  }

  onItemsChanged: sync()
  Component.onCompleted: sync()
}
