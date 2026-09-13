import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Hyprland
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
import "lib/DeckPolicy.js" as DeckPolicy

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
  // One Display for now: the first [[display]].
  readonly property var display: config.displays[0]
  readonly property var deckNames: ConfigModel.deckLayoutNames(config)
  readonly property var layoutsByName: readLayouts(display.deck, layoutTexts)

  // The Deck: the Layouts this Display can show now, and the active one. A
  // fixed Display skips Layouts built for the other orientation; the active
  // Layout is an Override per Display, defaulting to the Deck's first.
  readonly property string surfaceOrientation: activeSurface
    ? DeckPolicy.orientationOf(activeSurface.width, activeSurface.height) : ""
  readonly property var deckRead: DeckPolicy.availableLayouts(
    display.deck.map(function(name) { return layoutsByName[name] }), display.rotatable, surfaceOrientation)
  readonly property var deckLayouts: deckRead.names
  readonly property string activeLayoutName: DeckPolicy.activeName(deckLayouts,
    OverrideModel.displayLayout(overrides, display.name, ""))
  readonly property int activeLayoutIndex: deckLayouts.indexOf(activeLayoutName)
  readonly property var activeLayout: layoutsByName[activeLayoutName] || ConfigModel.defaultLayout(activeLayoutName)
  readonly property string activeOrientation: activeLayout.orientation
  readonly property bool tabsVisible: DeckPolicy.tabsVisible(deckLayouts)
  readonly property var tabBadges: DeckPolicy.badges(deckLayouts, layoutsByName, activeLayoutName, attentionCount)
  // A swipe must travel this far, mostly sideways, to change Layout.
  readonly property int swipeThreshold: 80

  // Runtime rotation of a rotatable Display (never monitors.lua).
  property int rotationSequence: 0
  property var rotation: ({ requests: 0, transform: -1, error: "" })
  readonly property var agentListConfig: ConfigModel.agentList(activeLayout)
  readonly property var configErrors: collectConfigErrors(mainRead, layoutTexts, deckNames)
  readonly property string configSummary: "display " + display.name + (display.rotatable ? " rotatable" : "")
    + ", deck [" + deckLayouts.join(", ") + "]"
    + (deckRead.skipped.length > 0 ? " skipping [" + deckRead.skipped.join(", ") + "]" : "")
    + (deckRead.fallback ? " (no Layout fits " + surfaceOrientation + ", showing all)" : "")
    + ", layout " + activeLayout.name + " " + activeLayout.orientation

  // Overrides, from ~/.local/state/gjetr/state.json. This service is the file's
  // only writer; writeOverrides is the only place it changes.
  readonly property string statePath: home + "/.local/state/gjetr/state.json"
  property var overrides: OverrideModel.empty()
  property bool overridesLoaded: false
  property string overridesError: ""
  readonly property string agentListKey: OverrideModel.moduleKey(activeLayout.name, agentListConfig.index)

  // The Display this service draws on.
  readonly property string displayName: display.name
  // "wallpaper" and "transparent" leave the Bottom-layer surface clear, so
  // omarchy-background shows through.
  readonly property color background: display.background === "theme" ? Color.background
    : display.background === "transparent" || display.background === "wallpaper" ? "transparent"
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

  // A Layout whose file has not answered yet counts as `any`, so it is not
  // skipped (and logged as skipped) while it loads.
  function readLayouts(names, texts) {
    var out = {}
    for (var i = 0; i < names.length; i++) {
      var layout = ConfigModel.readLayout(names[i], texts[names[i]]).layout
      if (texts[names[i]] === undefined) layout.orientation = "any"
      out[names[i]] = layout
    }
    return out
  }

  function selectLayout(name) {
    var value = String(name || "")
    if (deckLayouts.indexOf(value) < 0) return false
    // The default is the first Layout this Display can show, so choosing it
    // removes the Override.
    writeOverrides(OverrideModel.setDisplayLayout(overrides, display.name, value, deckLayouts[0]))
    return true
  }

  // dx, dy: the gesture's travel in surface pixels.
  function swipeLayout(dx, dy) {
    var index = DeckPolicy.swipeTarget(activeLayoutIndex, deckLayouts.length, dx, dy, swipeThreshold)
    if (index === activeLayoutIndex || index < 0) return false
    return selectLayout(deckLayouts[index])
  }

  // Turns a rotatable Display to the active Layout's orientation. Reads the
  // output first so position and scale are written back unchanged.
  function applyOrientation() {
    if (!display.rotatable || !overridesLoaded || displayScreens.length === 0) return
    if (activeOrientation !== "portrait" && activeOrientation !== "landscape") return
    var sequence = ++rotationSequence
    var output = display.name
    var orientation = activeOrientation
    var layoutName = activeLayoutName
    commands.run(CommandPolicy.MONITORS, function(text, code) {
      if (sequence !== rotationSequence) return
      var monitor = code === 0 ? DeckPolicy.parseMonitor(text, output) : null
      if (!monitor) {
        rotation = { requests: rotation.requests, transform: -1, error: "output " + output + " not in hyprctl monitors" }
        return
      }
      var transform = DeckPolicy.transformFor(orientation, monitor)
      if (transform < 0) return
      var argv = CommandPolicy.rotateOutput(output, transform, monitor.x, monitor.y, monitor.scale)
      rotation = { requests: rotation.requests + 1, transform: transform, error: "" }
      log("rotate " + output + " to transform " + transform + " for " + layoutName + " (" + orientation + ")")
      commands.run(argv, function(result, exitCode) {
        if (exitCode !== 0 || String(result).trim() !== "ok")
          rotation = { requests: rotation.requests, transform: transform,
            error: "hyprctl eval failed (" + exitCode + "): " + String(result).trim().slice(0, 120) }
      })
    })
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
      deck: {
        layouts: deckLayouts,
        skipped: deckRead.skipped,
        fallback: deckRead.fallback,
        active: activeLayoutName,
        orientation: activeOrientation,
        surfaceOrientation: surfaceOrientation,
        rotatable: display.rotatable,
        tabs: tabsVisible,
        tabEdge: surface ? surface.tabEdge : "",
        badges: tabBadges,
        rotation: rotation
      },
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
  onActiveLayoutNameChanged: orientationTimer.restart()
  onActiveOrientationChanged: orientationTimer.restart()
  onOverridesLoadedChanged: orientationTimer.restart()

  // Coalesces Layout, Config and hotplug changes into one rotation.
  Timer {
    id: orientationTimer
    interval: 150
    onTriggered: root.applyOrientation()
  }

  // `hyprctl reload` re-reads monitors.lua and drops the runtime rule, so the
  // Layout's orientation is applied again once the reload has settled.
  Connections {
    target: Hyprland
    function onRawEvent(event) {
      if (event && event.name === "configreloaded") reloadTimer.restart()
    }
  }

  Timer {
    id: reloadTimer
    interval: 500
    onTriggered: root.applyOrientation()
  }
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
  onDisplayScreensChanged: {
    log("display " + displayName + (displayScreens.length > 0 ? " present" : " absent"))
    if (displayScreens.length > 0) orientationTimer.restart()
  }

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

    function selectLayout(name: string): string {
      return root.selectLayout(name) ? root.activeLayoutName : "unknown layout"
    }

    // The same step a swipe towards the left (next) or right (previous) takes.
    function nextLayout(): string {
      root.swipeLayout(-root.swipeThreshold * 2, 0)
      return root.activeLayoutName
    }

    function previousLayout(): string {
      root.swipeLayout(root.swipeThreshold * 2, 0)
      return root.activeLayoutName
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
