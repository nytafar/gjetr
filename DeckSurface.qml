import QtQuick
import Quickshell
import Quickshell.Wayland
import qs.Commons
import "lib/LayoutPolicy.js" as LayoutPolicy
import "modules/AgentList"

// The full-output surface on one Display. Renders only: every value comes from
// the service it registers with.
//
// Layer configuration follows OmaDeck's components/DeckSurface.qml
// (github.com/TheAirick/OmaDeck, MIT, Copyright (c) 2026 Erik Holum).
PanelWindow {
  id: root

  property var service: null

  readonly property var inset: service ? service.barInset : ({ top: 0, right: 0, bottom: 0, left: 0 })
  readonly property var contentRect: LayoutPolicy.contentRect(width, height, inset)

  // Modules are placed into the content area, which never sits under the bar.
  default property alias content: contentArea.data

  anchors { top: true; right: true; bottom: true; left: true }
  exclusionMode: ExclusionMode.Ignore
  color: service ? service.background : "black"
  WlrLayershell.namespace: "gjetr"
  WlrLayershell.layer: WlrLayer.Bottom
  // gjetr is touch-driven and must never pull keyboard focus off the desk.
  WlrLayershell.keyboardFocus: WlrKeyboardFocus.None

  Component.onCompleted: if (service) service.registerSurface(root)
  Component.onDestruction: if (service) service.unregisterSurface(root)

  Item {
    id: contentArea
    x: root.contentRect.x
    y: root.contentRect.y
    width: root.contentRect.width
    height: root.contentRect.height
    clip: true

    AgentList {
      anchors.fill: parent
      service: root.service
    }
  }
}
