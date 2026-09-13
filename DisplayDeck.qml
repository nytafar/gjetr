import QtQuick
import Quickshell
import Quickshell.Hyprland
import qs.Commons
import "lib/ConfigModel.js" as ConfigModel
import "lib/OverrideModel.js" as OverrideModel
import "lib/DeckPolicy.js" as DeckPolicy
import "lib/DockPolicy.js" as DockPolicy
import "lib/LayoutPolicy.js" as LayoutPolicy
import "lib/CommandPolicy.js" as CommandPolicy

// One Display and its Deck: the Layouts it offers, the active one, its
// surface (a full-output surface, or a Dock along one edge), runtime rotation
// of a rotatable surface, and whether a Dock is shown. Created by the service
// per [[display]]; everything shared across Displays (herdr, Overrides,
// Recaps, usage) stays in the service, which is the only writer of state.json.
Item {
  id: root

  property var service: null
  // "<kind>:<output>", as the service lists Displays. Changing a Display's kind
  // makes a new Deck, so a live surface never changes layer or anchors.
  property string entry: ""

  readonly property string name: entry.slice(entry.indexOf(":") + 1)
  readonly property var found: service ? ConfigModel.displayNamed(service.config, name) : null
  // While Config changes, the entry can briefly name a Display that is gone;
  // such a Deck shows nothing until the service drops it.
  readonly property bool valid: !!found
  readonly property var display: found || ({ name: name, kind: "surface", deck: [], rotatable: false, background: "black",
    touchDevices: [], refreshSeconds: null, edge: "", size: 0, visible: true })
  readonly property bool isDock: display.kind === "dock"
  readonly property string edge: display.edge
  readonly property int dockSize: display.size

  // A Dock follows its Config `visible`, shadowed by an Override; a surface is
  // always shown.
  readonly property bool shown: !isDock || OverrideModel.displayVisible(service ? service.overrides : null, name, display.visible)
  readonly property bool shownOverridden: isDock && shown !== display.visible

  readonly property var layoutsByName: service ? service.readLayouts(display.deck, service.layoutTexts, service.config.defaults) : ({})

  // The Deck: the Layouts this Display can show now, and the active one. A
  // fixed Display skips Layouts built for the other orientation; a Dock's
  // orientation comes from its edge. The active Layout is an Override per
  // Display, defaulting to the Deck's first.
  property var activeSurface: null
  readonly property string surfaceOrientation: isDock ? DockPolicy.orientationFor(edge)
    : activeSurface ? DeckPolicy.orientationOf(activeSurface.width, activeSurface.height) : ""
  readonly property var deckRead: DeckPolicy.availableLayouts(
    display.deck.map(function(layoutName) { return layoutsByName[layoutName] }), display.rotatable, surfaceOrientation)
  readonly property var deckLayouts: deckRead.names
  readonly property string activeLayoutName: DeckPolicy.activeName(deckLayouts,
    OverrideModel.displayLayout(service ? service.overrides : null, name, ""))
  readonly property int activeLayoutIndex: deckLayouts.indexOf(activeLayoutName)
  readonly property var activeLayout: layoutsByName[activeLayoutName] || ConfigModel.defaultLayout(activeLayoutName)
  readonly property string activeOrientation: activeLayout.orientation
  // Every Module of the active Layout, keyed <layout>#<index>.
  readonly property var activeModules: valid ? ConfigModel.layoutModules(activeLayout) : []
  readonly property bool tabsVisible: DeckPolicy.tabsVisible(deckLayouts)
  readonly property var tabBadges: DeckPolicy.badges(deckLayouts, layoutsByName, activeLayoutName,
    service ? service.attentionCount : 0)

  // Usage Modules anywhere in this Deck, for the refresh interval.
  readonly property var usageModules: {
    var out = []
    for (var i = 0; i < deckLayouts.length; i++) {
      var layout = layoutsByName[deckLayouts[i]]
      var modules = layout && Array.isArray(layout.modules) ? layout.modules : []
      for (var j = 0; j < modules.length; j++) if (modules[j] && modules[j].type === "usage") out.push(modules[j])
    }
    return out
  }

  // "wallpaper" and "transparent" leave the surface clear, so what is below it
  // (omarchy-background) shows through.
  readonly property color background: display.background === "theme" ? Color.background
    : display.background === "transparent" || display.background === "wallpaper" ? "transparent"
    : display.background === "black" ? "black" : display.background

  // Empty while the output is unplugged, which tears the surface down.
  readonly property var displayScreens: LayoutPolicy.displayScreens(Quickshell.screens, name)
  readonly property bool present: displayScreens.length > 0

  readonly property string summary: (isDock
      ? "dock " + name + " " + edge + " " + dockSize + (shown ? "" : " hidden")
      : "display " + name + (display.rotatable ? " rotatable" : ""))
    + ", deck [" + deckLayouts.join(", ") + "]"
    + (deckRead.skipped.length > 0 ? " skipping [" + deckRead.skipped.join(", ") + "]" : "")
    + (deckRead.fallback ? " (no Layout fits " + surfaceOrientation + ", showing all)" : "")
    + ", layout " + activeLayout.name + " " + activeLayout.orientation

  // Runtime rotation of a rotatable surface (never monitors.lua). Docks never
  // rotate.
  property int rotationSequence: 0
  property var rotationStatus: ({ requests: 0, transform: -1, error: "" })
  property var touch: ({ transform: -1, devices: [], error: "" })
  property int touchLogged: -1

  function log(message) {
    if (service) service.log(message)
  }

  function selectLayout(layoutName) {
    var value = String(layoutName || "")
    if (!service || deckLayouts.indexOf(value) < 0) return false
    // The default is the first Layout this Display can show, so choosing it
    // removes the Override.
    service.writeOverrides(OverrideModel.setDisplayLayout(service.overrides, name, value, deckLayouts[0]))
    return true
  }

  // dx, dy: the gesture's travel in surface pixels.
  function swipeLayout(dx, dy) {
    if (!service) return false
    var index = DeckPolicy.swipeTarget(activeLayoutIndex, deckLayouts.length, dx, dy, service.swipeThreshold)
    if (index === activeLayoutIndex || index < 0) return false
    return selectLayout(deckLayouts[index])
  }

  // Shows or hides a Dock ("toggle", "show", "hide") as an Override; back at
  // its Config `visible` the Override goes. -> whether it is shown after.
  function applyDockAction(action) {
    if (!isDock || !service) return shown
    var was = shown
    var next = DockPolicy.nextVisible(action, was)
    service.writeOverrides(OverrideModel.setDisplayVisible(service.overrides, name, next, display.visible))
    if (next !== was) log("dock " + name + (next ? " shown" : " hidden"))
    return next
  }

  function registerSurface(surface) {
    if (!surface) return
    activeSurface = surface
    log("surface registered on " + name + (isDock ? " (dock " + edge + ")" : ""))
  }

  function unregisterSurface(surface) {
    if (activeSurface !== surface) return
    activeSurface = null
    log("surface unregistered from " + name)
  }

  // Turns a rotatable surface's output to the active Layout's orientation.
  // Reads the output first so position and scale are written back unchanged.
  function applyOrientation() {
    if (!service || isDock || !display.rotatable || !service.overridesLoaded || !present) return
    if (activeOrientation !== "portrait" && activeOrientation !== "landscape") return
    var sequence = ++rotationSequence
    var output = name
    var orientation = activeOrientation
    var layoutName = activeLayoutName
    service.runCommand(CommandPolicy.MONITORS, function(text, code) {
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
      service.runCommand(argv, function(result, exitCode) {
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
      service.runCommand(argvs[j], function(result, exitCode) {
        if (exitCode !== 0 || String(result).trim() !== "ok")
          touch = { transform: transform, devices: devices, error: "touch transform failed (" + exitCode + ")" }
      })
    }
    if (transform !== touchLogged) log("touch transform " + transform + (devices.length > 0 ? " for " + devices.join(", ") : " (all touch devices)"))
    touchLogged = transform
  }

  // This Display for `state`.
  function describe() {
    var surface = activeSurface
    var out = {
      name: name,
      kind: display.kind,
      present: present,
      shown: shown,
      surface: surface ? {
        width: surface.width,
        height: surface.height,
        mapped: surface.visible,
        layer: surface.layerName,
        exclusiveZone: surface.reservedSize,
        content: surface.contentRect
      } : null,
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
      modules: activeModules.map(function(module, index) {
        var state = service && service.moduleStates[module.key] ? service.moduleStates[module.key] : {}
        return { key: module.key, type: module.type, weight: module.weight, pin: module.pin, density: state.density, sort: state.sort, focus: state.focus,
          indicator: state.indicator, workingEffect: state.workingEffect,
          rect: surface && surface.moduleRects ? (surface.moduleRects[index] || null) : null }
      })
    }
    if (isDock) {
      out.edge = edge
      out.size = dockSize
      out.shownOverridden = shownOverridden
    }
    return out
  }

  onActiveLayoutNameChanged: {
    if (service) service.closeRecapOverlay()
    orientationTimer.restart()
  }
  onActiveOrientationChanged: orientationTimer.restart()
  onDisplayScreensChanged: {
    log("display " + name + (present ? " present" : " absent"))
    if (present) orientationTimer.restart()
  }

  Connections {
    target: root.service
    function onOverridesLoadedChanged() { orientationTimer.restart() }
  }

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

  // The surface, per matching screen: it disappears and returns across hotplug
  // while this Deck keeps its state.
  Variants {
    model: root.valid ? root.displayScreens : []

    DeckSurface {
      required property var modelData

      screen: modelData
      service: root.service
      deck: root
    }
  }
}
