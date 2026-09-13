pragma ComponentBehavior: Bound

import QtQuick
import qs.Commons
import "../../lib/CardPolicy.js" as CardPolicy
import "../../lib/LayoutPolicy.js" as LayoutPolicy
import "../../lib/ListSyncPolicy.js" as ListSyncPolicy

// The Agent List Module: every Agent as a Card, in the service's Sort mode.
// Presentation only. Data, Sort mode and preset come from the service; a tap
// asks the service to focus the pane, and a header tap is reported upward.
Item {
  id: root

  property var service: null
  property string preset: service ? service.cardPreset : CardPolicy.DEFAULT_PRESET

  signal headerTapped()
  signal focusToggled()

  readonly property string recapMode: service ? service.recapMode : "off"
  // The pane whose Recap is open in the overlay, or "".
  property string recapPane: ""
  readonly property var recapAgent: recapPane !== "" ? (agentByPane[recapPane] || null) : null

  readonly property var fields: CardPolicy.fieldsFor(preset)
  readonly property var agents: service ? service.sortedAgents : []
  // Cards are keyed by pane id in a ListModel that is updated in place, so a
  // new snapshot or a re-sort keeps every Card, its pulse and the scroll
  // position. Each Card finds its Agent in agentByPane.
  property var agentByPane: ({})
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

  GridView {
    id: grid
    anchors {
      top: banner.bottom; bottom: parent.bottom; left: parent.left; right: parent.right
      topMargin: root.gap; leftMargin: root.gap; rightMargin: 0
    }
    clip: true
    model: cardModel
    cellWidth: Math.floor(width / root.columns)
    cellHeight: CardPolicy.cardHeightFor(root.preset, root.recapMode === "inline") + root.gap
    boundsBehavior: Flickable.StopAtBounds
    // Last known Cards stay visible while Offline, greyed out.
    opacity: root.online ? 1 : 0.4

    delegate: AgentCard {
      required property string paneId

      width: grid.cellWidth - root.gap
      height: grid.cellHeight - root.gap
      agent: root.agentByPane[paneId] || null
      service: root.service
      fields: root.fields
      textScale: root.textScale
      interactive: root.online
      statusColor: root.toneColor(CardPolicy.statusTone(agent ? agent.status : ""))
      cacheColor: root.toneColor(CardPolicy.cacheTone(cacheTimer ? cacheTimer.level : ""))
      attention: root.service ? root.service.attentionFor(agent, root.service.attention) : ""
      recapMode: root.recapMode
      recapText: root.service ? root.service.recapFor(agent, root.service.recaps) : ""
      onTapped: if (agent) root.service.focusAgent(agent)
      onRecapRequested: root.recapPane = paneId
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
      onTapped: root.recapPane = ""
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
