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
import "lib/RecapModel.js" as RecapModel
import "lib/WorkspaceTreeModel.js" as WorkspaceTreeModel
import "lib/ThemeModel.js" as ThemeModel
import "lib/UsageModel.js" as UsageModel
import "sources"

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
  property var rotationStatus: ({ requests: 0, transform: -1, error: "" })
  property var touch: ({ transform: -1, devices: [], error: "" })
  property int touchLogged: -1

  // Recap: the latest away_summary of each Claude Agent's session, found by
  // session id under ~/.claude/projects and re-read when the transcript's
  // modification time or size changes. Polled only while an Agent List shows
  // Recaps.
  // The first Agent List's Recap settings, for `state` and IPC. Each Agent
  // List reads its own from moduleStates.
  readonly property string recapMode: primaryModule && primaryModule.recap ? primaryModule.recap : "off"
  readonly property string recapOpenMode: primaryModule && primaryModule.recapOpen ? primaryModule.recapOpen : RecapModel.DEFAULT_OPEN
  // Recaps are read while any Agent List on the active Layout shows them.
  readonly property bool recapNeeded: activeModules.some(function(module) {
    return module.type === "agent-list" && module.settings.recap !== "off"
  })
  // Session state, never written: the Cards whose Recap is open, per Module key
  // and pane id (RecapModel open state), and the overlay's Module and pane.
  // Both follow pane ids, so they survive re-sorts and updates.
  property var recapOpen: RecapModel.emptyOpen()
  property var recapOverlay: ({ key: "", pane: "" })
  readonly property string claudeProjectsDir: RecapModel.projectsDir(home)
  property var recapPaths: ({})
  property var recapLocated: ({})
  property var recapStamps: ({})
  property var recaps: ({})
  property bool recapPolling: false
  // Every Module of the active Layout, keyed <layout>#<index>, and each
  // Module's settings shadowed by its own Overrides.
  readonly property var activeModules: ConfigModel.layoutModules(activeLayout)
  readonly property var moduleStates: OverrideModel.moduleStates(activeModules, overrides)
  // The first Agent List: what `state` reports, and what the IPC functions that
  // name no Module act on. Empty key when the Layout has none.
  readonly property var agentListConfig: ConfigModel.agentList(activeLayout)
  // Checked by type: while a Layout file loads, a key can briefly name a
  // Module of another type.
  readonly property var primaryModule: moduleStates[agentListKey] && moduleStates[agentListKey].type === "agent-list"
    ? moduleStates[agentListKey] : null
  // The first Workspace List: what the tree IPC functions act on.
  readonly property string workspaceListKey: {
    for (var i = 0; i < activeModules.length; i++) if (activeModules[i].type === "workspace-list") return activeModules[i].key
    return ""
  }

  // herdr's workspace > tab > pane tree and the Focused workspace. Agent Lists
  // highlight the Agents in it; nothing filters by it.
  readonly property var workspaceTree: herdr.tree
  readonly property string focusedWorkspaceId: workspaceTree ? workspaceTree.focusedWorkspaceId : ""
  // Usage (ADR 0002): providers from Omarchy's usage records, refreshed
  // and watched while any Layout of the Deck has a Usage Module.
  readonly property var deckUsageModules: {
    var out = []
    for (var i = 0; i < deckLayouts.length; i++) {
      var layout = layoutsByName[deckLayouts[i]]
      var modules = layout && Array.isArray(layout.modules) ? layout.modules : []
      for (var j = 0; j < modules.length; j++) if (modules[j] && modules[j].type === "usage") out.push(modules[j])
    }
    return out
  }
  readonly property int usageRefreshSeconds: UsageModel.refreshSeconds(display.refreshSeconds, deckUsageModules)
  readonly property string usageDir: UsageModel.usageDir(home, Quickshell.env("XDG_STATE_HOME"))
  readonly property var usageProviders: usageSource.providers
  readonly property bool usageRefreshing: usageSource.refreshing
  readonly property bool usageShown: activeModules.some(function(module) { return module.type === "usage" })
  // Clock for reset countdowns and ages; ticks only while a Usage Module shows.
  property double usageNowMs: Date.now()

  // Session state, never written: the expanded workspaces and tabs of each
  // Workspace List (WorkspaceTreeModel expansion state), pruned as they go away.
  property var treeExpanded: WorkspaceTreeModel.emptyExpanded()
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
  // The first Agent List's, for `state`.
  readonly property string sortMode: primaryModule ? primaryModule.sort : SortPolicy.DEFAULT_MODE
  readonly property bool sortOverridden: !!primaryModule && primaryModule.sortOverridden
  readonly property string focusMode: primaryModule ? primaryModule.focus : "herdr"
  readonly property bool focusOverridden: !!primaryModule && primaryModule.focusOverridden
  // Whether a Module on screen uses the cache Sort mode, so the clock re-sorts.
  readonly property bool cacheSortShown: {
    for (var key in moduleStates) if (moduleStates[key].sort === "cache") return true
    return false
  }
  // Focus behaviour of the Module whose tap is in flight.
  property string pendingFocusMode: "herdr"

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
  readonly property string cardPreset: primaryModule ? primaryModule.preset : CardPolicy.DEFAULT_PRESET

  // Kind icons are the marks Omarchy's agents plugin ships; read in place.
  // Writable on purpose: the shell injects omarchyPath into every service it
  // creates, and a read-only property makes that throw and the service load
  // twice.
  property string omarchyPath: Quickshell.env("OMARCHY_PATH") || "/usr/share/omarchy"
  // The theme's green, for the `done` status (StatusPolicy tone "success").
  // qs.Commons Color has no green, so it is read from the theme's colors.toml
  // at the same path Color reads its palette from; accent when there is none.
  readonly property string themeColorsPath: home + "/.local/state/omarchy/current/theme/colors.toml"
  property string themeSuccess: ""
  readonly property color successColor: themeSuccess !== "" ? themeSuccess : Color.accent
  readonly property bool lightBackground: (0.2126 * background.r + 0.7152 * background.g + 0.0722 * background.b) > 0.5

  // Attention, from status transitions between published Agent lists and from
  // taps. Cards bind to it through attentionFor(agent, attention).
  property var attention: AttentionModel.empty()
  readonly property int attentionCount: AttentionModel.count(attention)

  // Agents in every Sort mode. Each list is replaced only when its order or its
  // Agents change, so Cards are not rebuilt on every tick. An Agent List reads
  // the list for its own Sort mode.
  property var sortedByMode: ({ spaces: [], priority: [], cache: [] })
  readonly property var sortedAgents: sortedByMode[sortMode] || []

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
        rotationStatus = { requests: rotationStatus.requests, transform: -1, error: "output " + output + " not in hyprctl monitors" }
        return
      }
      var transform = DeckPolicy.transformFor(orientation, monitor)
      if (transform < 0) {
        applyTouch(output, monitor.transform)
        return
      }
      var argv = CommandPolicy.rotateOutput(output, transform, monitor.x, monitor.y, monitor.scale)
      rotationStatus = { requests: rotationStatus.requests + 1, transform: transform, error: "" }
      log("rotate " + output + " to transform " + transform + " for " + layoutName + " (" + orientation + ")")
      commands.run(argv, function(result, exitCode) {
        if (exitCode !== 0 || String(result).trim() !== "ok") {
          rotationStatus = { requests: rotationStatus.requests, transform: transform,
            error: "hyprctl eval failed (" + exitCode + "): " + String(result).trim().slice(0, 120) }
          return
        }
        applyTouch(output, transform)
      })
    })
  }

  // Hyprland does not map touch through a runtime output transform, so the
  // touchscreen gets the same transform: per device when the Display names its
  // touch_devices, else the global touchdevice option. Idempotent.
  function applyTouch(output, transform) {
    var devices = display.touchDevices || []
    var argvs = []
    if (devices.length === 0) argvs.push(CommandPolicy.touchTransform(transform))
    for (var i = 0; i < devices.length; i++) argvs.push(CommandPolicy.deviceTransform(devices[i], output, transform))
    touch = { transform: transform, devices: devices, error: "" }
    for (var j = 0; j < argvs.length; j++) {
      commands.run(argvs[j], function(result, exitCode) {
        if (exitCode !== 0 || String(result).trim() !== "ok")
          touch = { transform: transform, devices: devices, error: "touch transform failed (" + exitCode + ")" }
      })
    }
    if (transform !== touchLogged) log("touch transform " + transform + (devices.length > 0 ? " for " + devices.join(", ") : " (all touch devices)"))
    touchLogged = transform
  }

  // Each Agent List decides from its own recap setting whether to show it.
  function recapFor(agent, map) {
    if (!agent) return ""
    var entry = map[agent.sessionId]
    return entry ? entry.text : ""
  }

  function agentByPane(paneId) {
    var id = String(paneId || "")
    for (var i = 0; i < agents.length; i++) if (agents[i].paneId === id) return agents[i]
    return null
  }

  // A Module key, or the first Agent List's when none is given.
  function moduleKeyOr(moduleKey) {
    return moduleKey ? String(moduleKey) : agentListKey
  }

  // Pass `recapOpen` from a binding so a Card re-evaluates when it changes.
  function recapOpenFor(agent, open, moduleKey) {
    var state = moduleStates[moduleKey]
    return !!agent && !!state && state.recap === "expand" && state.recapOpen === "card"
      && RecapModel.isOpen(open, moduleKey, agent.paneId)
  }

  // Opens or closes an Agent's full Recap in one Agent List, in its Card or in
  // the overlay as that Module's recap_open says.
  // -> "open", "closed" or why nothing happened.
  function toggleRecap(paneId, moduleKey) {
    var agent = agentByPane(paneId)
    if (!agent) return "unknown pane"
    var key = moduleKeyOr(moduleKey)
    var state = moduleStates[key]
    if (!state || state.type !== "agent-list") return "no agent list"
    if (state.recap !== "expand") return "recap is " + state.recap + ", not expand"
    if (recapFor(agent, recaps) === "") return "no recap"
    if (state.recapOpen === "overlay") {
      var shown = recapOverlay.key === key && recapOverlay.pane === agent.paneId
      recapOverlay = shown ? { key: "", pane: "" } : { key: key, pane: agent.paneId }
      return shown ? "closed" : "open"
    }
    recapOpen = RecapModel.toggleOpen(recapOpen, key, agent.paneId)
    return RecapModel.isOpen(recapOpen, key, agent.paneId) ? "open" : "closed"
  }

  function closeRecapOverlay() {
    recapOverlay = { key: "", pane: "" }
  }

  // Open Recaps of panes that are no longer Agents are forgotten, so a later
  // pane never inherits one. Offline keeps the last Agents, and their state.
  function pruneRecapOpen() {
    var ids = agents.map(function(agent) { return agent.paneId })
    recapOpen = RecapModel.pruneOpen(recapOpen, ids)
    if (recapOverlay.pane !== "" && ids.indexOf(recapOverlay.pane) < 0) closeRecapOverlay()
  }

  function recapSessions() {
    var out = []
    for (var i = 0; i < agents.length; i++) {
      var id = agents[i].sessionId
      if (agents[i].kind === "claude" && RecapModel.isSessionId(id) && out.indexOf(id) < 0) out.push(id)
    }
    return out
  }

  function setEntry(name, key, value) {
    var next = {}
    var current = root[name]
    for (var k in current) next[k] = current[k]
    next[key] = value
    root[name] = next
  }

  function readRecap(sessionId, path) {
    commands.run(CommandPolicy.grepRecaps(path), function(text, code) {
      // grep exits 1 when the transcript has no recap yet.
      if (code !== 0 && code !== 1) return
      var recap = RecapModel.latestRecap(text, sessionId)
      var current = recaps[sessionId]
      if (recap && (!current || current.text !== recap.text)) setEntry("recaps", sessionId, recap)
    })
  }

  function pollRecaps() {
    if (!recapNeeded || recapPolling) return
    var sessions = recapSessions()
    var now = Date.now()
    var paths = []
    var bySession = {}
    for (var i = 0; i < sessions.length; i++) {
      var id = sessions[i]
      var path = recapPaths[id]
      if (path) {
        paths.push(path)
        bySession[path] = id
      } else if (!recapLocated[id] || now - recapLocated[id] > 60000) {
        setEntry("recapLocated", id, now)
        locateRecap(id)
      }
    }
    if (paths.length === 0) return
    recapPolling = true
    commands.run(CommandPolicy.statTranscripts(paths.slice(0, 64)), function(text, code) {
      recapPolling = false
      var stamps = RecapModel.parseStat(text, paths)
      for (var p in stamps) {
        if (recapStamps[p] === stamps[p]) continue
        setEntry("recapStamps", p, stamps[p])
        readRecap(bySession[p], p)
      }
    })
  }

  function locateRecap(sessionId) {
    commands.run(CommandPolicy.locateTranscript(claudeProjectsDir, sessionId), function(text, code) {
      var path = RecapModel.parseLocate(text, claudeProjectsDir, sessionId)
      if (path === "") return
      setEntry("recapPaths", sessionId, path)
      pollTimer.restart()
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

  // Next Sort mode of one Module, as an Override. -> the new mode, or "" when
  // the Module has no Sort mode.
  function cycleSortMode(moduleKey) {
    var key = moduleKeyOr(moduleKey)
    var state = moduleStates[key]
    if (!state || state.sort === undefined) return ""
    var next = SortPolicy.nextMode(state.sort)
    writeOverrides(OverrideModel.set(overrides, key, "sort", next, state.config.sort))
    log(key + " sort " + next + (next !== state.config.sort ? " (override)" : ""))
    return next
  }

  // Flips one Module's Focus behaviour, as an Override. -> the new behaviour,
  // or "" when the Module has none.
  function toggleFocusMode(moduleKey) {
    var key = moduleKeyOr(moduleKey)
    var state = moduleStates[key]
    if (!state || state.focus === undefined) return ""
    var modes = ConfigModel.FOCUS_MODES
    var next = modes[(modes.indexOf(state.focus) + 1) % modes.length]
    writeOverrides(OverrideModel.set(overrides, key, "focus", next, state.config.focus))
    log(key + " focus " + next + (next !== state.config.focus ? " (override)" : ""))
    return next
  }

  // ------------------------------------------------------------ Workspace List

  // Pass `workspaceTree`, `treeExpanded` and `attention` from a binding so the
  // rows re-evaluate when any of them changes.
  function workspaceRows(moduleKey, tree, expanded, attentionModel) {
    return WorkspaceTreeModel.rows(tree, expanded, moduleKey, attentionModel)
  }

  // Expands or collapses a workspace ("w:<id>") or tab ("t:<id>") in one
  // Workspace List. -> "expanded", "collapsed" or why nothing happened.
  function toggleExpanded(moduleKey, nodeKey) {
    var key = moduleKey ? String(moduleKey) : workspaceListKey
    var state = moduleStates[key]
    if (!state || state.type !== "workspace-list") return "no workspace list"
    var node = String(nodeKey || "")
    if (!/^[wt]:/.test(node) || !WorkspaceTreeModel.nodeExists(workspaceTree, node)) return "unknown node"
    treeExpanded = WorkspaceTreeModel.toggleExpanded(treeExpanded, key, node)
    return WorkspaceTreeModel.isExpanded(treeExpanded, key, node) ? "expanded" : "collapsed"
  }

  // A tap on a row of one Workspace List, in its "row" or "chevron" zone.
  // What it does is WorkspaceTreeModel.tapAction for the Module's tap mode.
  function tapWorkspaceRow(moduleKey, row, zone) {
    var key = moduleKey ? String(moduleKey) : workspaceListKey
    var state = moduleStates[key]
    if (!state || state.type !== "workspace-list") return "no workspace list"
    var action = WorkspaceTreeModel.tapAction(row, state.tap, zone)
    if (action.action === "toggle") return toggleExpanded(key, action.key)
    if (action.action === "focus")
      return focusTarget(action.kind, action.id, key) ? "focus " + action.kind + " " + action.id : "unknown " + action.kind
    return "nothing"
  }

  // The row of the first Workspace List with this node key, as drawn now.
  function workspaceRowByKey(nodeKey) {
    var list = workspaceRows(workspaceListKey, workspaceTree, treeExpanded, attention)
    for (var i = 0; i < list.length; i++) if (list[i].key === nodeKey) return list[i]
    return null
  }

  // Focus a workspace, tab or pane of herdr's tree, with the Focus behaviour of
  // the Module that asked. Panes need not hold an Agent.
  function focusTarget(kind, id, moduleKey) {
    var value = String(id || "")
    var prefix = kind === "workspace" ? "w:" : kind === "tab" ? "t:" : kind === "pane" ? "p:" : ""
    if (prefix === "" || value === "" || !WorkspaceTreeModel.nodeExists(workspaceTree, prefix + value)) return false
    if (kind === "pane") attention = AttentionModel.acknowledge(attention, value)
    pendingFocusMode = focusModeFor(moduleKey)
    return herdr.focusTarget(kind, value)
  }

  // Runs omarchy-agent-usage-update now. -> "started", "already running" or
  // "no usage module".
  function refreshUsage() {
    if (deckUsageModules.length === 0) return "no usage module"
    if (usageSource.refreshing) return "already running"
    return usageSource.refresh() ? "started" : "refused"
  }

  function focusModeFor(moduleKey) {
    var state = moduleStates[moduleKeyOr(moduleKey)]
    return state && state.focus ? state.focus : "herdr"
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
    var remaining = CacheTimerModel.remainingByPane(agents, cacheTimers, nowSeconds)
    var next = {}
    var changed = false
    for (var i = 0; i < SortPolicy.MODES.length; i++) {
      var mode = SortPolicy.MODES[i]
      var current = sortedByMode[mode] || []
      var list = SortPolicy.sortAgents(agents, mode, mode === "cache" ? remaining : null)
      next[mode] = SortPolicy.sameOrder(list, current) ? current : list
      if (next[mode] !== current) changed = true
    }
    if (changed) sortedByMode = next
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

  // Focus is only ever asked for a pane that is a known Agent. The Module that
  // asked decides the Focus behaviour.
  function focusPane(paneId, moduleKey) {
    var id = String(paneId || "")
    for (var i = 0; i < agents.length; i++) {
      if (agents[i].paneId !== id) continue
      attention = AttentionModel.acknowledge(attention, id)
      pendingFocusMode = focusModeFor(moduleKey)
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
    pruneRecapOpen()
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

  function focusAgent(agent, moduleKey) {
    return !!agent && focusPane(agent.paneId, moduleKey)
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
      workspaces: {
        list: workspaceListKey,
        focusedWorkspace: focusedWorkspaceId,
        count: workspaceTree ? workspaceTree.workspaces.length : 0,
        expanded: treeExpanded,
        rows: workspaceListKey === "" ? [] : workspaceRows(workspaceListKey, workspaceTree, treeExpanded, attention)
          .map(function(row) {
            return { key: row.key, label: row.label, detail: row.detail, status: row.status, focused: row.focused,
              attention: row.attention, expanded: row.expanded }
          })
      },
      usage: {
        active: usageSource.active,
        dir: usageDir,
        refreshSeconds: usageRefreshSeconds,
        refreshing: usageSource.refreshing,
        runs: usageSource.runs,
        lastExit: usageSource.lastExit,
        lastRun: usageSource.lastRunMs > 0 ? new Date(usageSource.lastRunMs).toISOString() : "",
        records: usageSource.ids,
        errors: usageSource.errors,
        providers: Object.keys(usageSource.providers).sort().map(function(id) {
          var p = usageSource.providers[id]
          return { id: id, ready: p.ready, limits: p.limits.length, updated: UsageModel.ageLabel(p.updatedAtMs, Date.now()),
            stale: UsageModel.isStale(p.updatedAtMs, Date.now(), usageRefreshSeconds), cost30d: p.cost30d }
        })
      },
      modules: activeModules.map(function(module, index) {
        var state = moduleStates[module.key] || {}
        return { key: module.key, type: module.type, weight: module.weight, sort: state.sort, focus: state.focus,
          rect: surface && surface.moduleRects ? (surface.moduleRects[index] || null) : null }
      }),
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
        rotation: rotationStatus,
        touch: touch
      },
      recap: {
        mode: recapMode,
        open: recapOpenMode,
        openCards: RecapModel.openPanes(recapOpen, agentListKey),
        overlay: recapOverlay.pane,
        sessions: recapSessions().length,
        located: Object.keys(recapPaths).length,
        recaps: Object.keys(recaps).length
      },
      overrides: { key: agentListKey, sortOverridden: sortOverridden, loaded: overridesLoaded,
        error: overridesError, modules: overrides.modules },
      focus: { requests: herdr.focuses, lastError: herdr.lastFocusError },
      attention: attention.attention,
      theme: { success: String(successColor), fromTheme: themeSuccess !== "" },
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
          recap: recapFor(agent, recaps) !== "",
          inFocusedWorkspace: focusedWorkspaceId !== "" && agent.workspaceId === focusedWorkspaceId,
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
    treeWanted: root.workspaceListKey !== ""
    onTargetFocused: if (root.pendingFocusMode === "window") root.focusHostWindow()
  }

  CommandRunner {
    id: commands
  }

  OmarchyUsageSource {
    id: usageSource
    runner: commands
    dir: root.usageDir
    active: root.deckUsageModules.length > 0
    refreshSeconds: root.usageRefreshSeconds
  }

  Timer {
    interval: 30000
    repeat: true
    running: root.usageShown
    onTriggered: root.usageNowMs = Date.now()
  }
  onUsageShownChanged: if (usageShown) usageNowMs = Date.now()

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
  onWorkspaceTreeChanged: treeExpanded = WorkspaceTreeModel.pruneExpanded(treeExpanded, workspaceTree)
  onActiveLayoutNameChanged: {
    closeRecapOverlay()
    orientationTimer.restart()
  }
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
    id: pollTimer
    interval: 5000
    repeat: true
    triggeredOnStart: true
    running: root.recapNeeded && root.agents.length > 0
    onTriggered: root.pollRecaps()
  }

  Timer {
    id: reloadTimer
    interval: 500
    onTriggered: root.applyOrientation()
  }
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
    id: themeColorsFile
    path: root.themeColorsPath
    watchChanges: true
    printErrors: false
    onFileChanged: reload()
    onLoaded: root.themeSuccess = ThemeModel.successColor(text())
    onLoadFailed: root.themeSuccess = ""
  }

  // A theme switch repoints the theme directory, which a file watch may miss;
  // the shell's palette changing is the signal to read colors.toml again.
  Connections {
    target: Color
    function onAccentChanged() { themeColorsFile.reload() }
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
      if (root.cacheSortShown) root.resort()
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
      return root.focusPane(paneId, "") ? "requested" : "unknown pane"
    }

    // The first Agent List of the active Layout, as a header tap does.
    function cycleSort(): string {
      return root.cycleSortMode("") || "no agent list"
    }

    function resetOverrides(): void {
      root.resetOverrides()
    }

    function toggleFocus(): string {
      return root.toggleFocusMode("") || "no agent list"
    }

    // Opens or closes a Card's full Recap, as a tap on its recap area does.
    function toggleRecap(paneId: string): string {
      return root.toggleRecap(paneId, "")
    }

    // Expands or collapses a workspace ("w:<id>") or tab ("t:<id>") in the
    // first Workspace List of the active Layout.
    function toggleExpand(nodeKey: string): string {
      return root.toggleExpanded("", nodeKey)
    }

    // Taps a row of the first Workspace List ("w:<id>", "t:<id>", "p:<id>"),
    // in zone "row" or "chevron", as a finger does.
    function tapRow(nodeKey: string, zone: string): string {
      var row = root.workspaceRowByKey(nodeKey)
      return row ? root.tapWorkspaceRow("", row, zone === "chevron" ? "chevron" : "row") : "unknown row"
    }

    // Runs omarchy-agent-usage-update now, as a tap on a Usage header does.
    function refreshUsage(): string {
      return root.refreshUsage()
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
