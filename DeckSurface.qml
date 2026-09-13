pragma ComponentBehavior: Bound

import QtQuick
import Quickshell
import Quickshell.Wayland
import qs.Commons
import "lib/LayoutPolicy.js" as LayoutPolicy
import "lib/DeckPolicy.js" as DeckPolicy
import "lib/CardPolicy.js" as CardPolicy
import "modules/AgentList"
import "modules/WorkspaceList"

// The full-output surface on one Display. Renders only: every value comes from
// the service it registers with.
//
// Layer configuration follows OmaDeck's components/DeckSurface.qml
// (github.com/TheAirick/OmaDeck, MIT, Copyright (c) 2026 Erik Holum).
PanelWindow {
  id: root

  property var service: null

  readonly property var inset: service ? service.barInset : ({ top: 0, right: 0, bottom: 0, left: 0 })
  readonly property bool tabsShown: !!service && service.tabsVisible
  readonly property string tabEdge: DeckPolicy.tabEdge(service ? service.barPosition : "", service ? service.barHidden : false,
    width, height)
  readonly property int tabThickness: CardPolicy.MIN_TOUCH_PX
  readonly property var tabRect: DeckPolicy.tabRect(width, height, inset, tabEdge, tabThickness)
  readonly property var contentRect: LayoutPolicy.contentRect(width, height,
    DeckPolicy.withTabs(inset, tabEdge, tabThickness, tabsShown))

  // Where each Module of the active Layout goes in the content area: side by
  // side on a landscape area, stacked on a portrait one, sized by weight.
  readonly property int moduleGap: Style.spacing.lg
  readonly property var moduleRects: LayoutPolicy.moduleRects(contentRect.width, contentRect.height,
    service ? service.activeModules.map(function(module) { return module.weight }) : [], moduleGap)

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

  DeckTabs {
    visible: root.tabsShown
    x: root.tabRect.x
    y: root.tabRect.y
    width: root.tabRect.width
    height: root.tabRect.height
    edge: root.tabEdge
    names: root.service ? root.service.deckLayouts : []
    active: root.service ? root.service.activeLayoutName : ""
    badges: root.service ? root.service.tabBadges : []
    onSelected: function(name) { if (root.service) root.service.selectLayout(name) }
  }

  Item {
    id: contentArea
    x: root.contentRect.x
    y: root.contentRect.y
    width: root.contentRect.width
    height: root.contentRect.height
    clip: true

    // Every Module of the active Layout, each in its own rectangle and keyed
    // <layout>#<index>, so its Overrides and session state are its own.
    Repeater {
      model: root.service ? root.service.activeModules : []

      Item {
        id: slot
        required property var modelData
        required property int index

        readonly property var rect: root.moduleRects[index] || ({ x: 0, y: 0, width: 0, height: 0 })

        x: rect.x
        y: rect.y
        width: rect.width
        height: rect.height
        clip: true

        Loader {
          anchors.fill: parent
          sourceComponent: slot.modelData.type === "agent-list" ? agentList
            : slot.modelData.type === "workspace-list" ? workspaceList
            : null
        }

        Component {
          id: agentList

          AgentList {
            service: root.service
            moduleKey: slot.modelData.key
          }
        }

        Component {
          id: workspaceList

          WorkspaceList {
            service: root.service
            moduleKey: slot.modelData.key
          }
        }
      }
    }

    // A hairline between neighbouring Modules, in the middle of the gap.
    Repeater {
      model: Math.max(0, root.moduleRects.length - 1)

      Rectangle {
        required property int index

        readonly property var next: root.moduleRects[index + 1]
        readonly property bool row: next.x > 0

        color: Util.alpha(Color.foreground, 0.12)
        x: row ? next.x - Math.ceil(root.moduleGap / 2) : 0
        y: row ? 0 : next.y - Math.ceil(root.moduleGap / 2)
        width: row ? 1 : contentArea.width
        height: row ? contentArea.height : 1
      }
    }

    // Swipe between Layouts. Sits above the Module but only takes a passive
    // grab on press, so taps and vertical list scrolls still reach it; it
    // takes over once a drag passes the threshold sideways.
    Item {
      anchors.fill: parent
      z: 10
      enabled: root.tabsShown

      DragHandler {
        id: swipe
        target: null
        yAxis.enabled: false
        property point start: Qt.point(0, 0)

        onActiveChanged: {
          if (active) {
            start = centroid.scenePressPosition
            return
          }
          var end = centroid.scenePosition
          if (root.service) root.service.swipeLayout(end.x - start.x, end.y - start.y)
        }
      }
    }
  }
}
