import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import "lib/LayoutPolicy.js" as LayoutPolicy

// Owns Display selection and everything that must outlive a surface. The
// surface itself is created per matching screen and registers back here, so
// state and the IPC target survive the Display being unplugged.
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

  function log(message) {
    console.info("[gjetr] " + message)
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
      bar: { position: barPosition, size: barSize, hidden: barHidden, inset: barInset }
    })
  }

  Component.onCompleted: log("service up, display " + displayName
    + (displayScreens.length > 0 ? " present" : " absent"))
  Component.onDestruction: log("service down")
  onDisplayScreensChanged: log("display " + displayName
    + (displayScreens.length > 0 ? " present" : " absent"))

  IpcHandler {
    target: "nytafar.gjetr"

    function state(): string {
      return root.stateJson()
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
