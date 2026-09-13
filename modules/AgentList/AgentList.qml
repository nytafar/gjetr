pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Window
import qs.Commons
import "../../lib/CardPolicy.js" as CardPolicy
import "../../lib/DensityPolicy.js" as DensityPolicy
import "../../lib/LayoutPolicy.js" as LayoutPolicy
import "../../lib/ListSyncPolicy.js" as ListSyncPolicy
import "../../lib/StatusPolicy.js" as StatusPolicy

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
  // "pointer" on a Dock, "touch" on a surface: with the Module's size it picks
  // the density (DensityPolicy). Comfortable draws Cards, compact draws rows.
  property string input: "touch"

  readonly property var density: DensityPolicy.tokens({ width: width, height: height, input: input,
    fonts: { caption: Style.font.caption, body: Style.font.body, title: Style.font.title },
    spacing: { sm: Style.spacing.sm, lg: Style.spacing.lg, xxl: Style.spacing.xxl }, dpr: Screen.devicePixelRatio })
  readonly property bool compact: !density.boxed

  // Checked by type: while a Layout file loads, this key can briefly name a
  // Module of another type.
  readonly property var moduleState: service && service.moduleStates[moduleKey]
    && service.moduleStates[moduleKey].type === "agent-list" ? service.moduleStates[moduleKey] : null
  readonly property string preset: moduleState ? moduleState.preset : CardPolicy.DEFAULT_PRESET
  readonly property string sortMode: moduleState ? moduleState.sort : "spaces"
  readonly property string focusMode: moduleState ? moduleState.focus : "herdr"
  // highlight_workspace: Cards of Agents in herdr's Focused workspace get a
  // subtle tint. It never filters the list.
  readonly property string highlightedWorkspace: service && moduleState && moduleState.highlightWorkspace
    ? service.focusedWorkspaceId : ""

  readonly property string recapMode: moduleState ? moduleState.recap : "off"
  // The Agent whose Recap is open in this Module's overlay (recap_open =
  // "overlay"), or null.
  readonly property string recapPane: service && moduleState && moduleState.recapOpen === "overlay"
    && service.recapOverlay.key === moduleKey ? service.recapOverlay.pane : ""
  readonly property var recapAgent: recapPane !== "" ? (agentByPane[recapPane] || null) : null

  readonly property var fields: CardPolicy.fieldsFor(preset)
  readonly property var agents: service ? (service.sortedByMode[sortMode] || []) : []
  // Cards are keyed by pane id in a ListModel that is updated in place, so a
  // new snapshot or a re-sort keeps every Card, its pulse and the scroll
  // position. Each Card finds its Agent in agentByPane.
  property var agentByPane: ({})
  // Cards may differ in height (a Recap open in its Card), so they are placed
  // by LayoutPolicy.cardPlacement from the model's order and each Card's
  // measured height, rather than by a uniform grid.
  property var cardOrder: []
  property var cardHeights: ({})
  // The height of a Card before it is measured. Each Card's own base height
  // adds room for an inline Recap only when its Agent has one.
  readonly property int baseCardHeight: compact ? DensityPolicy.rowHeight(density, false) : CardPolicy.cardHeight(preset)
  readonly property int cellWidth: Math.floor(grid.width / columns)
  readonly property var placement: LayoutPolicy.cardPlacement(cardOrder, cardHeights, columns, baseCardHeight,
    compact ? density.rowGap : gap)
  readonly property bool online: !!service && service.herdrOnline
  readonly property bool offline: !!service && service.herdrOffline
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

  function syncCards() {
    var map = {}
    var keys = []
    for (var i = 0; i < agents.length; i++) {
      map[agents[i].paneId] = agents[i]
      keys.push(agents[i].paneId)
    }
    var current = []
    for (var j = 0; j < cardModel.count; j++) current.push(cardModel.get(j).paneId)
    agentByPane = map
    var steps = ListSyncPolicy.syncSteps(current, keys)
    for (var k = 0; k < steps.length; k++) {
      var step = steps[k]
      if (step.op === "remove") cardModel.remove(step.index, 1)
      else if (step.op === "move") cardModel.move(step.from, step.to, 1)
      else cardModel.insert(step.index, { paneId: step.key })
    }
    var heights = {}
    for (var h = 0; h < keys.length; h++) {
      if (Object.prototype.hasOwnProperty.call(cardHeights, keys[h])) heights[keys[h]] = cardHeights[keys[h]]
    }
    cardHeights = heights
    cardOrder = keys
  }

  // A Card reports its height. When one changes without a re-sort, the Card at
  // the top of the view keeps its place, so an open Recap above it never
  // shifts what is on screen.
  function setCardHeight(paneId, height) {
    if (cardHeights[paneId] === height) return
    var before = placement
    var next = {}
    for (var key in cardHeights) next[key] = cardHeights[key]
    next[paneId] = height
    cardHeights = next
    if (grid.moving || grid.contentY <= 0) return
    grid.contentY = LayoutPolicy.clampScroll(LayoutPolicy.keepScroll(before, placement, cardOrder, grid.contentY),
      placement.contentHeight, grid.height)
  }

  onAgentsChanged: syncCards()
  Component.onCompleted: syncCards()

  ListModel {
    id: cardModel
  }

  function toneColor(tone) {
    if (tone === "success") return service ? service.successColor : Color.accent
    if (tone === "urgent") return Color.urgent
    if (tone === "accent") return Color.accent
    if (tone === "foreground") return Color.foreground
    return Color.muted
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
    visible: !root.online
    height: visible ? implicitHeight : 0
    horizontalAlignment: Text.AlignHCenter
    text: root.offline ? "herdr offline, retrying" : "connecting to herdr"
    color: Color.muted
    font.family: Style.font.family
    font.pixelSize: Math.round(Style.font.body * root.textScale)
  }

  Flickable {
    id: grid
    anchors {
      top: banner.bottom; bottom: parent.bottom; left: parent.left; right: parent.right
      topMargin: root.gap; leftMargin: root.compact ? 0 : root.gap; rightMargin: 0
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
      model: cardModel

      // A Card (comfortable) or a row (compact) per Agent, placed by the list
      // and reporting its height back to it.
      delegate: Item {
        id: cell
        required property string paneId

        readonly property var place: root.placement.positions[paneId] || null
        readonly property var agent: root.agentByPane[paneId] || null
        readonly property var indicator: StatusPolicy.indicator(agent ? agent.status : "")
        readonly property var cacheTimer: root.service && agent ? root.service.cacheTimerFor(agent, root.service.nowSeconds) : null
        readonly property string recapText: root.service ? root.service.recapFor(agent, root.service.recaps) : ""
        readonly property string attention: root.service ? root.service.attentionFor(agent, root.service.attention) : ""
        readonly property bool inFocusedWorkspace: root.highlightedWorkspace !== "" && !!agent
          && agent.workspaceId === root.highlightedWorkspace
        readonly property bool recapOpen: root.service ? root.service.recapOpenFor(agent, root.service.recapOpen, root.moduleKey) : false

        function focusIt() {
          if (agent && root.service) root.service.focusAgent(agent, root.moduleKey, root.input)
        }

        function toggleRecap() {
          if (root.service) root.service.toggleRecap(paneId, root.moduleKey)
        }

        x: place ? place.column * root.cellWidth : 0
        y: place ? place.y : 0
        width: root.cellWidth - (root.compact && root.columns === 1 ? 0 : root.gap)
        height: loader.item ? loader.item.implicitHeight : root.baseCardHeight
        onHeightChanged: root.setCardHeight(paneId, height)
        Component.onCompleted: root.setCardHeight(paneId, height)

        Loader {
          id: loader
          width: cell.width
          sourceComponent: root.compact ? rowComponent : cardComponent
        }

        Component {
          id: cardComponent

          AgentCard {
            width: cell.width
            agent: cell.agent
            service: root.service
            fields: root.fields
            textScale: root.textScale
            baseHeight: CardPolicy.cardHeightFor(root.preset, root.recapMode, cell.recapText)
            interactive: root.online
            indicator: cell.indicator
            statusColor: root.toneColor(cell.indicator.tone)
            showStatusWord: StatusPolicy.showsLabel(root.preset)
            cacheColor: root.toneColor(CardPolicy.cacheTone(cell.cacheTimer ? cell.cacheTimer.level : ""))
            attention: cell.attention
            inFocusedWorkspace: cell.inFocusedWorkspace
            recapMode: root.recapMode
            recapText: cell.recapText
            recapOpen: cell.recapOpen
            onTapped: cell.focusIt()
            onRecapRequested: cell.toggleRecap()
          }
        }

        Component {
          id: rowComponent

          AgentRow {
            width: cell.width
            agent: cell.agent
            service: root.service
            fields: root.fields
            density: root.density
            secondLine: DensityPolicy.secondLine(root.density, root.preset, root.recapMode, cell.recapText, root.height)
            baseHeight: DensityPolicy.rowHeight(root.density, secondLine !== "")
            interactive: root.online
            indicator: cell.indicator
            statusColor: root.toneColor(cell.indicator.tone)
            cacheColor: root.toneColor(CardPolicy.cacheTone(cell.cacheTimer ? cell.cacheTimer.level : ""))
            attention: cell.attention
            inFocusedWorkspace: cell.inFocusedWorkspace
            recapMode: root.recapMode
            recapText: cell.recapText
            recapOpen: cell.recapOpen
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
        text: root.recapAgent && root.service ? root.service.agentName(root.recapAgent) : ""
        color: Color.foreground
        font.family: Style.font.family
        font.pixelSize: Math.round(Style.font.title * root.textScale)
        font.bold: true
        elide: Text.ElideRight
      }

      Text {
        width: parent.width
        text: root.recapAgent && root.service ? root.service.agentLocation(root.recapAgent) : ""
        color: Color.muted
        font.family: Style.font.family
        font.pixelSize: Math.round(Style.font.body * root.textScale)
      }

      Text {
        width: parent.width
        text: root.recapAgent && root.service ? root.service.recapFor(root.recapAgent, root.service.recaps) : ""
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
