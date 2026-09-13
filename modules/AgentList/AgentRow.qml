import QtQuick
import qs.Commons
import "../../lib/CardPolicy.js" as CardPolicy
import "../../lib/StatusPolicy.js" as StatusPolicy
import "../../lib/IndicatorPolicy.js" as IndicatorPolicy
import "../../components"
import "../../lib/RepoModel.js" as RepoModel

// One Agent as a compact row, for a pointer Display or a narrow column
// (DensityPolicy): no box, one line of status glyph, small kind mark, name and
// Cache timer, and a dim second line (the inline Recap clamped to one line, or
// the Repo and workspace › tab when the preset shows location and there is
// room). Clicking the row focuses the Agent;
// clicking the Recap line, or the disclosure mark with recap = "expand",
// opens the full Recap under the row. Same inputs as AgentCard.
Item {
  id: root

  property var agent: null
  property var service: null
  property var fields: CardPolicy.fieldsFor("compact")
  property var density: null
  property bool interactive: true
  property var indicator: StatusPolicy.indicator("unknown")
  // The kind mark as status indicator (IndicatorPolicy): the Module's
  // indicator setting, this Agent's mark state with its tone resolved, the
  // theme palette for the hue effect, and whether the mark may move (on screen).
  property string indicatorMode: IndicatorPolicy.DEFAULT_MODE
  property var mark: IndicatorPolicy.markFor("unknown", "", "")
  property color markColor: Color.muted
  property var palette: []
  property bool animate: true
  readonly property bool showGlyph: fields.status && IndicatorPolicy.showsGlyph(indicatorMode, fields.kind)
  property color statusColor: Color.muted
  property color cacheColor: Color.muted
  property bool inFocusedWorkspace: false
  property string attention: ""
  property string recapMode: "off"
  property string recapText: ""
  property bool recapOpen: false
  // "recap", "location" or "" (DensityPolicy.secondLine).
  property string secondLine: ""
  // Height of the row's lines, from DensityPolicy.rowHeight.
  property int baseHeight: 22

  signal tapped()
  signal recapRequested()

  readonly property var t: density || ({ namePx: 12, detailPx: 10, glyphPx: 14, iconPx: 14, iconSourcePx: 28,
    statusWidth: 16, pad: 8, gap: 6, padY: 5, lineGap: 3, lineHeight: 17, secondLineHeight: 13,
    rowGap: 1, dividerAlpha: 0.08 })
  readonly property bool recapExpandable: recapMode === "expand" && recapText !== ""
  // The Recap line opens the full Recap in place, as the disclosure does for expand.
  readonly property bool recapInline: secondLine === "recap"
  readonly property bool recapShown: recapOpen && recapText !== "" && (recapExpandable || recapInline)
  readonly property bool focused: !!agent && agent.focused
  readonly property var cacheTimer: fields.cache && service && agent
    ? service.cacheTimerFor(agent, service.nowSeconds) : null
  readonly property string iconUrl: fields.kind && service && agent ? service.kindIconUrl(agent.kind) : ""
  readonly property color attentionColor: attention === "blocked" ? Color.urgent : Color.accent

  implicitHeight: baseHeight + (recapShown ? recapBlock.implicitHeight : 0)

  Rectangle {
    anchors.fill: parent
    radius: Math.min(Style.cornerRadius, 4)
    color: tap.pressed || recapTap.pressed || disclosureTap.pressed ? Style.pressedFillFor(Color.foreground, Color.accent)
      : root.focused ? Style.selectedFillFor(Color.foreground, Color.accent)
      : hover.hovered ? Util.alpha(Color.foreground, 0.06)
      : root.inFocusedWorkspace ? Util.alpha(Color.accent, 0.07)
      : "transparent"
  }

  // A hairline in the gap under the row separates it from the next.
  Rectangle {
    visible: (root.t.dividerAlpha || 0) > 0 && (root.t.rowGap || 0) > 0
    x: root.t.pad
    y: root.height
    width: Math.max(0, root.width - root.t.pad * 2)
    height: root.t.rowGap || 0
    color: Util.alpha(Color.foreground, root.t.dividerAlpha || 0)
  }

  HoverHandler {
    id: hover
    enabled: root.interactive
    cursorShape: Qt.PointingHandCursor
  }

  // Focused: a thin accent bar at the leading edge instead of a border.
  Rectangle {
    visible: root.focused && root.attention === ""
    anchors { left: parent.left; top: parent.top; bottom: parent.bottom }
    width: 2
    color: Color.accent
  }

  // Attention: a tint and a bar in the status colour, breathing.
  Item {
    id: pulse
    anchors.fill: parent
    visible: root.attention !== ""

    Rectangle {
      anchors.fill: parent
      radius: Math.min(Style.cornerRadius, 4)
      color: Util.alpha(root.attentionColor, 0.25)
    }

    Rectangle {
      anchors { left: parent.left; top: parent.top; bottom: parent.bottom }
      width: 3
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

  // The first line: glyph, kind mark, name, Cache timer.
  Item {
    id: line
    anchors { left: parent.left; right: parent.right; top: parent.top; topMargin: root.t.padY }
    height: root.t.lineHeight
  }

  Item {
    id: statusGlyph
    visible: root.showGlyph
    anchors { left: parent.left; leftMargin: root.t.pad; verticalCenter: line.verticalCenter }
    width: visible ? root.t.statusWidth : 0
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
        running: root.indicator.motion === "spin" && root.visible && root.showGlyph
        from: 0
        to: 360
        duration: 1800
        loops: Animation.Infinite
        onRunningChanged: if (!running) glyph.rotation = 0
      }
    }
  }

  KindMark {
    id: kindIcon
    visible: root.fields.kind
    anchors { left: statusGlyph.right; leftMargin: statusGlyph.visible ? root.t.gap : 0; verticalCenter: line.verticalCenter }
    width: visible ? root.t.iconPx : 0
    height: root.t.iconPx
    iconUrl: root.iconUrl
    tinted: root.service && root.agent ? root.service.kindIconTinted(root.agent.kind) : false
    letter: root.agent ? CardPolicy.kindGlyph(root.agent.kind, root.agent.displayKind) : ""
    sourcePx: root.t.iconSourcePx
    letterPx: root.t.detailPx
    frameRadius: Math.min(Style.cornerRadius, 3)
    stateful: IndicatorPolicy.marksState(root.indicatorMode)
    mark: root.mark
    toneColor: root.markColor
    palette: root.palette
    animate: root.animate && root.visible
  }

  Text {
    id: nameText
    anchors {
      left: kindIcon.right; leftMargin: root.t.pad
      right: cacheText.visible ? cacheText.left : disclosure.left
      rightMargin: root.t.pad
      verticalCenter: line.verticalCenter
    }
    visible: root.fields.name
    text: root.service && root.agent ? root.service.agentName(root.agent) : ""
    textFormat: Text.PlainText
    color: Color.foreground
    opacity: root.indicator.textOpacity
    font.family: Style.font.family
    font.pixelSize: root.t.namePx
    font.bold: root.focused
    elide: Text.ElideRight
    maximumLineCount: 1
  }

  Text {
    id: cacheText
    anchors { right: disclosure.left; rightMargin: disclosure.visible ? root.t.gap : root.t.pad; verticalCenter: line.verticalCenter }
    visible: root.fields.cache && root.cacheTimer !== null
    text: root.cacheTimer ? root.cacheTimer.label : ""
    color: root.cacheColor
    opacity: root.cacheTimer && root.cacheTimer.level === "cold" ? 0.6 : 1
    font.family: Style.font.family
    font.pixelSize: root.t.detailPx + 1
    font.bold: root.cacheTimer !== null && root.cacheTimer.level === "critical"
    font.features: { "tnum": 1 }
  }

  // The dim second line: the Recap clamped to one line, or workspace › tab.
  // Recap text is untrusted: always plain text, never rich text or links.
  Text {
    id: detailText
    visible: root.secondLine !== ""
    x: nameText.x
    width: Math.max(0, root.width - x - root.t.pad)
    y: line.y + line.height + root.t.lineGap
    height: root.t.secondLineHeight
    verticalAlignment: Text.AlignVCenter
    text: root.secondLine === "recap" ? root.recapText
      : root.secondLine === "location" && root.service && root.agent
        ? RepoModel.withLocation(root.service.agentRepo(root.agent, root.service.repos).text, root.service.agentLocation(root.agent)) : ""
    textFormat: Text.PlainText
    color: Color.muted
    opacity: root.recapShown ? 0.5 : 0.85
    font.family: Style.font.family
    font.pixelSize: root.t.detailPx
    elide: root.secondLine === "recap" ? Text.ElideRight : Text.ElideMiddle
    maximumLineCount: 1
  }

  // The row's lines focus the Agent.
  Item {
    anchors { left: parent.left; top: parent.top; right: disclosure.visible ? disclosure.left : parent.right }
    height: root.baseHeight

    TapHandler {
      id: tap
      enabled: root.interactive
      onTapped: root.tapped()
      onLongPressed: if (root.recapExpandable || root.recapInline) root.recapRequested()
    }
  }

  // The Recap line opens and closes the full Recap.
  Item {
    visible: root.recapInline
    x: detailText.x
    y: detailText.y
    width: detailText.width
    height: detailText.height

    TapHandler {
      id: recapTap
      onTapped: root.recapRequested()
    }
  }

  // With recap = "expand": a small disclosure mark at the trailing edge.
  Item {
    id: disclosure
    visible: root.recapExpandable
    anchors { right: parent.right; top: parent.top }
    height: root.baseHeight
    width: visible ? root.t.lineHeight + root.t.pad : 0

    Text {
      anchors.centerIn: parent
      text: root.recapShown ? "▾" : "▸"
      color: Color.accent
      font.family: Style.font.family
      font.pixelSize: root.t.namePx
    }

    TapHandler {
      id: disclosureTap
      onTapped: root.recapRequested()
    }
  }

  // The full Recap, open under the row. A click closes it.
  Item {
    id: recapBlock
    visible: root.recapShown
    anchors { left: parent.left; right: parent.right; top: parent.top; topMargin: root.baseHeight }
    height: visible ? implicitHeight : 0
    implicitHeight: recapBody.implicitHeight + root.t.pad

    Text {
      id: recapBody
      x: nameText.x
      width: Math.max(0, parent.width - x - root.t.pad)
      text: root.recapShown ? root.recapText : ""
      textFormat: Text.PlainText
      wrapMode: Text.WordWrap
      color: Color.foreground
      opacity: 0.85
      font.family: Style.font.family
      font.pixelSize: root.t.detailPx + 1
      lineHeight: 1.15
    }

    TapHandler {
      onTapped: root.recapRequested()
    }
  }
}
