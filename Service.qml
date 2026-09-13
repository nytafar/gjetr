import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import "lib/LayoutPolicy.js" as LayoutPolicy
import "lib/HerdrModel.js" as HerdrModel
import "lib/NamePolicy.js" as NamePolicy
import "lib/SortPolicy.js" as SortPolicy
import "lib/CacheTimerModel.js" as CacheTimerModel

// Owns Display selection, the herdr connection and everything that must
// outlive a surface. The surface itself is created per matching screen and
// registers back here, so state and the IPC target survive the Display being
// unplugged.
//
// Service-owns-surface with hotplug re-registration follows OmaDeck's
// Service.qml (github.com/TheAirick/OmaDeck, MIT, Copyright (c) 2026 Erik Holum).
Item {
  id: root

  property var shell: null
  property var manifest: null

  // The Display this service draws on. T06 replaces the default with Config.
  property string displayName: "HDMI-A-2"
  property color background: "black"
  // T06 replaces the default with Config.
  property string herdrSocketPath: HerdrModel.socketPath(Quickshell.env("HOME"))

  property var activeSurface: null

  readonly property var displayScreens: LayoutPolicy.displayScreens(Quickshell.screens, displayName)

  // Bar geometry, read the same way omarchy's notifications service does.
  readonly property string barPosition: LayoutPolicy.normalizeBarPosition(
    shell && shell.barConfig ? shell.barConfig.position : "")
  readonly property bool barVertical: barPosition === "left" || barPosition === "right"
  readonly property int barSize: shell && shell.bar && shell.bar.barSize !== undefined
    ? Number(shell.bar.barSize)
    : (barVertical ? Style.bar.sizeVertical : Style.bar.sizeHorizontal)
  readonly property bool barHidden: !!(shell && shell.bar && shell.bar.barHidden)
  readonly property var barInset: LayoutPolicy.barInset(barPosition, barSize, barHidden)

  // herdr. Agents stay at their last known value while Offline.
  readonly property var agents: herdr.agents
  readonly property bool herdrOnline: herdr.online
  // Offline once a connection attempt has failed; before that, still connecting.
  readonly property bool herdrOffline: !herdr.online && herdr.attempt > 0

  // Sort mode. T06 replaces the default with Config and Overrides.
  property string sortMode: SortPolicy.DEFAULT_MODE

  // Cache timers from the cache-ttl herdr plugin. Paths are the plugin's own
  // state and config dirs (HERDR_PLUGIN_STATE_DIR, HERDR_PLUGIN_CONFIG_DIR).
  readonly property string home: Quickshell.env("HOME")
  readonly property string cacheTimersPath: home + "/.local/state/herdr/plugins/cache-ttl/timers.json"
  readonly property string cacheSettingsPath: home + "/.config/herdr/plugins/config/cache-ttl/config.json"
  property var cacheTimers: ({})
  property string cacheTimersError: ""
  property var cacheSettings: CacheTimerModel.DEFAULT_SETTINGS
  // Display clock, whole seconds. Ticks only while a countdown is visible.
  property int nowSeconds: CacheTimerModel.nowSeconds(Date.now())
  readonly property bool cacheClockNeeded: CacheTimerModel.hasLiveTimer(agents, cacheTimers, nowSeconds)

  // Agents in the current Sort mode. Replaced only when the order or the
  // Agents themselves change, so Cards are not rebuilt on every tick.
  property var sortedAgents: []

  function log(message) {
    console.info("[gjetr] " + message)
  }

  function resort() {
    var remaining = sortMode === "cache" ? CacheTimerModel.remainingByPane(agents, cacheTimers, nowSeconds) : null
    var next = SortPolicy.sortAgents(agents, sortMode, remaining)
    if (!SortPolicy.sameOrder(next, sortedAgents)) sortedAgents = next
  }

  // Field helpers for Modules. Pass `nowSeconds` from a binding so the Cache
  // timer re-evaluates on every tick.
  function agentName(agent) {
    return NamePolicy.agentName(agent)
  }

  function agentLocation(agent) {
    return NamePolicy.location(agent)
  }

  function cacheTimerFor(agent, now) {
    return CacheTimerModel.cacheTimer(agent, cacheTimers, now, cacheSettings)
  }

  function applyCacheTimers(text) {
    var parsed = CacheTimerModel.parseTimers(text)
    if (parsed.error !== cacheTimersError && parsed.error !== "") log("cache timers unreadable: " + parsed.error)
    cacheTimersError = parsed.error
    cacheTimers = parsed.timers
    nowSeconds = CacheTimerModel.nowSeconds(Date.now())
  }

  function registerSurface(surface) {
    if (!surface) return
    activeSurface = surface
    log("surface registered on " + displayName)
  }

  function unregisterSurface(surface) {
    if (activeSurface !== surface) return
    activeSurface = null
    log("surface unregistered from " + displayName)
  }

  function stateJson() {
    var surface = activeSurface
    return JSON.stringify({
      display: displayName,
      displayPresent: displayScreens.length > 0,
      surface: surface ? {
        width: surface.width,
        height: surface.height,
        content: surface.contentRect
      } : null,
      bar: { position: barPosition, size: barSize, hidden: barHidden, inset: barInset },
      herdr: {
        socket: herdr.socketPath,
        phase: herdr.phase,
        online: herdr.online,
        offline: herdrOffline,
        agents: herdr.agents.length,
        attempt: herdr.attempt,
        retryInMs: herdr.retryInMs,
        lastError: herdr.lastError,
        eventsSeen: herdr.eventsSeen,
        snapshots: herdr.snapshots,
        publishes: herdr.publishes
      },
      sortMode: sortMode,
      cache: {
        timers: Object.keys(cacheTimers).length,
        error: cacheTimersError,
        settings: cacheSettings,
        clock: cacheClockNeeded
      },
      cards: sortedAgents.map(function(agent) {
        var timer = cacheTimerFor(agent, nowSeconds)
        return {
          paneId: agent.paneId,
          status: agent.status,
          name: agentName(agent),
          location: agentLocation(agent),
          cache: timer ? timer.label + " " + timer.level : ""
        }
      })
    })
  }

  HerdrConnection {
    id: herdr
    socketPath: root.herdrSocketPath
  }

  onAgentsChanged: resort()
  onSortModeChanged: resort()
  onCacheTimersChanged: resort()

  FileView {
    path: root.cacheTimersPath
    watchChanges: true
    printErrors: false
    onFileChanged: reload()
    onLoaded: root.applyCacheTimers(text())
    onLoadFailed: root.applyCacheTimers("{}")
  }

  FileView {
    path: root.cacheSettingsPath
    watchChanges: true
    printErrors: false
    onFileChanged: reload()
    onLoaded: root.cacheSettings = CacheTimerModel.parseSettings(text())
    onLoadFailed: root.cacheSettings = CacheTimerModel.DEFAULT_SETTINGS
  }

  Timer {
    interval: 1000
    repeat: true
    running: root.cacheClockNeeded
    onTriggered: {
      root.nowSeconds = CacheTimerModel.nowSeconds(Date.now())
      if (root.sortMode === "cache") root.resort()
    }
  }

  Component.onCompleted: {
    log("service up, display " + displayName + (displayScreens.length > 0 ? " present" : " absent"))
    herdr.start()
  }
  Component.onDestruction: {
    herdr.stop()
    log("service down")
  }
  onDisplayScreensChanged: log("display " + displayName
    + (displayScreens.length > 0 ? " present" : " absent"))

  IpcHandler {
    target: "nytafar.gjetr"

    function state(): string {
      return root.stateJson()
    }

    function reconnect(): void {
      herdr.reconnect()
    }
  }

  Variants {
    model: root.displayScreens

    DeckSurface {
      required property var modelData

      screen: modelData
      service: root
    }
  }
}
