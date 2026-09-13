import QtQuick

// One motion's hold on the service's MotionClock: while `running` it keeps the
// clock ticking and `ms` follows it; otherwise `ms` is 0 and, once nothing
// else holds the clock, it stops. Released when it goes away.
QtObject {
  id: root

  property var clock: null
  property bool running: false
  readonly property double ms: running && clock ? clock.ms : 0

  property var held: null

  function sync() {
    var want = running && clock ? clock : null
    if (want === held) return
    if (held) held.release()
    held = want
    if (held) held.hold()
  }

  onRunningChanged: sync()
  onClockChanged: sync()
  Component.onCompleted: sync()
  Component.onDestruction: {
    // The clock may already be gone when the whole service is torn down.
    try {
      if (held) held.release()
    } catch (error) {}
    held = null
  }
}
