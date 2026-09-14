import QtQuick
import qs.Commons
import "../../lib/CardPolicy.js" as CardPolicy
import "../../lib/CardModel.js" as CardModel
import "../../lib/MotionPolicy.js" as MotionPolicy
import "../../components"

// One Agent as a Card. Draws the Fields its CardModel card resolved; tones
// become colours here (Tone). The Card's height is its Fields band, plus the
// full Recap below it while that is open in the Card.
Item {
  id: root

  // Everything this Card draws about its Agent (CardModel.build).
  property var card: CardModel.EMPTY
  // For the motion clock, the theme's green and kind icon URLs.
  property var service: null
  property real textScale: 1
  property bool interactive: true
  // The theme palette for the hue effect, and whether the mark may move (on screen).
  property var palette: []
  property bool animate: true
  // Height of the Fields band, from CardPolicy.
  property int baseHeight: CardPolicy.cardHeight(CardPolicy.DEFAULT_PRESET)

  signal tapped()
  signal recapRequested()

  readonly property var fields: card.fields
  readonly property var indicator: card.indicator
  readonly property string attention: card.attention
  readonly property bool focused: card.focused
  readonly property var cacheTimer: fields.cache ? card.cache : null
  readonly property bool recapExpandable: card.recap.expandable
  // An inline Recap under the Fields; a Card without a Recap stays plain.
  readonly property bool recapInline: card.recap.inline
  readonly property bool recapShown: card.recap.shown
  readonly property string iconUrl: fields.kind && service && card.kind !== "" ? service.kindIconUrl(card.kind) : ""
  readonly property var successColor: service ? service.successColor : undefined
  readonly property color statusColor: Tone.color(card.indicator.tone, successColor)
  readonly property int pad: Style.spacing.xxl
  readonly property color attentionColor: Tone.color(card.attentionTone, successColor)

  implicitHeight: baseHeight + (recapShown ? recapBlock.implicitHeight : 0)

  Rectangle {
    anchors.fill: parent
    radius: Style.cornerRadius
    color: tap.pressed
      ? Style.pressedFillFor(Color.foreground, Color.accent)
      : root.focused ? Style.selectedFillFor(Color.foreground, Color.accent)
      : root.card.highlighted ? Util.alpha(Color.accent, 0.08)
      : Style.normalFillFor(Color.foreground, Color.accent)
    border.width: 1
    border.color: root.focused ? Color.accent
      : root.card.highlighted ? Util.alpha(Color.accent, 0.35)
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

    opacity: pulseMotion.running ? MotionPolicy.pulseOpacity(pulseMotion.ms, 0.2) : 1

    Motion {
      id: pulseMotion
      clock: root.service ? root.service.motionClock : null
      running: pulse.visible && root.animate
    }
  }

  // Status glyph at the leading edge: a distinct shape per status, so it reads
  // without colour; it turns while the Agent is working.
  Item {
    id: statusGlyph
    visible: root.card.showGlyph
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

      rotation: spinMotion.running ? MotionPolicy.spinAngle(spinMotion.ms) : 0

      Motion {
        id: spinMotion
        clock: root.service ? root.service.motionClock : null
        running: root.indicator.motion === "spin" && root.visible && root.card.showGlyph && root.animate
      }
    }
  }

  // The Fields band: the Card as it is while no Recap is open in it.
  Item {
    id: band
    anchors { left: parent.left; right: parent.right; top: parent.top }
    height: root.baseHeight
  }

  KindMark {
    id: kindIcon
    visible: root.fields.kind
    anchors { left: statusGlyph.right; leftMargin: statusGlyph.visible ? root.pad : 0; verticalCenter: band.verticalCenter }
    width: visible ? 28 : 0
    height: 28
    iconUrl: root.iconUrl
    tinted: root.card.kindIconTinted
    letter: root.card.kindGlyph
    sourcePx: 56
    letterPx: Math.round(Style.font.title * root.textScale)
    frameRadius: Math.min(Style.cornerRadius, 6)
    stateful: root.card.marksState
    mark: root.card.mark
    toneColor: Tone.color(root.card.mark.tone, root.successColor)
    palette: root.palette
    animate: root.animate && root.visible
    clock: root.service ? root.service.motionClock : null
  }

  Column {
    anchors {
      left: kindIcon.right; leftMargin: root.pad
      right: trailing.left; rightMargin: root.pad
      top: root.recapInline ? band.top : undefined
      topMargin: root.recapInline ? root.pad / 2 : 0
      verticalCenter: root.recapInline ? undefined : band.verticalCenter
    }
    spacing: Style.spacing.xs

    Text {
      width: parent.width
      visible: root.fields.name
      text: root.card.name
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
      text: root.card.location
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
      visible: root.recapInline
      text: root.card.recap.text
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
      color: Tone.color(root.card.cacheTone, root.successColor)
      opacity: root.cacheTimer && root.cacheTimer.level === "cold" ? 0.7 : 1
      font.family: Style.font.family
      font.pixelSize: Math.round(Style.font.title * root.textScale)
      font.bold: root.cacheTimer !== null && root.cacheTimer.level === "critical"
      font.features: { "tnum": 1 }
    }

    // Time left of the ttl, draining; not drawn once the cache is cold.
    Rectangle {
      anchors.right: parent.right
      visible: root.fields.cache && root.cacheTimer !== null && root.cacheTimer.level !== "cold"
      width: 40
      height: 3
      radius: 1.5
      color: Util.alpha(Color.foreground, 0.12)

      Rectangle {
        anchors { left: parent.left; top: parent.top; bottom: parent.bottom }
        width: root.cacheTimer ? Math.round(parent.width * root.cacheTimer.fraction) : 0
        radius: parent.radius
        color: Tone.color(root.card.cacheBarTone, root.successColor)
      }
    }

    // The status word, beside the glyph's colour; dropped by the compact preset.
    Text {
      anchors.right: parent.right
      visible: root.fields.status && root.card.showStatusWord
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
      text: root.recapShown ? root.card.recap.text : ""
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
