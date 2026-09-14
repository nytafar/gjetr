import QtQuick
import qs.Commons
import "../../lib/CardModel.js" as CardModel
import "../../lib/MotionPolicy.js" as MotionPolicy
import "../../components"
import "../../lib/RepoModel.js" as RepoModel

// One Agent as a compact row, for a pointer Display or a narrow column
// (DensityPolicy): no box, one line of status glyph, small kind mark, name and
// Cache timer, and a dim second line (the inline Recap clamped to one line, or
// the Repo and workspace › tab when the preset shows location and there is
// room). Clicking the row focuses the Agent;
// clicking the Recap line, or the disclosure mark with recap = "expand",
// opens the full Recap under the row. Draws its CardModel card, as AgentCard does.
Item {
  id: root

  // Everything this row draws about its Agent (CardModel.build).
  property var card: CardModel.EMPTY
  property var service: null
  property var density: null
  property bool interactive: true
  // The theme palette for the hue effect, and whether the mark may move (on screen).
  property var palette: []
  property bool animate: true
  // "recap", "location" or "" (DensityPolicy.secondLine).
  property string secondLine: ""
  // Height of the row's lines, from DensityPolicy.rowHeight.
  property int baseHeight: 22

  signal tapped()
  signal recapRequested()

  readonly property var t: density || ({ namePx: 12, detailPx: 10, glyphPx: 14, iconPx: 14, iconSourcePx: 28,
    statusWidth: 16, pad: 8, gap: 6, padY: 5, lineGap: 3, lineHeight: 17, secondLineHeight: 13,
    rowGap: 1, dividerAlpha: 0.08 })
  readonly property var fields: card.fields
  readonly property var indicator: card.indicator
  readonly property string attention: card.attention
  readonly property bool focused: card.focused
  readonly property var cacheTimer: fields.cache ? card.cache : null
  readonly property bool recapExpandable: card.recap.expandable
  // The Recap line opens the full Recap in place, as the disclosure does for expand.
  readonly property bool recapInline: secondLine === "recap"
  readonly property bool recapShown: card.recap.shown
  readonly property string iconUrl: fields.kind && service && card.kind !== "" ? service.kindIconUrl(card.kind) : ""
  readonly property var successColor: service ? service.successColor : undefined
  readonly property color statusColor: Tone.color(card.indicator.tone, successColor)
  readonly property color attentionColor: Tone.color(card.attentionTone, successColor)

  implicitHeight: baseHeight + (recapShown ? recapBlock.implicitHeight : 0)

  Rectangle {
    anchors.fill: parent
    radius: Math.min(Style.cornerRadius, 4)
    color: tap.pressed || recapTap.pressed || disclosureTap.pressed ? Style.pressedFillFor(Color.foreground, Color.accent)
      : root.focused ? Style.selectedFillFor(Color.foreground, Color.accent)
      : hover.hovered ? Util.alpha(Color.foreground, 0.06)
      : root.card.highlighted ? Util.alpha(Color.accent, 0.07)
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

    opacity: pulseMotion.running ? MotionPolicy.pulseOpacity(pulseMotion.ms, 0.25) : 1

    Motion {
      id: pulseMotion
      clock: root.service ? root.service.motionClock : null
      running: pulse.visible && root.animate
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
    visible: root.card.showGlyph
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

      rotation: spinMotion.running ? MotionPolicy.spinAngle(spinMotion.ms) : 0

      Motion {
        id: spinMotion
        clock: root.service ? root.service.motionClock : null
        running: root.indicator.motion === "spin" && root.visible && root.card.showGlyph && root.animate
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
    tinted: root.card.kindIconTinted
    letter: root.card.kindGlyph
    sourcePx: root.t.iconSourcePx
    letterPx: root.t.detailPx
    frameRadius: Math.min(Style.cornerRadius, 3)
    stateful: root.card.marksState
    mark: root.card.mark
    toneColor: Tone.color(root.card.mark.tone, root.successColor)
    palette: root.palette
    animate: root.animate && root.visible
    clock: root.service ? root.service.motionClock : null
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
    text: root.card.name
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
    color: Tone.color(root.card.cacheTone, root.successColor)
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
    text: root.secondLine === "recap" ? root.card.recap.text
      : root.secondLine === "location" ? RepoModel.withLocation(root.card.repo.text, root.card.location) : ""
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
      text: root.recapShown ? root.card.recap.text : ""
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
