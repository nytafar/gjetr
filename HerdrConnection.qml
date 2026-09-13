pragma ComponentBehavior: Bound

import QtQuick
import Quickshell.Io
import "lib/HerdrModel.js" as HerdrModel

// The herdr connection. It moves bytes and runs timers; every protocol
// decision is in lib/HerdrModel.js. It is the only writer of the connection
// state it publishes (online, agents, attempt, ...).
//
// Flow: open events.subscribe, wait for subscription_started, then take a
// session.snapshot over a one-shot socket. Agents always come from a snapshot.
// herdr replays recent history to every new subscriber (finding T01),
// so events are never folded into state. An event that would change what a
// Module renders only schedules a debounced re-snapshot, and Agents are
// published only when the new snapshot differs. Any failure drops both
// sockets and retries on the backoff schedule, keeping last known Agents.
//
// Every connection attempt and every request uses a freshly created Socket.
// Quickshell 0.3.1's Socket reports a failed connect only once per object and
// ignores later `connected = true`, so a reused Socket never retries
// (finding T03).
//
// The two-socket shape and one-shot EOF handling follow omarchy-herdr's
// HerdrModel.qml (github.com/carlotran4/omarchy-herdr, MIT, Copyright (c) 2026
// Carlo Tran).
QtObject {
  id: root

  property string socketPath: ""
  // Set by the service while a Module on screen draws the workspace tree, so a
  // change to a pane without an agent (a shell's title) takes a new snapshot.
  property bool treeWanted: false

  // Published.
  property bool online: false
  property var agents: []
  // herdr's workspace > tab > pane tree with the focused ids (HerdrModel.tree).
  property var tree: HerdrModel.tree(null)
  property int attempt: 0
  property int retryInMs: 0
  property string lastError: ""
  property string phase: "idle" // idle | connecting | subscribing | snapshot | live | waiting
  property int eventsSeen: 0
  property int snapshots: 0
  property int publishes: 0
  property int focuses: 0
  property string lastFocusError: ""

  // Internal.
  property var model: HerdrModel.fromSnapshot(null)
  property int sequence: 0
  property double staleSince: 0
  property bool refreshQueued: false
  property var subscription: null
  property var request: null
  property bool requestConnected: false
  property string requestLine: ""
  property var focusSocket: null
  property bool focusConnected: false
  property string focusRequestLine: ""
  property string focusKind: ""
  property string focusTargetId: ""

  // herdr accepted a focus request for a workspace, tab or pane.
  signal targetFocused(string kind, string id)

  function log(message) {
    console.info("[gjetr] herdr " + message)
  }

  function nextId(kind) {
    sequence++
    return "gjetr:" + sequence + ":" + kind
  }

  function drop(socket) {
    if (!socket) return
    socket.connected = false
    socket.destroy()
  }

  function start() {
    if (socketPath === "" || (phase !== "idle" && phase !== "waiting")) return
    retryTimer.stop()
    phase = "connecting"
    drop(subscription)
    subscription = subscriptionComponent.createObject(root, { path: socketPath })
    connectTimeout.restart()
    subscription.connected = true
  }

  function resetWork() {
    connectTimeout.stop()
    snapshotTimeout.stop()
    reconcileTimer.stop()
    staleSince = 0
    refreshQueued = false
    drop(subscription)
    subscription = null
    drop(request)
    request = null
  }

  function stop() {
    retryTimer.stop()
    phase = "idle"
    resetWork()
    online = false
  }

  function reconnect() {
    stop()
    attempt = 0
    retryInMs = 0
    start()
  }

  function fail(reason) {
    if (phase === "idle" || phase === "waiting") return
    phase = "waiting"
    resetWork()
    online = false
    lastError = reason
    retryInMs = HerdrModel.backoffDelay(attempt)
    attempt++
    retryTimer.interval = retryInMs
    retryTimer.restart()
    log("offline (" + reason + "), retry " + attempt + " in " + retryInMs + " ms")
  }

  function requestSnapshot() {
    if (phase === "subscribing") phase = "snapshot"
    connectTimeout.stop()
    staleSince = 0
    drop(request)
    requestLine = HerdrModel.requestLine(nextId("snapshot"), "session.snapshot")
    requestConnected = false
    request = requestComponent.createObject(root, { path: socketPath })
    snapshotTimeout.restart()
    request.connected = true
  }

  function markStale() {
    var now = Date.now()
    if (staleSince === 0) staleSince = now
    reconcileTimer.interval = Math.max(1, HerdrModel.reconcileDelay(now - staleSince))
    reconcileTimer.restart()
  }

  function handleSnapshotLine(socket, line) {
    if (socket !== request) return
    snapshotTimeout.stop()
    drop(request)
    request = null
    var reply = HerdrModel.parseReplyLine(line)
    var snapshot = HerdrModel.snapshotFromReply(reply)
    if (!snapshot) {
      fail("snapshot " + (reply.error ? reply.error.code + " " + reply.error.message : "missing"))
      return
    }
    snapshots++
    var next = HerdrModel.fromSnapshot(snapshot)
    var wasOnline = online
    var differs = !HerdrModel.sameAgents(model, next)
    var treeDiffers = !HerdrModel.sameTree(model, next)
    model = next
    phase = "live"
    online = true
    attempt = 0
    retryInMs = 0
    lastError = ""
    if (differs || !wasOnline) publish()
    if (treeDiffers || !wasOnline) tree = HerdrModel.tree(model)
    if (!wasOnline) log("online, " + agents.length + " agents")
    if (refreshQueued) {
      refreshQueued = false
      markStale()
    }
  }

  function handleStreamLine(socket, line) {
    if (socket !== subscription) return
    var item = HerdrModel.classifyStreamLine(line)
    if (item.kind === "event") {
      eventsSeen++
      if ((phase === "snapshot" || phase === "live") && HerdrModel.eventInvalidates(model, item.envelope, treeWanted))
        markStale()
    } else if (item.kind === "started") {
      if (phase === "subscribing") requestSnapshot()
    } else if (item.kind === "error") {
      fail("subscribe " + item.error.code + " " + item.error.message)
    }
  }

  // Focus one workspace, tab or pane over its own one-shot socket. A newer tap
  // replaces a request still in flight. Focus never touches connection state: a
  // failure is logged, and the snapshot after herdr's focus event shows the
  // result.
  function focusPane(paneId) {
    return focusTarget("pane", paneId)
  }

  function focusTarget(kind, id) {
    var line = HerdrModel.focusTargetLine(nextId("focus"), kind, id)
    if (line === "" || socketPath === "") return false
    dropFocus()
    focusRequestLine = line
    focusKind = String(kind)
    focusTargetId = String(id)
    focusConnected = false
    focusSocket = commandComponent.createObject(root, { path: socketPath })
    focusTimeout.restart()
    focusSocket.connected = true
    return true
  }

  function dropFocus() {
    focusTimeout.stop()
    drop(focusSocket)
    focusSocket = null
  }

  function failFocus(reason) {
    dropFocus()
    lastFocusError = reason
    log("focus " + focusKind + " " + focusTargetId + " failed: " + reason)
  }

  function handleFocusLine(socket, line) {
    if (socket !== focusSocket) return
    var reply = HerdrModel.parseReplyLine(line)
    if (!reply.ok) {
      failFocus(reply.error.code + " " + reply.error.message)
      return
    }
    dropFocus()
    lastFocusError = ""
    focuses++
    targetFocused(focusKind, focusTargetId)
  }

  function publish() {
    agents = HerdrModel.agents(model)
    publishes++
  }

  property Component subscriptionComponent: Component {
    Socket {
      id: socket
      parser: SplitParser {
        onRead: function(line) { root.handleStreamLine(socket, line) }
      }
      onConnectedChanged: {
        if (socket !== root.subscription) return
        if (socket.connected) {
          if (root.phase !== "connecting") return
          root.phase = "subscribing"
          socket.write(HerdrModel.subscribeLine(root.nextId("subscribe")))
          socket.flush()
        } else if (root.phase === "subscribing" || root.phase === "snapshot" || root.phase === "live") {
          root.fail("subscription closed")
        }
      }
      onError: function(error) {
        if (socket !== root.subscription) return
        if (root.phase === "connecting" || !socket.connected) root.fail("socket error " + error)
      }
    }
  }

  property Component requestComponent: Component {
    Socket {
      id: socket
      parser: SplitParser {
        onRead: function(line) { root.handleSnapshotLine(socket, line) }
      }
      onConnectedChanged: {
        if (socket !== root.request || !socket.connected) return
        root.requestConnected = true
        socket.write(root.requestLine)
        socket.flush()
      }
      // herdr closes a request socket after its one reply, so a peer close is
      // normal. Fail fast only when the connection never came up; otherwise
      // the reply or the snapshot timeout decides.
      onError: function(error) {
        if (socket !== root.request) return
        if (!root.requestConnected) root.fail("snapshot socket error " + error)
      }
    }
  }

  property Component commandComponent: Component {
    Socket {
      id: socket
      parser: SplitParser {
        onRead: function(line) { root.handleFocusLine(socket, line) }
      }
      onConnectedChanged: {
        if (socket !== root.focusSocket || !socket.connected) return
        root.focusConnected = true
        socket.write(root.focusRequestLine)
        socket.flush()
      }
      onError: function(error) {
        if (socket !== root.focusSocket) return
        if (!root.focusConnected) root.failFocus("socket error " + error)
      }
    }
  }

  property Timer focusTimeout: Timer {
    interval: 3000
    onTriggered: root.failFocus("timeout")
  }

  property Timer connectTimeout: Timer {
    interval: 3000
    onTriggered: root.fail("connect timeout")
  }

  property Timer snapshotTimeout: Timer {
    interval: 5000
    onTriggered: root.fail("snapshot timeout")
  }

  property Timer retryTimer: Timer {
    onTriggered: root.start()
  }

  // Debounced re-snapshot after renderable events; bounded by the max wait in
  // HerdrModel.reconcileDelay so a steady stream still refreshes.
  property Timer reconcileTimer: Timer {
    onTriggered: {
      if (root.request) root.refreshQueued = true
      else if (root.phase === "live") root.requestSnapshot()
    }
  }

  onSocketPathChanged: if (phase !== "idle") reconnect()

  Component.onDestruction: {
    dropFocus()
    stop()
  }
}
