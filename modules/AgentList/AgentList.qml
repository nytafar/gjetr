pragma ComponentBehavior: Bound

import QtQuick
import qs.Commons
import "../../lib/CardPolicy.js" as CardPolicy
import "../../lib/LayoutPolicy.js" as LayoutPolicy
import "../../lib/ListSyncPolicy.js" as ListSyncPolicy

// The Agent List Module: every Agent as a Card, in the service's Sort mode.
// Presentation only. Data, Sort mode and preset come from the service; a tap
// asks the service to focus the pane, and a header tap is reported upward.
// Which Recaps are open, in Cards or the overlay, is the service's state.
Item {
  id: root

  property var service: null
  property string preset: service ? service.cardPreset : CardPolicy.DEFAULT_PRESET

  signal headerTapped()
  signal focusToggled()

  readonly property string recapMode: service ? service.recapMode : "off"
  // The Agent whose Recap is open in the overlay (recap_open = "overlay"), or null.
  readonly property string recapPane: service && service.recapOpenMode === "overlay" ? service.recapOverlayPane : ""
  readonly property var recapAgent: recapPane !== "" ? (agentByPane[recapPane] || null) : null

  readonly property var fields: CardPolicy.fieldsFor(preset)
  readonly property var agents: service ? service.sortedAgents : []
  // Cards are keyed by pane id in a ListModel that is updated in place, so a
  // new snapshot or a re-sort keeps every Card, its pulse and the scroll
  // position. Each Card finds its Agent in agentByPane.
  property var agentByPane: ({})
  // Cards may differ in height (a Recap open in its Card), so they are placed
  // by LayoutPolicy.cardPlacement from the model's order and each Card's
  // measured height, rather than by a uniform grid.
  property var cardOrder: []
  property var cardHeights: ({})
  readonly property int baseCardHeight: CardPolicy.cardHeightFor(preset, recapMode === "inline")
  readonly property int cellWidth: Math.floor(grid.width / columns)
  readonly property var placement: LayoutPolicy.cardPlacement(cardOrder, cardHeights, columns, baseCardHeight, gap)
  readonly property bool online: !!service && service.herdrOnline
  readonly property bool offline: !!service && service.herdrOffline
  // Touch panels are read from further away than a desk monitor; scale the
  // Omarchy type ramp rather than replacing it, so `omarchy display text size`
  // still applies.
  readonly property real textScale: 1.25
  readonly property int gap: Style.spacing.lg
  readonly property int minCardWidth: 440
  readonly property int columns: LayoutPolicy.columnsFor(width - gap, minCardWidth, 3)

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
    if (tone === "urgent") return Color.urgent
    if (tone === "accent") return Color.accent
    if (tone === "foreground") return Color.foreground
    return Color.muted
  }

  Item {
    id: header
    anchors { top: parent.top; left: parent.left; right: parent.right }
    height: CardPolicy.MIN_TOUCH_PX

    // Everything left of the Focus toggle cycles the Sort mode.
    Rectangle {
      id: sortArea
      anchors { top: parent.top; bottom: parent.bottom; left: parent.left; right: focusToggle.left }
      color: headerTap.pressed ? Style.pressedFillFor(Color.foreground, Color.accent) : "transparent"

      Text {
        anchors { left: parent.left; leftMargin: root.gap * 2; verticalCenter: parent.verticalCenter }
        text: root.agents.length === 1 ? "1 agent" : root.agents.length + " agents"
        color: Color.foreground
        font.family: Style.font.family
        font.pixelSize: Math.round(Style.font.title * root.textScale)
        font.bold: true
      }

      Text {
        anchors { right: parent.right; rightMargin: root.gap * 2; verticalCenter: parent.verticalCenter }
        text: "sort  " + (root.service ? root.service.sortMode : "")
        // Accent while an Override shadows the Config default.
        color: root.service && root.service.sortOverridden ? Color.accent : Color.muted
        font.family: Style.font.family
        font.pixelSize: Math.round(Style.font.body * root.textScale)
      }

      TapHandler {
        id: headerTap
        onTapped: root.headerTapped()
      }
    }

    // Focus behaviour: herdr only, or also the hosting window.
    Rectangle {
      id: focusToggle
      anchors { top: parent.top; bottom: parent.bottom; right: parent.right }
      width: Math.max(CardPolicy.MIN_TOUCH_PX, focusLabel.implicitWidth + root.gap * 4)
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
        text: "focus  " + (root.service ? root.service.focusMode : "")
        color: root.service && root.service.focusOverridden ? Color.accent : Color.muted
        font.family: Style.font.family
        font.pixelSize: Math.round(Style.font.body * root.textScale)
      }

      TapHandler {
        id: focusTap
        onTapped: root.focusToggled()
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
      topMargin: root.gap; leftMargin: root.gap; rightMargin: 0
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

      delegate: AgentCard {
        required property string paneId

        readonly property var place: root.placement.positions[paneId] || null

        x: place ? place.column * root.cellWidth : 0
        y: place ? place.y : 0
        width: root.cellWidth - root.gap
        agent: root.agentByPane[paneId] || null
        service: root.service
        fields: root.fields
        textScale: root.textScale
        baseHeight: root.baseCardHeight
        interactive: root.online
        statusColor: root.toneColor(CardPolicy.statusTone(agent ? agent.status : ""))
        cacheColor: root.toneColor(CardPolicy.cacheTone(cacheTimer ? cacheTimer.level : ""))
        attention: root.service ? root.service.attentionFor(agent, root.service.attention) : ""
        recapMode: root.recapMode
        recapText: root.service ? root.service.recapFor(agent, root.service.recaps) : ""
        recapOpen: root.service ? root.service.recapOpenFor(agent, root.service.recapOpen) : false
        onTapped: if (agent) root.service.focusAgent(agent)
        onRecapRequested: if (root.service) root.service.toggleRecap(paneId)
        onHeightChanged: root.setCardHeight(paneId, height)
        Component.onCompleted: root.setCardHeight(paneId, height)
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
    font.pixelSize: Math.round(Style.font.title * root.textScale)
  }
}
