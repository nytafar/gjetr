import QtQuick
import "../lib/MotionPolicy.js" as MotionPolicy

// The one clock every motion reads (MotionPolicy): `ms`, the wall clock in
// milliseconds, moves every FRAME_MS while at least one Motion holds it, and
// stands still while none does, so nothing is redrawn while nothing moves.
// One per service, so every window's motions change in the same frames.
QtObject {
  id: root

  property int holders: 0
  property double ms: Date.now()
  readonly property bool running: holders > 0

  function hold() {
    holders++
    if (holders === 1) ms = Date.now()
  }

  function release() {
    if (holders > 0) holders--
  }

  property Timer timer: Timer {
    interval: MotionPolicy.FRAME_MS
    repeat: true
    running: root.running
    onTriggered: root.ms = Date.now()
  }
}
