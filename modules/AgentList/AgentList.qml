pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Window
import qs.Commons
import "../../lib/CardPolicy.js" as CardPolicy
import "../../lib/CardModel.js" as CardModel
import "../../lib/DensityPolicy.js" as DensityPolicy
import "../../lib/LayoutPolicy.js" as LayoutPolicy
import "../../components"

// The Agent List Module: every Agent as a Card, in this Module's Sort mode.
// Presentation only. Its settings (Config shadowed by Overrides) come from the
// service under its Module key; taps ask the service to focus a pane, cycle the
// Sort mode or flip Focus behaviour for this Module. Which Recaps are open, in
// Cards or the overlay, is the service's state.
Item {
  id: root

  property var service: null
  // <layout>#<index>: this Module's Overrides and session state.
  property string moduleKey: ""
  // "pointer" on a Dock, "touch" on a surface: with the Module's size and its
  // density setting it picks the density (DensityPolicy). Comfortable draws
  // Cards, compact draws rows, full draws full Cards.
  property string input: "touch"

  readonly property var density: DensityPolicy.tokens({ width: width, height: height, input: input,
    setting: moduleState ? moduleState.density : DensityPolicy.DEFAULT_SETTING, module: "agent-list",
    fonts: { caption: Style.font.caption, body: Style.font.body, title: Style.font.title },
    spacing: { sm: Style.spacing.sm, lg: Style.spacing.lg, xxl: Style.spacing.xxl }, dpr: Screen.devicePixelRatio })
  // Unboxed: compact rows and full Cards share the list's tight spacing.
  readonly property bool compact: !density.boxed
  readonly property bool full: density.name === "full"

  // Checked by type: while a Layout file loads, this key can briefly name a
  // Module of another type.
  readonly property var moduleState: service && service.moduleStates[moduleKey]
    && service.moduleStates[moduleKey].type === "agent-list" ? service.moduleStates[moduleKey] : null
  readonly property string preset: moduleState ? moduleState.preset : CardPolicy.DEFAULT_PRESET
  readonly property string sortMode: moduleState ? moduleState.sort : "spaces"
  readonly property string focusMode: moduleState ? moduleState.focus : "herdr"
  readonly property string recapMode: moduleState ? moduleState.recap : "off"
  // The service's maps a Card's Fields are resolved from (CardModel.build), in
  // one object so a change to any of them rebuilds the Cards.
  readonly property var facts: service ? ({ recaps: service.recaps, repos: service.repos, attention: service.attention,
    cacheTimers: service.cacheTimers, cacheSettings: service.cacheSettings, recapOpen: service.recapOpen,
    focusedWorkspaceId: service.focusedWorkspaceId, home: service.home, lightBackground: service.lightBackground,
    moduleKey: moduleKey, densityName: density.name }) : null
  // Marks move only while this list's window is shown (a hidden Dock is not).
  readonly property bool windowShown: !Window.window || Window.window.visible
  // The Agent whose Recap is open in this Module's overlay (recap_open =
  // "overlay"), or null.
  readonly property string recapPane: service && moduleState && moduleState.recapOpen === "overlay"
    && service.recapOverlay.key === moduleKey ? service.recapOverlay.pane : ""
  readonly property var recapAgent: recapPane !== "" ? (keyed.byKey[recapPane] || null) : null
  readonly property var recapCard: recapAgent && service
    ? CardModel.build(recapAgent, moduleState, facts, service.nowSeconds) : CardModel.EMPTY

  readonly property var agents: service ? (service.sortedByMode[sortMode] || []) : []
  // Cards may differ in height (a Recap open in its Card), so they are placed
  // by LayoutPolicy.cardPlacement from the keyed order and each Card's
  // measured height, rather than by a uniform grid.
  property var cardHeights: ({})
  // The height of a Card before it is measured. Each Card's own base height
  // adds room for an inline Recap only when its Agent has one.
  readonly property int baseCardHeight: full ? DensityPolicy.fullCardHeight(density, false)
    : compact ? DensityPolicy.rowHeight(density, false) : CardPolicy.cardHeight(preset)
  readonly property int cellWidth: Math.floor(grid.width / columns)
  readonly property var placement: LayoutPolicy.cardPlacement(keyed.order, cardHeights, columns, baseCardHeight,
    compact ? density.rowGap : gap)
  readonly property bool online: !!service && service.herdrOnline
  readonly property bool offline: !!service && service.herdrOffline
  readonly property string mismatchCue: service ? service.herdrMismatchCue : ""
  // Touch panels are read from further away than a desk monitor, so
  // comfortable scales the Omarchy type ramp rather than replacing it (and
  // `omarchy display text size` still applies); compact uses it as it is.
  readonly property real textScale: density.textScale
  readonly property int gap: density.gap
  readonly property int headerPad: compact ? density.pad + 2 : gap * 2
  readonly property int minCardWidth: density.minColumnWidth
  readonly property int columns: LayoutPolicy.columnsFor(width - gap, minCardWidth, 3)
  // A narrow list (a Dock) shows its header toggles as bare values.
  readonly property bool compactHeader: CardPolicy.compactHeader(width)

  // Forgets the heights of Cards whose Agent left.
  function pruneCardHeights() {
    var heights = {}
    for (var i = 0; i < keyed.order.length; i++) {
      var key = keyed.order[i]
      if (Object.prototype.hasOwnProperty.call(cardHeights, key)) heights[key] = cardHeights[key]
    }
    cardHeights = heights
  }

  // A Card reports its height. The Card at the top of the view keeps its
  // place, so an open Recap above it never shifts what is on screen.
  function setCardHeight(paneId, height) {
    if (cardHeights[paneId] === height) return
    keyed.holdScroll(function() {
      var next = {}
      for (var key in root.cardHeights) next[key] = root.cardHeights[key]
      next[paneId] = height
      root.cardHeights = next
    })
  }

  // Cards keyed by pane id and updated in place, so a new snapshot or a
  // re-sort keeps every Card, its pulse and the Card at the top of the view.
  KeyedList {
    id: keyed
    items: root.agents
    keyOf: "paneId"
    view: grid
    placement: root.placement
    onOrderChanged: root.pruneCardHeights()
  }

  Item {
    id: header
    anchors { top: parent.top; left: parent.left; right: parent.right }
    height: root.density.headerHeight

    // Everything left of the Focus toggle cycles the Sort mode.
    Rectangle {
      id: sortArea
      anchors { top: parent.top; bottom: parent.bottom; left: parent.left; right: focusToggle.left }
      color: headerTap.pressed ? Style.pressedFillFor(Color.foreground, Color.accent) : "transparent"

      Text {
        anchors {
          left: parent.left; leftMargin: root.headerPad
          right: sortLabel.left; rightMargin: root.gap
          verticalCenter: parent.verticalCenter
        }
        elide: Text.ElideRight
        text: root.agents.length === 1 ? "1 agent" : root.agents.length + " agents"
        color: Color.foreground
        font.family: Style.font.family
        font.pixelSize: root.density.titlePx
        font.bold: true
      }

      Text {
        id: sortLabel
        anchors { right: parent.right; rightMargin: root.headerPad; verticalCenter: parent.verticalCenter }
        text: CardPolicy.headerCaption("sort", root.sortMode, root.compactHeader)
        // Accent while an Override shadows the Config default.
        color: root.moduleState && root.moduleState.sortOverridden ? Color.accent : Color.muted
        font.family: Style.font.family
        font.pixelSize: root.density.bodyPx
      }

      TapHandler {
        id: headerTap
        onTapped: if (root.service) root.service.cycleSortMode(root.moduleKey)
      }
    }

    // Focus behaviour: herdr only, or also the hosting window.
    Rectangle {
      id: focusToggle
      anchors { top: parent.top; bottom: parent.bottom; right: parent.right }
      width: Math.max(root.density.headerHeight, focusLabel.implicitWidth + root.headerPad * 2)
      color: focusTap.pressed ? Style.pressedFillFor(Color.foreground, Color.accent) : "transparent"

      Rectangle {
        anchors { left: parent.left; verticalCenter: parent.verticalCenter }
        width: 1
        height: parent.height / 2
        color: Util.alpha(Color.foreground, 0.12)
      }

      Text {
        id: focusLabel
        anchors.centerIn: parent
        text: CardPolicy.headerCaption("focus", root.focusMode, root.compactHeader)
        color: root.moduleState && root.moduleState.focusOverridden ? Color.accent : Color.muted
        font.family: Style.font.family
        font.pixelSize: root.density.bodyPx
      }

      TapHandler {
        id: focusTap
        onTapped: if (root.service) root.service.toggleFocusMode(root.moduleKey)
      }
    }

    Rectangle {
      anchors { left: parent.left; right: parent.right; bottom: parent.bottom }
      height: 1
      color: Util.alpha(Color.foreground, 0.12)
    }
  }

  Text {
    id: banner
    anchors { top: header.bottom; left: parent.left; right: parent.right; topMargin: root.gap }
    // Offline wins; online to an untested herdr protocol shows a quiet cue.
    visible: !root.online || root.mismatchCue !== ""
    height: visible ? implicitHeight : 0
    horizontalAlignment: Text.AlignHCenter
    elide: Text.ElideRight
    text: !root.online ? (root.offline ? "herdr offline, retrying" : "connecting to herdr") : root.mismatchCue
    color: Color.muted
    font.family: Style.font.family
    font.pixelSize: Math.round(Style.font.body * root.textScale)
  }

  Flickable {
    id: grid
    anchors {
      top: banner.bottom; bottom: parent.bottom; left: parent.left; right: parent.right
      topMargin: root.full ? root.density.rowGap * 2 : root.gap
      leftMargin: root.full ? root.density.rowGap * 2 : root.compact ? 0 : root.gap
      rightMargin: root.full ? root.density.rowGap * 2 : 0
    }
    clip: true
    contentWidth: width
    contentHeight: root.placement.contentHeight
    flickableDirection: Flickable.VerticalFlick
    boundsBehavior: Flickable.StopAtBounds
    // Last known Cards stay visible while Offline, greyed out.
    opacity: root.online ? 1 : 0.4

    // Removing Agents or closing a Recap can leave the view past the end.
    onContentHeightChanged: {
      if (moving) return
      var y = LayoutPolicy.clampScroll(contentY, contentHeight, height)
      if (y !== contentY) contentY = y
    }

    Repeater {
      model: keyed.model

      // A Card (comfortable) or a row (compact) per Agent, placed by the list
      // and reporting its height back to it.
      delegate: Item {
        id: cell
        // The Agent's pane id.
        required property string key

        readonly property var place: root.placement.positions[key] || null
        readonly property var agent: keyed.byKey[key] || null
        // Every Field this Agent's Card draws, resolved once.
        readonly property var card: root.service
          ? CardModel.build(agent, root.moduleState, root.facts, root.service.nowSeconds) : CardModel.EMPTY
        // Within the list's view and its window shown: only then may a mark move.
        readonly property bool onScreen: root.windowShown && y + height > grid.contentY && y < grid.contentY + grid.height

        function focusIt() {
          if (agent && root.service) root.service.focusAgent(agent, root.moduleKey, root.input)
        }

        function toggleRecap() {
          if (root.service) root.service.toggleRecap(key, root.moduleKey)
        }

        x: place ? place.column * root.cellWidth : 0
        y: place ? place.y : 0
        width: root.cellWidth - (root.compact && root.columns === 1 ? 0 : root.gap)
        height: loader.item ? loader.item.implicitHeight : root.baseCardHeight
        onHeightChanged: root.setCardHeight(key, height)
        Component.onCompleted: root.setCardHeight(key, height)

        Loader {
          id: loader
          width: cell.width
          sourceComponent: root.full ? fullComponent : root.compact ? rowComponent : cardComponent
        }

        Component {
          id: cardComponent

          AgentCard {
            width: cell.width
            card: cell.card
            service: root.service
            textScale: root.textScale
            baseHeight: CardPolicy.cardHeightFor(root.preset, root.recapMode, cell.card.recap.text)
            interactive: root.online
            palette: root.service ? root.service.indicatorPalette : []
            animate: cell.onScreen
            onTapped: cell.focusIt()
            onRecapRequested: cell.toggleRecap()
          }
        }

        Component {
          id: fullComponent

          AgentFullCard {
            width: cell.width
            card: cell.card
            service: root.service
            density: root.density
            baseHeight: DensityPolicy.fullCardHeight(root.density, cell.card.recap.expandable || cell.card.recap.inline)
            interactive: root.online
            palette: root.service ? root.service.indicatorPalette : []
            animate: cell.onScreen
            onTapped: cell.focusIt()
            onRecapRequested: cell.toggleRecap()
          }
        }

        Component {
          id: rowComponent

          AgentRow {
            width: cell.width
            card: cell.card
            service: root.service
            density: root.density
            secondLine: DensityPolicy.secondLine(root.density, root.preset, root.recapMode, cell.card.recap.text, root.height)
            baseHeight: DensityPolicy.rowHeight(root.density, secondLine !== "")
            interactive: root.online
            palette: root.service ? root.service.indicatorPalette : []
            animate: cell.onScreen
            onTapped: cell.focusIt()
            onRecapRequested: cell.toggleRecap()
          }
        }
      }
    }
  }

  // Recap overlay: the whole Recap of one Agent, over the list. A tap
  // anywhere closes it.
  Rectangle {
    anchors.fill: parent
    z: 20
    visible: root.recapAgent !== null
    color: Util.alpha(Color.background, 0.92)

    TapHandler {
      onTapped: if (root.service) root.service.closeRecapOverlay()
    }

    Column {
      anchors { left: parent.left; right: parent.right; top: parent.top; margins: root.gap * 2 }
      spacing: root.gap

      Text {
        width: parent.width
        text: root.recapCard.name
        color: Color.foreground
        font.family: Style.font.family
        font.pixelSize: Math.round(Style.font.title * root.textScale)
        font.bold: true
        elide: Text.ElideRight
      }

      Text {
        width: parent.width
        text: root.recapCard.location
        color: Color.muted
        font.family: Style.font.family
        font.pixelSize: Math.round(Style.font.body * root.textScale)
      }

      Text {
        width: parent.width
        text: root.recapCard.recap.text
        textFormat: Text.PlainText
        wrapMode: Text.WordWrap
        color: Color.foreground
        font.family: Style.font.family
        font.pixelSize: Math.round(Style.font.body * root.textScale)
        lineHeight: 1.2
      }

      Text {
        text: "tap to close"
        color: Color.muted
        font.family: Style.font.family
        font.pixelSize: Math.round(Style.font.caption * root.textScale)
      }
    }
  }

  Text {
    anchors.centerIn: grid
    visible: root.online && root.agents.length === 0
    text: "No agents"
    color: Color.muted
    font.family: Style.font.family
    font.pixelSize: root.density.titlePx
  }
}
