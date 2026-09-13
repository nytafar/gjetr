import QtQuick
import qs.Commons
import "../../lib/CardPolicy.js" as CardPolicy

// One Agent as a Card. Shows the Fields its preset selects; colours arrive as
// resolved theme tokens from the list.
Item {
  id: root

  property var agent: null
  property var service: null
  property var fields: CardPolicy.fieldsFor(CardPolicy.DEFAULT_PRESET)
  property real textScale: 1
  property bool interactive: true
  property color statusColor: Color.muted
  property color cacheColor: Color.muted
  // "blocked" or "done" while the Agent is in Attention, else "".
  property string attention: ""
  // Recap: "off", "inline" (clamped under the Fields) or "expand" (a
  // disclosure area and long press ask the list to show it in full).
  property string recapMode: "off"
  property string recapText: ""

  signal tapped()
  signal recapRequested()

  readonly property bool recapExpandable: recapMode === "expand" && recapText !== ""

  readonly property bool focused: !!agent && agent.focused
  readonly property var cacheTimer: fields.cache && service && agent
    ? service.cacheTimerFor(agent, service.nowSeconds) : null
  readonly property string iconUrl: fields.kind && service && agent ? service.kindIconUrl(agent.kind) : ""
  readonly property int pad: Style.spacing.xxl
  readonly property color attentionColor: attention === "blocked" ? Color.urgent : Color.accent

  Rectangle {
    anchors.fill: parent
    radius: Style.cornerRadius
    color: tap.pressed
      ? Style.pressedFillFor(Color.foreground, Color.accent)
      : root.focused ? Style.selectedFillFor(Color.foreground, Color.accent)
      : Style.normalFillFor(Color.foreground, Color.accent)
    border.width: 1
    border.color: root.focused ? Color.accent : Util.alpha(Color.foreground, 0.1)
  }

  // Attention: a tinted fill and a thick border in the status colour, breathing
  // between full and faint so it reads from across the desk, on black too.
  Rectangle {
    id: pulse
    anchors.fill: parent
    radius: Style.cornerRadius
    visible: root.attention !== ""
    color: Util.alpha(root.attentionColor, 0.3)
    border.width: 3
    border.color: root.attentionColor

    SequentialAnimation on opacity {
      running: pulse.visible
      loops: Animation.Infinite
      onRunningChanged: if (!running) pulse.opacity = 1
      NumberAnimation { from: 1; to: 0.2; duration: 650; easing.type: Easing.InOutSine }
      NumberAnimation { from: 0.2; to: 1; duration: 650; easing.type: Easing.InOutSine }
    }
  }

  // Status indicator: a bar down the leading edge in the status tone.
  Rectangle {
    id: statusBar
    visible: root.fields.status
    anchors { left: parent.left; top: parent.top; bottom: parent.bottom; margins: 1 }
    width: visible ? 5 : 0
    color: root.statusColor
  }

  Item {
    id: kindIcon
    visible: root.fields.kind
    anchors { left: statusBar.right; leftMargin: root.pad; verticalCenter: parent.verticalCenter }
    width: visible ? 28 : 0
    height: 28

    Image {
      id: kindImage
      anchors.fill: parent
      source: root.iconUrl
      sourceSize.width: 56
      sourceSize.height: 56
      fillMode: Image.PreserveAspectFit
      smooth: true
      visible: status === Image.Ready
    }

    Text {
      anchors.centerIn: parent
      visible: kindImage.status !== Image.Ready
      text: root.agent ? CardPolicy.kindGlyph(root.agent.kind, root.agent.displayKind) : ""
      color: Color.muted
      font.family: Style.font.family
      font.pixelSize: Math.round(Style.font.title * root.textScale)
      font.bold: true
    }
  }

  Column {
    anchors {
      left: kindIcon.right; leftMargin: root.pad
      right: trailing.left; rightMargin: root.pad
      top: parent.top; topMargin: root.recapMode === "inline" ? root.pad / 2 : 0
      verticalCenter: root.recapMode === "inline" ? undefined : parent.verticalCenter
    }
    spacing: Style.spacing.xs

    Text {
      width: parent.width
      visible: root.fields.name
      text: root.service && root.agent ? root.service.agentName(root.agent) : ""
      color: Color.foreground
      font.family: Style.font.family
      font.pixelSize: Math.round(Style.font.title * root.textScale)
      font.bold: root.focused
      elide: Text.ElideRight
      maximumLineCount: 1
    }

    Text {
      width: parent.width
      visible: root.fields.location
      text: root.service && root.agent ? root.service.agentLocation(root.agent) : ""
      color: Color.muted
      font.family: Style.font.family
      font.pixelSize: Math.round(Style.font.body * root.textScale)
      elide: Text.ElideMiddle
      maximumLineCount: 1
    }

    // Recap text is untrusted: always plain text, never rich text or links.
    Text {
      width: parent.width
      visible: root.recapMode === "inline" && root.recapText !== ""
      text: root.recapText
      textFormat: Text.PlainText
      color: Color.muted
      font.family: Style.font.family
      font.pixelSize: Math.round(Style.font.caption * root.textScale)
      wrapMode: Text.WordWrap
      maximumLineCount: 2
      elide: Text.ElideRight
    }
  }

  Column {
    id: trailing
    anchors {
      right: disclosure.visible ? disclosure.left : parent.right
      rightMargin: disclosure.visible ? 0 : root.pad
      verticalCenter: parent.verticalCenter
    }
    spacing: Style.spacing.xs

    Text {
      anchors.right: parent.right
      visible: root.fields.cache && root.cacheTimer !== null
      text: root.cacheTimer ? root.cacheTimer.label : ""
      color: root.cacheColor
      opacity: root.cacheTimer && root.cacheTimer.level === "cold" ? 0.7 : 1
      font.family: Style.font.family
      font.pixelSize: Math.round(Style.font.title * root.textScale)
      font.bold: root.cacheTimer !== null && root.cacheTimer.level === "critical"
      font.features: { "tnum": 1 }
    }

    Text {
      anchors.right: parent.right
      visible: root.fields.status && root.fields.location
      text: root.agent ? root.agent.status : ""
      color: root.statusColor
      font.family: Style.font.family
      font.pixelSize: Math.round(Style.font.caption * root.textScale)
    }
  }

  // The Card body focuses the Agent; a long press opens its Recap.
  Item {
    anchors { left: parent.left; top: parent.top; bottom: parent.bottom; right: disclosure.visible ? disclosure.left : parent.right }

    TapHandler {
      id: tap
      enabled: root.interactive
      onTapped: root.tapped()
      onLongPressed: if (root.recapExpandable) root.recapRequested()
    }
  }

  // Disclosure area for the Recap, a full-height touch target at the edge.
  Item {
    id: disclosure
    visible: root.recapExpandable
    anchors { right: parent.right; top: parent.top; bottom: parent.bottom }
    width: visible ? 56 : 0

    Rectangle {
      anchors.fill: parent
      anchors.margins: 1
      radius: Style.cornerRadius
      color: disclosureTap.pressed ? Style.pressedFillFor(Color.foreground, Color.accent) : "transparent"
    }

    Rectangle {
      anchors { left: parent.left; verticalCenter: parent.verticalCenter }
      width: 1
      height: parent.height / 2
      color: Util.alpha(Color.foreground, 0.12)
    }

    Text {
      anchors.centerIn: parent
      text: "recap"
      rotation: -90
      color: Color.accent
      font.family: Style.font.family
      font.pixelSize: Math.round(Style.font.caption * root.textScale)
    }

    TapHandler {
      id: disclosureTap
      onTapped: root.recapRequested()
    }
  }
}
