import QtQuick
import qs.Commons
import "../../lib/CardPolicy.js" as CardPolicy
import "../../lib/DensityPolicy.js" as DensityPolicy
import "../../lib/StatusPolicy.js" as StatusPolicy

// One Agent as a full Card (density = "full"), to be read leaning back from a
// 4K Dock: the name large, the status glyph with its word and the repo and
// branch under it, the Cache timer as a large number over a bar draining in
// its level's colour, and the Recap's first two lines. Clicking the Recap
// opens all of it inside the Card, on an accent-tinted panel; clicking again
// closes it. Clicking anywhere else focuses the Agent. Same inputs as
// AgentCard and AgentRow, plus the repo and location texts.
Item {
  id: root

  property var agent: null
  property var service: null
  property var fields: CardPolicy.fieldsFor(CardPolicy.DEFAULT_PRESET)
  property var density: null
  property bool interactive: true
  property var indicator: StatusPolicy.indicator("unknown")
  property color statusColor: Color.muted
  property color cacheColor: Color.foreground
  property color cacheBarColor: Color.muted
  property bool inFocusedWorkspace: false
  property string attention: ""
  property string recapMode: "off"
  property string recapText: ""
  property bool recapOpen: false
  // "repo <mark> branch" or a short path (RepoModel), and workspace › tab.
  property string repoText: ""
  property string locationText: ""
  // Height without an open Recap, from DensityPolicy.fullCardHeight.
  property int baseHeight: 80

  signal tapped()
  signal recapRequested()

  readonly property var t: density || DensityPolicy.tokens({ width: 360, height: 714, input: "pointer", setting: "full",
    module: "agent-list" })
  readonly property bool hasRecap: DensityPolicy.fullRecapShown(recapMode, recapText)
  readonly property bool recapShown: recapOpen && hasRecap
  readonly property bool focused: !!agent && agent.focused
  readonly property var cacheTimer: fields.cache && service && agent
    ? service.cacheTimerFor(agent, service.nowSeconds) : null
  readonly property string iconUrl: fields.kind && service && agent ? service.kindIconUrl(agent.kind) : ""
  readonly property color attentionColor: attention === "blocked" ? Color.urgent : Color.accent
  readonly property int radius: Math.min(Style.cornerRadius, 6)
  // Where the text starts, right of the glyph column.
  readonly property int textX: t.pad + (fields.status || fields.kind ? t.statusWidth + t.gap : 0)
  // The top of the Recap: under the name line and the status and repo line.
  readonly property int headHeight: t.padY + t.lineHeight + t.lineGap + t.secondLineHeight
  readonly property int textRight: cacheColumn.visible ? cacheColumn.x - t.gap : width - t.pad

  implicitHeight: recapShown ? headHeight + t.recapGap + recapPanel.height + t.padY : baseHeight

  Rectangle {
    anchors.fill: parent
    radius: root.radius
    color: headTap.pressed || recapTap.pressed ? Style.pressedFillFor(Color.foreground, Color.accent)
      : root.focused ? Style.selectedFillFor(Color.foreground, Color.accent)
      : hover.hovered ? Util.alpha(Color.foreground, 0.08)
      : root.inFocusedWorkspace ? Util.alpha(Color.accent, 0.07)
      : Util.alpha(Color.foreground, 0.035)
  }

  HoverHandler {
    id: hover
    enabled: root.interactive
    cursorShape: Qt.PointingHandCursor
  }

  // Focused: an accent bar along the leading edge.
  Rectangle {
    visible: root.focused && root.attention === ""
    anchors { left: parent.left; top: parent.top; bottom: parent.bottom; topMargin: root.radius; bottomMargin: root.radius }
    width: 3
    radius: 1.5
    color: Color.accent
  }

  // Attention: a tint and a bar in the status colour, breathing.
  Item {
    id: pulse
    anchors.fill: parent
    visible: root.attention !== ""

    Rectangle {
      anchors.fill: parent
      radius: root.radius
      color: Util.alpha(root.attentionColor, 0.22)
    }

    Rectangle {
      anchors { left: parent.left; top: parent.top; bottom: parent.bottom; topMargin: root.radius; bottomMargin: root.radius }
      width: 4
      radius: 2
      color: root.attentionColor
    }

    SequentialAnimation on opacity {
      running: pulse.visible
      loops: Animation.Infinite
      onRunningChanged: if (!running) pulse.opacity = 1
      NumberAnimation { from: 1; to: 0.25; duration: 650; easing.type: Easing.InOutSine }
      NumberAnimation { from: 0.25; to: 1; duration: 650; easing.type: Easing.InOutSine }
    }
  }

  // The name line and the status line, as boxes to centre things on.
  Item {
    id: nameLine
    x: 0
    y: root.t.padY
    width: root.width
    height: root.t.lineHeight
  }

  Item {
    id: metaLine
    x: 0
    y: nameLine.y + nameLine.height + root.t.lineGap
    width: root.width
    height: root.t.secondLineHeight
  }

  // The glyph column: the status glyph on the name line, the kind mark under it.
  Item {
    id: statusGlyph
    visible: root.fields.status
    x: root.t.pad
    anchors.verticalCenter: nameLine.verticalCenter
    width: root.t.statusWidth
    height: root.t.statusWidth

    Text {
      id: glyph
      anchors.centerIn: parent
      text: root.indicator.glyph
      color: root.statusColor
      opacity: root.indicator.opacity
      font.family: Style.font.family
      font.pixelSize: root.t.glyphPx
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

  Item {
    id: kindIcon
    visible: root.fields.kind
    x: root.t.pad + Math.round((root.t.statusWidth - width) / 2)
    anchors.verticalCenter: metaLine.verticalCenter
    width: root.t.iconPx
    height: root.t.iconPx

    Image {
      id: kindImage
      anchors.fill: parent
      source: root.iconUrl
      sourceSize.width: root.t.iconSourcePx
      sourceSize.height: root.t.iconSourcePx
      fillMode: Image.PreserveAspectFit
      smooth: true
      opacity: 0.85
      visible: status === Image.Ready
    }

    Text {
      anchors.centerIn: parent
      visible: kindImage.status !== Image.Ready
      text: root.agent ? CardPolicy.kindGlyph(root.agent.kind, root.agent.displayKind) : ""
      color: Color.muted
      font.family: Style.font.family
      font.pixelSize: root.t.metaPx
      font.bold: true
    }
  }

  Text {
    id: nameText
    x: root.textX
    anchors.verticalCenter: nameLine.verticalCenter
    width: Math.max(0, root.textRight - x)
    visible: root.fields.name
    text: root.service && root.agent ? root.service.agentName(root.agent) : ""
    textFormat: Text.PlainText
    color: Color.foreground
    opacity: root.indicator.textOpacity
    font.family: Style.font.family
    font.pixelSize: root.t.namePx
    font.weight: root.focused ? Font.Bold : Font.Medium
    elide: Text.ElideRight
    maximumLineCount: 1
  }

  // The status word, then repo and branch, then workspace › tab when it fits.
  Text {
    id: statusWord
    x: root.textX
    anchors.verticalCenter: metaLine.verticalCenter
    text: root.indicator.label
    color: root.statusColor
    opacity: root.indicator.opacity
    font.family: Style.font.family
    font.pixelSize: root.t.metaPx
    font.bold: root.indicator.status === "blocked" || root.indicator.status === "done"
  }

  Text {
    id: repoLabel
    readonly property int room: Math.max(0, root.textRight - x)
    x: statusWord.x + statusWord.implicitWidth + root.t.gap
    anchors.verticalCenter: metaLine.verticalCenter
    width: Math.min(implicitWidth, room)
    visible: text !== "" && room > root.t.metaPx * 3
    text: root.repoText
    textFormat: Text.PlainText
    color: Color.muted
    font.family: Style.font.family
    font.pixelSize: root.t.metaPx
    elide: Text.ElideMiddle
    maximumLineCount: 1
  }

  Text {
    id: locationLabel
    readonly property int startX: repoLabel.visible ? repoLabel.x + repoLabel.width + root.t.gap * 1.5 : repoLabel.x
    x: startX
    anchors.verticalCenter: metaLine.verticalCenter
    visible: root.fields.location && text !== "" && root.textRight - startX >= implicitWidth
    text: root.locationText
    textFormat: Text.PlainText
    color: Color.muted
    opacity: 0.6
    font.family: Style.font.family
    font.pixelSize: root.t.metaPx
  }

  // The Cache timer: a large number on the name line over a bar draining from
  // full (a fresh cache) to empty (cold), in the level's colour.
  Item {
    id: cacheColumn
    visible: root.fields.cache && root.cacheTimer !== null
    x: root.width - root.t.pad - width
    y: nameLine.y
    width: Math.max(cacheText.implicitWidth, root.t.cacheBarWidth)
    height: metaLine.y + metaLine.height - nameLine.y

    Text {
      id: cacheText
      anchors { right: parent.right; verticalCenter: undefined }
      y: Math.round((root.t.lineHeight - height) / 2)
      text: root.cacheTimer ? root.cacheTimer.label : ""
      color: root.cacheColor
      opacity: root.cacheTimer && root.cacheTimer.level === "cold" ? 0.55 : 1
      font.family: Style.font.family
      font.pixelSize: root.cacheTimer && root.cacheTimer.level === "cold" ? root.t.metaPx + 2 : root.t.cachePx
      font.weight: root.cacheTimer && root.cacheTimer.level === "critical" ? Font.Bold : Font.Medium
      font.features: { "tnum": 1 }
    }

    Rectangle {
      id: cacheTrack
      anchors.right: parent.right
      y: metaLine.y - nameLine.y + Math.round((root.t.secondLineHeight - height) / 2)
      width: root.t.cacheBarWidth
      height: root.t.cacheBarHeight
      radius: height / 2
      color: Util.alpha(Color.foreground, 0.12)

      Rectangle {
        anchors { left: parent.left; top: parent.top; bottom: parent.bottom }
        width: root.cacheTimer ? Math.round(parent.width * root.cacheTimer.fraction) : 0
        radius: parent.radius
        color: root.cacheBarColor
        Behavior on width { NumberAnimation { duration: 400; easing.type: Easing.OutCubic } }
      }
    }
  }

  // The name and status lines focus the Agent; without a Recap, the whole Card.
  Item {
    x: 0
    y: 0
    width: root.width
    height: root.hasRecap ? root.headHeight + Math.round(root.t.recapGap / 2) : root.height

    TapHandler {
      id: headTap
      enabled: root.interactive
      onTapped: root.tapped()
      onLongPressed: if (root.hasRecap) root.recapRequested()
    }
  }

  // The Recap's first two lines. Untrusted: plain text only.
  Text {
    id: recapPreview
    visible: root.hasRecap && !root.recapShown
    x: root.textX
    y: root.headHeight + root.t.recapGap
    width: Math.max(0, root.width - root.t.pad - x)
    height: root.t.recapLineHeight * root.t.recapLines
    text: visible ? root.recapText : ""
    textFormat: Text.PlainText
    wrapMode: Text.Wrap
    maximumLineCount: root.t.recapLines
    elide: Text.ElideRight
    lineHeightMode: Text.FixedHeight
    lineHeight: root.t.recapLineHeight
    color: Color.foreground
    opacity: 0.6 * root.indicator.textOpacity
    font.family: Style.font.family
    font.pixelSize: root.t.recapPx
  }

  // The whole Recap, open in the Card: an accent-tinted panel with an accent
  // rule, in full foreground, so it reads as opened rather than as more lines.
  Rectangle {
    id: recapPanel
    visible: root.recapShown
    x: root.textX - root.t.gap
    y: root.headHeight + root.t.recapGap
    width: Math.max(0, root.width - root.t.pad + Math.round(root.t.gap / 2) - x)
    height: visible ? recapBody.implicitHeight + root.t.gap * 1.5 + closeHint.implicitHeight : 0
    radius: Math.min(Style.cornerRadius, 4)
    color: Util.alpha(Color.accent, 0.1)

    Rectangle {
      anchors { left: parent.left; top: parent.top; bottom: parent.bottom }
      width: 2
      color: Color.accent
    }

    Text {
      id: recapBody
      anchors { left: parent.left; right: parent.right; top: parent.top; leftMargin: root.t.gap; rightMargin: root.t.gap; topMargin: root.t.gap / 2 }
      text: root.recapShown ? root.recapText : ""
      textFormat: Text.PlainText
      wrapMode: Text.Wrap
      color: Color.foreground
      font.family: Style.font.family
      font.pixelSize: root.t.recapPx + 1
      lineHeight: 1.25
    }

    Text {
      id: closeHint
      anchors { right: parent.right; top: recapBody.bottom; rightMargin: root.t.gap; topMargin: root.t.gap / 2 }
      text: "▴ close"
      color: Color.accent
      opacity: 0.8
      font.family: Style.font.family
      font.pixelSize: root.t.captionPx
    }
  }

  // Clicking the Recap, closed or open, toggles it.
  Item {
    visible: root.hasRecap
    x: 0
    y: root.headHeight + Math.round(root.t.recapGap / 2)
    width: root.width
    height: root.height - y

    TapHandler {
      id: recapTap
      enabled: root.interactive
      onTapped: root.recapRequested()
    }
  }
}
