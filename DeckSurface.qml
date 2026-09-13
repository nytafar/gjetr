pragma ComponentBehavior: Bound

import QtQuick
import Quickshell
import Quickshell.Wayland
import qs.Commons
import "lib/LayoutPolicy.js" as LayoutPolicy
import "lib/DeckPolicy.js" as DeckPolicy
import "lib/DockPolicy.js" as DockPolicy
import "lib/CardPolicy.js" as CardPolicy
import "lib/DensityPolicy.js" as DensityPolicy
import "modules/AgentList"
import "modules/WorkspaceList"
import "modules/Usage"

// A Display's surface. Renders only: every value comes from its Deck and the
// service. Two kinds:
//
// - surface: the whole output, Bottom layer, reserving nothing. It spans
//   under the Omarchy bar and steps its content out of the bar's strip.
// - dock: a strip along one edge, Top layer so ordinary windows never cover
//   it, reserving its size as a layer-shell exclusive zone so windows tile
//   beside it on every workspace. The compositor places it beside the bar, so
//   it needs no bar inset. Hidden, it is unmapped and reserves nothing.
//
// Neither ever takes keyboard focus.
//
// Layer configuration follows OmaDeck's components/DeckSurface.qml
// (github.com/TheAirick/OmaDeck, MIT, Copyright (c) 2026 Erik Holum).
PanelWindow {
  id: root

  property var service: null
  property var deck: null

  readonly property bool isDock: !!deck && deck.isDock
  // How the Display is used, for each Module's density: a Dock with the mouse,
  // a surface by touch.
  readonly property string input: DensityPolicy.inputFor(isDock ? "dock" : "surface")
  readonly property string dockEdge: deck ? deck.edge : ""
  readonly property var dockGeometry: DockPolicy.geometry(dockEdge, deck ? deck.dockSize : 0,
    screen ? screen.width : 0, screen ? screen.height : 0)
  // The strip a shown Dock keeps free of windows.
  readonly property int reservedSize: isDock && visible ? dockGeometry.size : 0
  readonly property string layerName: isDock ? "top" : "bottom"

  readonly property var inset: !isDock && service ? service.barInset : ({ top: 0, right: 0, bottom: 0, left: 0 })
  readonly property bool tabsShown: !!deck && deck.tabsVisible
  readonly property string tabEdge: isDock ? DockPolicy.tabEdge(dockEdge)
    : DeckPolicy.tabEdge(service ? service.barPosition : "", service ? service.barHidden : false, width, height)
  readonly property int tabThickness: CardPolicy.MIN_TOUCH_PX
  readonly property var tabRect: DeckPolicy.tabRect(width, height, inset, tabEdge, tabThickness)
  readonly property var contentRect: LayoutPolicy.contentRect(width, height,
    DeckPolicy.withTabs(inset, tabEdge, tabThickness, tabsShown))

  // Where each Module of the active Layout goes in the content area: side by
  // side on a landscape area, stacked on a portrait one, sized by weight. A
  // pinned Module goes to the end; stacked, it takes the content height its
  // slot reports into contentHeights, keyed by Module key. Only a stacked
  // area reads them: side by side a Module's width follows the rectangles, and
  // its content height with it.
  readonly property int moduleGap: Style.spacing.lg
  readonly property bool stacked: LayoutPolicy.stacksModules(contentRect.width, contentRect.height)
  property var contentHeights: ({})
  readonly property var moduleRects: LayoutPolicy.moduleRects(contentRect.width, contentRect.height,
    deck ? deck.activeModules.map(function(module) { return module.weight }) : [], moduleGap,
    deck ? deck.activeModules.map(function(module) {
      if (module.pin !== "end") return null
      return root.stacked ? (root.contentHeights[module.key] || 0) : 0
    }) : [])
  readonly property var moduleDividers: LayoutPolicy.moduleDividers(contentRect.width, contentRect.height,
    moduleRects, moduleGap)

  function setContentHeight(key, height) {
    if (root.contentHeights[key] === height) return
    var next = {}
    for (var name in root.contentHeights) next[name] = root.contentHeights[name]
    next[key] = height
    root.contentHeights = next
  }

  // Modules are placed into the content area, which never sits under the bar.
  default property alias content: contentArea.data

  anchors {
    top: !root.isDock || root.dockGeometry.anchors.top
    right: !root.isDock || root.dockGeometry.anchors.right
    bottom: !root.isDock || root.dockGeometry.anchors.bottom
    left: !root.isDock || root.dockGeometry.anchors.left
  }
  implicitWidth: isDock ? dockGeometry.width : 0
  implicitHeight: isDock ? dockGeometry.height : 0
  visible: !deck || deck.shown
  exclusionMode: isDock && visible ? ExclusionMode.Auto : ExclusionMode.Ignore
  color: deck ? deck.background : "black"
  WlrLayershell.namespace: isDock ? "gjetr-dock" : "gjetr"
  WlrLayershell.layer: isDock ? WlrLayer.Top : WlrLayer.Bottom
  // gjetr is touch-driven and must never pull keyboard focus off the desk.
  WlrLayershell.keyboardFocus: WlrKeyboardFocus.None

  Component.onCompleted: if (deck) deck.registerSurface(root)
  Component.onDestruction: if (deck) deck.unregisterSurface(root)

  DeckTabs {
    visible: root.tabsShown
    x: root.tabRect.x
    y: root.tabRect.y
    width: root.tabRect.width
    height: root.tabRect.height
    edge: root.tabEdge
    names: root.deck ? root.deck.deckLayouts : []
    active: root.deck ? root.deck.activeLayoutName : ""
    badges: root.deck ? root.deck.tabBadges : []
    onSelected: function(name) { if (root.deck) root.deck.selectLayout(name) }
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
      model: root.deck ? root.deck.activeModules : []

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

        // A pinned Module's content height, for its place in the Layout. Only a
        // Usage Module has one.
        readonly property int contentHeight: modelData.pin === "end" && loader.item
          && loader.item.contentHeight !== undefined ? loader.item.contentHeight : 0
        onContentHeightChanged: if (modelData.pin === "end") root.setContentHeight(modelData.key, contentHeight)

        Loader {
          id: loader
          anchors.fill: parent
          sourceComponent: slot.modelData.type === "agent-list" ? agentList
            : slot.modelData.type === "workspace-list" ? workspaceList
            : slot.modelData.type === "usage" ? usage
            : null
        }

        Component {
          id: agentList

          AgentList {
            service: root.service
            moduleKey: slot.modelData.key
            input: root.input
          }
        }

        Component {
          id: workspaceList

          WorkspaceList {
            service: root.service
            moduleKey: slot.modelData.key
            input: root.input
          }
        }

        Component {
          id: usage

          Usage {
            service: root.service
            moduleKey: slot.modelData.key
            input: root.input
          }
        }
      }
    }

    // A hairline between neighbouring Modules, in the middle of the gap.
    Repeater {
      model: root.moduleDividers

      Rectangle {
        required property var modelData

        color: Util.alpha(Color.foreground, 0.12)
        x: modelData.x
        y: modelData.y
        width: modelData.width
        height: modelData.height
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
          if (root.deck) root.deck.swipeLayout(end.x - start.x, end.y - start.y)
        }
      }
    }
  }
}
