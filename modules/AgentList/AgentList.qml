pragma ComponentBehavior: Bound

import QtQuick
import qs.Commons
import "../../lib/CardPolicy.js" as CardPolicy
import "../../lib/LayoutPolicy.js" as LayoutPolicy

// The Agent List Module: every Agent as a Card, in the service's Sort mode.
// Presentation only. Data, Sort mode and preset come from the service; a tap
// asks the service to focus the pane, and a header tap is reported upward.
Item {
  id: root

  property var service: null
  property string preset: service ? service.cardPreset : CardPolicy.DEFAULT_PRESET

  signal headerTapped()
  signal focusToggled()

  readonly property var fields: CardPolicy.fieldsFor(preset)
  readonly property var agents: service ? service.sortedAgents : []
  readonly property bool online: !!service && service.herdrOnline
  readonly property bool offline: !!service && service.herdrOffline
  // Touch panels are read from further away than a desk monitor; scale the
  // Omarchy type ramp rather than replacing it, so `omarchy display text size`
  // still applies.
  readonly property real textScale: 1.25
  readonly property int gap: Style.spacing.lg
  readonly property int minCardWidth: 440
  readonly property int columns: LayoutPolicy.columnsFor(width - gap, minCardWidth, 3)

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
    model: root.agents
    cellWidth: Math.floor(width / root.columns)
    cellHeight: CardPolicy.cardHeight(root.preset) + root.gap
    boundsBehavior: Flickable.StopAtBounds
    // Last known Cards stay visible while Offline, greyed out.
    opacity: root.online ? 1 : 0.4

    delegate: AgentCard {
      required property var modelData

      width: grid.cellWidth - root.gap
      height: grid.cellHeight - root.gap
      agent: modelData
      service: root.service
      fields: root.fields
      textScale: root.textScale
      interactive: root.online
      statusColor: root.toneColor(CardPolicy.statusTone(modelData.status))
      cacheColor: root.toneColor(CardPolicy.cacheTone(cacheTimer ? cacheTimer.level : ""))
      attention: root.service ? root.service.attentionFor(modelData, root.service.attention) : ""
      onTapped: root.service.focusAgent(modelData)
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
