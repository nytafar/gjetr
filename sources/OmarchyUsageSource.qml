pragma ComponentBehavior: Bound

import QtQuick
import Quickshell.Io
import "../lib/UsageModel.js" as UsageModel
import "../lib/CommandPolicy.js" as CommandPolicy

// The Omarchy usage Source (docs/adr/0002-usage-behind-a-source-seam.md). It
// finds the records omarchy-agent-usage-update writes, watches each with a
// FileView, and runs the script itself every refreshSeconds, one run at a
// time. It publishes providers in UsageModel's provider-neutral shape. It
// moves bytes and runs timers; what a record means is UsageModel.fromOmarchy.
//
// Discovering records by listing the directory and watching one FileView per
// record follows Omarchy's agents plugin (shell/plugins/agents/Main.qml and
// Agent.qml).
Item {
  id: root
  visible: false

  // The service's CommandRunner: every process passes CommandPolicy.
  property var runner: null
  property string dir: ""
  // Runs and watches only while a Usage Module is in the Deck.
  property bool active: false
  property int refreshSeconds: UsageModel.DEFAULT_REFRESH_SECONDS

  // Published.
  property var ids: []
  property var providers: ({})
  property var errors: ({})
  property bool refreshing: false
  property int runs: 0
  property int lastExit: -1
  property double lastRunMs: 0

  function log(message) {
    console.info("[gjetr] usage " + message)
  }

  function copy(map) {
    var out = {}
    for (var key in map) out[key] = map[key]
    return out
  }

  function rescan() {
    if (!active || !runner || dir === "") return
    runner.run(CommandPolicy.listUsageFiles(dir), function(text, code) {
      var next = code === 0 ? UsageModel.parseListing(text) : []
      if (JSON.stringify(next) !== JSON.stringify(ids)) ids = next
      prune()
    })
  }

  // Starts omarchy-agent-usage-update unless a run is still going.
  // -> true when a run started.
  function refresh() {
    if (!active || refreshing || !runner) return false
    refreshing = true
    var started = runner.run(CommandPolicy.USAGE_UPDATE, function(text, code) {
      refreshing = false
      runs++
      lastExit = code
      lastRunMs = Date.now()
      if (code !== 0) log("omarchy-agent-usage-update exited " + code)
      rescan()
    })
    return started
  }

  // A record that does not parse keeps the provider's last good numbers and
  // reports the error; the script replaces files atomically, so this is rare.
  function setRecord(id, text) {
    var read = UsageModel.parseOmarchyRecord(text, id)
    var nextErrors = copy(errors)
    if (read.provider) {
      var next = copy(providers)
      next[id] = read.provider
      providers = next
      delete nextErrors[id]
    } else {
      if (errors[id] !== read.error) log(id + ".json unreadable: " + read.error)
      nextErrors[id] = read.error
    }
    errors = nextErrors
  }

  function dropRecord(id) {
    if (providers[id] === undefined && errors[id] === undefined) return
    var next = copy(providers)
    delete next[id]
    providers = next
    var nextErrors = copy(errors)
    delete nextErrors[id]
    errors = nextErrors
  }

  function prune() {
    for (var id in providers) if (ids.indexOf(id) < 0) dropRecord(id)
  }

  onActiveChanged: if (active) rescan()
  onDirChanged: rescan()

  Instantiator {
    model: root.active ? root.ids : []

    delegate: FileView {
      required property var modelData

      path: root.dir + "/" + modelData + ".json"
      watchChanges: true
      printErrors: false
      onFileChanged: reload()
      onLoaded: root.setRecord(modelData, text())
      onLoadFailed: root.dropRecord(modelData)
    }
  }

  Timer {
    interval: Math.max(UsageModel.MIN_REFRESH_SECONDS, root.refreshSeconds) * 1000
    running: root.active
    repeat: true
    triggeredOnStart: true
    onTriggered: root.refresh()
  }
}
