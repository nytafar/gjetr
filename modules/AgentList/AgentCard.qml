import QtQuick
import qs.Commons
import "../../lib/CardPolicy.js" as CardPolicy
import "../../lib/StatusPolicy.js" as StatusPolicy

// One Agent as a Card. Shows the Fields its preset selects; colours arrive as
// resolved theme tokens from the list. The Card's height is its Fields band,
// plus the full Recap below it while that is open in the Card.
Item {
  id: root

  property var agent: null
  property var service: null
  property var fields: CardPolicy.fieldsFor(CardPolicy.DEFAULT_PRESET)
  property real textScale: 1
  property bool interactive: true
  // Status: glyph, word, tone and motion (StatusPolicy), and its tone resolved.
  property var indicator: StatusPolicy.indicator("unknown")
  property color statusColor: Color.muted
  // Whether the status word shows beside the glyph (not in the compact preset).
  property bool showStatusWord: true
  property color cacheColor: Color.muted
  // The Agent is in herdr's Focused workspace (highlight_workspace).
  property bool inFocusedWorkspace: false
  // "blocked" or "done" while the Agent is in Attention, else "".
  property string attention: ""
  // Recap: "off", "inline" (clamped under the Fields) or "expand" (a
  // disclosure area and long press ask the list to open or close it).
  property string recapMode: "off"
  property string recapText: ""
  // Whether the full Recap is open inside this Card (recap_open = "card").
  property bool recapOpen: false
  // Height of the Fields band, from CardPolicy.
  property int baseHeight: CardPolicy.cardHeight(CardPolicy.DEFAULT_PRESET)

  signal tapped()
  signal recapRequested()

  readonly property bool recapExpandable: recapMode === "expand" && recapText !== ""
  readonly property bool recapShown: recapOpen && recapExpandable

  readonly property bool focused: !!agent && agent.focused
  readonly property var cacheTimer: fields.cache && service && agent
    ? service.cacheTimerFor(agent, service.nowSeconds) : null
  readonly property string iconUrl: fields.kind && service && agent ? service.kindIconUrl(agent.kind) : ""
  readonly property int pad: Style.spacing.xxl
  readonly property color attentionColor: attention === "blocked" ? Color.urgent : Color.accent

  implicitHeight: baseHeight + (recapShown ? recapBlock.implicitHeight : 0)

  Rectangle {
    anchors.fill: parent
    radius: Style.cornerRadius
    color: tap.pressed
      ? Style.pressedFillFor(Color.foreground, Color.accent)
      : root.focused ? Style.selectedFillFor(Color.foreground, Color.accent)
      : root.inFocusedWorkspace ? Util.alpha(Color.accent, 0.08)
      : Style.normalFillFor(Color.foreground, Color.accent)
    border.width: 1
    border.color: root.focused ? Color.accent
      : root.inFocusedWorkspace ? Util.alpha(Color.accent, 0.35)
      : Util.alpha(Color.foreground, 0.1)
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

  // Status glyph at the leading edge: a distinct shape per status, so it reads
  // without colour; it turns while the Agent is working.
  Item {
    id: statusGlyph
    visible: root.fields.status
    anchors { left: parent.left; leftMargin: root.pad; verticalCenter: band.verticalCenter }
    width: visible ? 28 : 0
    height: 28

    Text {
      id: glyph
      anchors.centerIn: parent
      text: root.indicator.glyph
      color: root.statusColor
      opacity: root.indicator.opacity
      font.family: Style.font.family
      font.pixelSize: Math.round(Style.font.title * root.textScale * 1.3)
      font.bold: root.indicator.status === "blocked" || root.indicator.status === "done"

      RotationAnimation on rotation {
        running: root.indicator.motion === "spin" && root.visible
        from: 0
        to: 360
        duration: 1800
        loops: Animation.Infinite
        onRunningChanged: if (!running) glyph.rotation = 0
      }
    }
  }

  // The Fields band: the Card as it is while no Recap is open in it.
  Item {
    id: band
    anchors { left: parent.left; right: parent.right; top: parent.top }
    height: root.baseHeight
  }

  Item {
    id: kindIcon
    visible: root.fields.kind
    anchors { left: statusGlyph.right; leftMargin: root.pad; verticalCenter: band.verticalCenter }
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
      top: root.recapMode === "inline" ? band.top : undefined
      topMargin: root.recapMode === "inline" ? root.pad / 2 : 0
      verticalCenter: root.recapMode === "inline" ? undefined : band.verticalCenter
    }
    spacing: Style.spacing.xs

    Text {
      width: parent.width
      visible: root.fields.name
      text: root.service && root.agent ? root.service.agentName(root.agent) : ""
      color: Color.foreground
      opacity: root.indicator.textOpacity
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
      opacity: root.indicator.textOpacity
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
      verticalCenter: band.verticalCenter
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

    // The status word, beside the glyph's colour; dropped by the compact preset.
    Text {
      anchors.right: parent.right
      visible: root.fields.status && root.showStatusWord
      text: root.indicator.label
      color: root.statusColor
      opacity: root.indicator.opacity
      font.family: Style.font.family
      font.pixelSize: Math.round(Style.font.caption * root.textScale)
      font.bold: root.indicator.status === "blocked"
    }
  }

  // The Fields band focuses the Agent; a long press opens or closes its Recap.
  Item {
    anchors { left: parent.left; top: band.top; bottom: band.bottom; right: disclosure.visible ? disclosure.left : parent.right }

    TapHandler {
      id: tap
      enabled: root.interactive
      onTapped: root.tapped()
      onLongPressed: if (root.recapExpandable) root.recapRequested()
    }
  }

  // Disclosure area for the Recap, a full-height touch target at the edge of
  // the Fields band. Filled while the Recap is open in the Card.
  Item {
    id: disclosure
    visible: root.recapExpandable
    anchors { right: parent.right; top: band.top; bottom: band.bottom }
    width: visible ? 56 : 0

    Rectangle {
      anchors.fill: parent
      anchors.margins: 1
      radius: Style.cornerRadius
      color: disclosureTap.pressed ? Style.pressedFillFor(Color.foreground, Color.accent)
        : root.recapShown ? Style.selectedFillFor(Color.foreground, Color.accent)
        : "transparent"
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

  // The full Recap, open inside the Card under its Fields. A tap closes it.
  Item {
    id: recapBlock
    visible: root.recapShown
    anchors { left: parent.left; right: parent.right; top: band.bottom }
    height: visible ? implicitHeight : 0
    implicitHeight: recapBody.implicitHeight + root.pad

    Rectangle {
      anchors { left: parent.left; right: parent.right; top: parent.top; leftMargin: root.pad; rightMargin: root.pad }
      height: 1
      color: Util.alpha(Color.foreground, 0.12)
    }

    // Recap text is untrusted: always plain text, never rich text or links.
    Text {
      id: recapBody
      anchors {
        left: parent.left; leftMargin: statusGlyph.width + root.pad * 2
        right: parent.right; rightMargin: root.pad
        top: parent.top; topMargin: root.pad / 2
      }
      text: root.recapShown ? root.recapText : ""
      textFormat: Text.PlainText
      wrapMode: Text.WordWrap
      color: Color.foreground
      font.family: Style.font.family
      font.pixelSize: Math.round(Style.font.body * root.textScale)
      lineHeight: 1.2
    }

    TapHandler {
      onTapped: root.recapRequested()
    }
  }
}
