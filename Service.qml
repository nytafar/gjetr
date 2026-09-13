import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import "lib/LayoutPolicy.js" as LayoutPolicy
import "lib/HerdrModel.js" as HerdrModel
import "lib/NamePolicy.js" as NamePolicy
import "lib/SortPolicy.js" as SortPolicy
import "lib/CacheTimerModel.js" as CacheTimerModel
import "lib/CardPolicy.js" as CardPolicy
import "lib/ConfigModel.js" as ConfigModel
import "lib/OverrideModel.js" as OverrideModel
import "lib/WindowPolicy.js" as WindowPolicy
import "lib/CommandPolicy.js" as CommandPolicy
import "lib/AttentionModel.js" as AttentionModel

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

  readonly property string home: Quickshell.env("HOME")

  // Config, from ~/.config/gjetr. Texts are null while a file is missing;
  // ConfigModel turns them into validated values with defaults and errors.
  // A session-only redirect for testing (IPC useConfigDir); never persisted.
  property string configDirOverride: ""
  readonly property string configDir: configDirOverride !== "" ? configDirOverride : home + "/.config/gjetr"
  property var mainText: null
  property var layoutTexts: ({})
  readonly property var mainRead: ConfigModel.readMain(mainText, home)
  readonly property var config: mainRead.config
  // One Display for now; T09 builds Decks across Displays.
  readonly property var display: config.displays[0]
  readonly property var deckNames: ConfigModel.deckLayoutNames(config)
  readonly property var activeLayoutRead: ConfigModel.readLayout(display.deck[0], layoutTexts[display.deck[0]])
  readonly property var activeLayout: activeLayoutRead.layout
  readonly property var agentListConfig: ConfigModel.agentList(activeLayout)
  readonly property var configErrors: collectConfigErrors(mainRead, layoutTexts, deckNames)
  readonly property string configSummary: "display " + display.name + ", deck [" + display.deck.join(", ") + "], layout "
    + activeLayout.name + " " + activeLayout.orientation

  // Overrides, from ~/.local/state/gjetr/state.json. This service is the file's
  // only writer; writeOverrides is the only place it changes.
  readonly property string statePath: home + "/.local/state/gjetr/state.json"
  property var overrides: OverrideModel.empty()
  property bool overridesLoaded: false
  property string overridesError: ""
  readonly property string agentListKey: OverrideModel.moduleKey(activeLayout.name, agentListConfig.index)

  // The Display this service draws on.
  readonly property string displayName: display.name
  readonly property color background: display.background === "theme" ? Color.background
    : display.background === "transparent" ? "transparent"
    : display.background === "black" ? "black" : display.background
  readonly property string herdrSocketPath: config.socket

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

  // Module settings: Config, shadowed by Overrides.
  readonly property string sortMode: OverrideModel.effective(overrides, agentListKey, "sort", agentListConfig.settings.sort)
  readonly property bool sortOverridden: sortMode !== agentListConfig.settings.sort
  readonly property string focusMode: OverrideModel.effective(overrides, agentListKey, "focus", agentListConfig.settings.focus)
  readonly property bool focusOverridden: focusMode !== agentListConfig.settings.focus

  // Focus behaviour `window`: the last attempt to bring the hosting terminal
  // window forward. Newer taps supersede older lookups by sequence.
  property int windowFocusSequence: 0
  property var windowFocus: ({ requests: 0, window: "", workspace: "", candidates: 0, error: "" })

  // Cache timers from the cache-ttl herdr plugin. Paths are the plugin's own
  // state and config dirs (HERDR_PLUGIN_STATE_DIR, HERDR_PLUGIN_CONFIG_DIR).
  readonly property string cacheTimersPath: home + "/.local/state/herdr/plugins/cache-ttl/timers.json"
  readonly property string cacheSettingsPath: home + "/.config/herdr/plugins/config/cache-ttl/config.json"
  property var cacheTimers: ({})
  property string cacheTimersError: ""
  property var cacheSettings: CacheTimerModel.DEFAULT_SETTINGS
  // Display clock, whole seconds. Ticks only while a countdown is visible.
  property int nowSeconds: CacheTimerModel.nowSeconds(Date.now())
  readonly property bool cacheClockNeeded: CacheTimerModel.hasLiveTimer(agents, cacheTimers, nowSeconds)

  // Card preset for the Agent List.
  readonly property string cardPreset: agentListConfig.settings.preset

  // Kind icons are the marks Omarchy's agents plugin ships; read in place.
  // Writable on purpose: the shell injects omarchyPath into every service it
  // creates, and a read-only property makes that throw and the service load
  // twice.
  property string omarchyPath: Quickshell.env("OMARCHY_PATH") || "/usr/share/omarchy"
  readonly property bool lightBackground: (0.2126 * background.r + 0.7152 * background.g + 0.0722 * background.b) > 0.5

  // Attention, from status transitions between published Agent lists and from
  // taps. Cards bind to it through attentionFor(agent, attention).
  property var attention: AttentionModel.empty()
  readonly property int attentionCount: AttentionModel.count(attention)

  // Agents in the current Sort mode. Replaced only when the order or the
  // Agents themselves change, so Cards are not rebuilt on every tick.
  property var sortedAgents: []

  function log(message) {
    console.info("[gjetr] " + message)
  }

  // Layout errors count only once a file has answered, so a Layout still
  // loading is not reported as missing.
  function collectConfigErrors(read, texts, names) {
    var errors = read.errors.slice()
    for (var i = 0; i < names.length; i++) {
      if (texts[names[i]] === undefined) continue
      errors = errors.concat(ConfigModel.readLayout(names[i], texts[names[i]]).errors)
    }
    return errors
  }

  function setLayoutText(name, text) {
    if (layoutTexts[name] === text) return
    var next = {}
    for (var key in layoutTexts) next[key] = layoutTexts[key]
    next[name] = text
    layoutTexts = next
  }

  function applyOverridesText(text) {
    var read = OverrideModel.parse(text)
    if (read.error !== "") log("overrides unreadable (" + read.error + "), starting from Config")
    overridesError = read.error
    overrides = read.overrides
    overridesLoaded = true
  }

  // The single writer of state.json. Skips writes that change nothing.
  function writeOverrides(next) {
    if (!overridesLoaded) return false
    var text = OverrideModel.serialize(next)
    if (text === OverrideModel.serialize(overrides)) return false
    overrides = next
    stateFile.setText(text)
    return true
  }

  function cycleSortMode() {
    if (agentListKey === "") return sortMode
    var next = SortPolicy.nextMode(sortMode)
    writeOverrides(OverrideModel.set(overrides, agentListKey, "sort", next, agentListConfig.settings.sort))
    log("sort " + next + (next !== agentListConfig.settings.sort ? " (override)" : ""))
    return next
  }

  function toggleFocusMode() {
    if (agentListKey === "") return focusMode
    var modes = ConfigModel.FOCUS_MODES
    var next = modes[(modes.indexOf(focusMode) + 1) % modes.length]
    writeOverrides(OverrideModel.set(overrides, agentListKey, "focus", next, agentListConfig.settings.focus))
    log("focus " + next + (next !== agentListConfig.settings.focus ? " (override)" : ""))
    return next
  }

  // After herdr focused a pane: find the most recently focused Hyprland window
  // hosting a herdr client of our server, and focus it, which also switches
  // to its workspace. Selection is lib/WindowPolicy.js; every command is
  // allowlisted in lib/CommandPolicy.js.
  function focusHostWindow() {
    var sequence = ++windowFocusSequence
    var parts = { clients: null, processes: null }
    var socket = herdrSocketPath

    function report(fields) {
      var next = { requests: windowFocus.requests, window: "", workspace: "", candidates: 0, error: "" }
      for (var key in fields) next[key] = fields[key]
      windowFocus = next
      if (next.error !== "") log("window focus: " + next.error)
    }

    function select() {
      if (sequence !== windowFocusSequence || parts.clients === null || parts.processes === null) return
      var picked = WindowPolicy.selectHost(parts.clients, parts.processes, socket, home)
      if (!picked.window) {
        report({ error: "no window hosts a herdr client of " + socket })
        return
      }
      var chosen = picked.window
      commands.run(CommandPolicy.focusWindow(chosen.address), function(text, code) {
        if (sequence !== windowFocusSequence) return
        var ok = code === 0 && String(text).trim() === "ok"
        report({ window: chosen.address, workspace: chosen.workspace, candidates: picked.candidates,
          error: ok ? "" : "dispatch failed (" + code + "): " + String(text).trim().slice(0, 120) })
      })
    }

    windowFocus = { requests: windowFocus.requests + 1, window: "", workspace: "", candidates: 0, error: "" }
    commands.run(CommandPolicy.CLIENTS, function(text, code) {
      parts.clients = code === 0 ? text : "[]"
      select()
    })
    commands.run(CommandPolicy.PROCESSES, function(text, code) {
      parts.processes = code === 0 ? text : ""
      select()
    })
  }

  function resetOverrides() {
    writeOverrides(OverrideModel.clear(overrides))
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

  function kindIconUrl(kind) {
    var file = CardPolicy.kindIconFile(kind, lightBackground)
    return file === "" ? "" : "file://" + omarchyPath + "/shell/plugins/agents/assets/" + file
  }

  // Focus is only ever asked for a pane that is a known Agent.
  function focusPane(paneId) {
    var id = String(paneId || "")
    for (var i = 0; i < agents.length; i++) {
      if (agents[i].paneId !== id) continue
      attention = AttentionModel.acknowledge(attention, id)
      return herdr.focusPane(id)
    }
    return false
  }

  // Pass `attention` from a binding so a Card re-evaluates when it changes.
  function attentionFor(agent, model) {
    return agent ? AttentionModel.attentionOf(model, agent.paneId) : ""
  }

  function applyAgents() {
    var next = AttentionModel.update(attention, agents)
    var entered = AttentionModel.count(next) > AttentionModel.count(attention)
    attention = next
    if (entered) log("attention " + Object.keys(next.attention).join(", ").replace(/p:/g, ""))
    resort()
  }

  function useConfigDir(path) {
    var value = String(path || "")
    if (value !== "" && !ConfigModel.isConfigDir(value)) return false
    configDirOverride = value
    log("config dir " + configDir)
    return true
  }

  function focusAgent(agent) {
    return !!agent && focusPane(agent.paneId)
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
      cardPreset: cardPreset,
      focusMode: focusMode,
      focusOverridden: focusOverridden,
      windowFocus: windowFocus,
      commands: { started: commands.started, refused: commands.refused, lastError: commands.lastError },
      config: { dir: configDir, summary: configSummary, errors: configErrors },
      overrides: { key: agentListKey, sortOverridden: sortOverridden, loaded: overridesLoaded,
        error: overridesError, modules: overrides.modules },
      focus: { requests: herdr.focuses, lastError: herdr.lastFocusError },
      attention: attention.attention,
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
          attention: attentionFor(agent, attention),
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
    onPaneFocused: if (root.focusMode === "window") root.focusHostWindow()
  }

  CommandRunner {
    id: commands
  }

  onConfigErrorsChanged: {
    for (var i = 0; i < configErrors.length; i++) log("config: " + configErrors[i])
  }
  onConfigSummaryChanged: log("config " + configSummary)

  FileView {
    path: root.configDir + "/gjetr.toml"
    watchChanges: true
    blockLoading: true
    printErrors: false
    onFileChanged: reload()
    onLoaded: root.mainText = text()
    onLoadFailed: root.mainText = null
  }

  Variants {
    model: root.deckNames

    FileView {
      required property var modelData

      path: ConfigModel.layoutPath(root.configDir, modelData)
      watchChanges: true
      blockLoading: true
      printErrors: false
      onFileChanged: reload()
      onLoaded: root.setLayoutText(modelData, text())
      onLoadFailed: root.setLayoutText(modelData, null)
    }
  }

  FileView {
    id: stateFile
    path: root.statePath
    // Only this service writes the file, so it is not watched.
    blockLoading: true
    atomicWrites: true
    printErrors: false
    onLoaded: if (!root.overridesLoaded) root.applyOverridesText(text())
    onLoadFailed: if (!root.overridesLoaded) root.applyOverridesText("")
    onSaveFailed: function(error) { root.log("overrides not saved: error " + error) }
  }

  onAgentsChanged: applyAgents()
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

    function focus(paneId: string): string {
      return root.focusPane(paneId) ? "requested" : "unknown pane"
    }

    function cycleSort(): string {
      return root.cycleSortMode()
    }

    function resetOverrides(): void {
      root.resetOverrides()
    }

    function toggleFocus(): string {
      return root.toggleFocusMode()
    }

    // Testing aid: read Config from another directory until the shell
    // restarts. An empty path goes back to ~/.config/gjetr.
    function useConfigDir(path: string): string {
      return root.useConfigDir(path) ? root.configDir : "refused"
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
