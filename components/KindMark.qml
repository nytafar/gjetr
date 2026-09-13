import QtQuick
import QtQuick.Effects
import qs.Commons
import "../lib/IndicatorPolicy.js" as IndicatorPolicy

// An agent kind's mark: Omarchy's SVG where it ships one, else the kind's
// letter in a thin frame. Plain, it draws as itself, the letter in
// `plainColor`. Stateful (a Module's indicator = "icon" or "both"), the mark is
// a mask filled with its Agent's status from IndicatorPolicy: the tone's colour,
// a moving gradient, hue, glow or highlight band while working, a flash while
// blocked, a pulse while done in Attention, faded when idle or unknown.
//
// A mask that already exists goes blank when what it draws changes (its layer
// turned on, or its image appearing or going; Qt 6.11). So the stateful drawing
// is rebuilt whenever its image, letter or sizes change: it is the one delegate
// of a Repeater keyed by them, and draws either the image or the letter, never
// both. A plain mark has no layer or effect at all.
//
// One phase animation drives every motion. It runs only while the mark is
// stateful, has a motion, is visible and `animate` (on screen, its window
// shown), and resets when it stops; IndicatorPolicy.frame is neutral without a
// motion, so no colour or glow is left behind when the status changes.
Item {
  id: root

  property string iconUrl: ""
  property string letter: ""
  property int sourcePx: 56
  property int letterPx: 12
  property real frameRadius: 4
  property color plainColor: Color.muted
  property real plainOpacity: 1

  property bool stateful: false
  property var mark: IndicatorPolicy.markFor("unknown", "", "")
  property color toneColor: Color.muted
  // Theme colours for the hue effect, in order.
  property var palette: []
  property bool animate: true

  readonly property string motion: stateful && mark ? mark.motion : ""
  readonly property bool moving: motion !== "" && animate && visible && width > 0
  property real phase: 0
  readonly property var f: IndicatorPolicy.frame(moving ? motion : "", phase)
  readonly property color highlight: Qt.lighter(toneColor, IndicatorPolicy.SWEEP_HIGHLIGHT)
  readonly property color fillColor: {
    if (motion !== "hue" || !palette || palette.length < 2) return toneColor
    var step = IndicatorPolicy.hueStep(palette.length, phase)
    return Qt.tint(palette[step.from], Util.alpha(palette[step.to], step.t))
  }
  // Whether the kind's image has loaded, from an image outside any mask.
  readonly property bool imageReady: probe.status === Image.Ready
  // What a stateful mask draws; a change rebuilds it.
  readonly property string maskKey: [iconUrl, imageReady, letter, sourcePx, letterPx].join("|")
  // Room around the mark inside the mask and the fill for the glow. The effect's
  // own padding scales the mask apart from the fill, so it stays off and both
  // carry this margin instead.
  readonly property int glowPad: Math.max(3, Math.round(Math.min(width, height) * 0.4))

  NumberAnimation on phase {
    id: phaseAnimation
    running: root.moving
    from: 0
    to: 1
    duration: Math.max(1, root.mark ? root.mark.period : 1)
    loops: Animation.Infinite
    onRunningChanged: if (!running) root.phase = 0
  }

  onMotionChanged: if (phaseAnimation.running) phaseAnimation.restart()

  Image {
    id: probe
    visible: false
    source: root.stateful ? root.iconUrl : ""
    sourceSize.width: root.sourcePx
    sourceSize.height: root.sourcePx
  }

  // The mark as itself.
  Loader {
    anchors.fill: parent
    active: !root.stateful

    sourceComponent: Item {
      opacity: root.plainOpacity

      Image {
        id: plainImage
        anchors.fill: parent
        source: root.iconUrl
        sourceSize.width: root.sourcePx
        sourceSize.height: root.sourcePx
        fillMode: Image.PreserveAspectFit
        smooth: true
        visible: status === Image.Ready
      }

      Rectangle {
        anchors.fill: parent
        visible: plainImage.status !== Image.Ready
        color: "transparent"
        radius: root.frameRadius
        border.width: 1
        border.color: root.plainColor
      }

      Text {
        anchors.centerIn: parent
        visible: plainImage.status !== Image.Ready
        text: root.letter
        color: root.plainColor
        font.family: Style.font.family
        font.pixelSize: root.letterPx
        font.bold: true
      }
    }
  }

  // The mark as a mask over its status fill, rebuilt when maskKey changes.
  Repeater {
    model: root.stateful ? [root.maskKey] : []

    delegate: Item {
      anchors.fill: parent
      anchors.margins: -root.glowPad

      Item {
        id: shape
        anchors.fill: parent
        visible: false
        layer.enabled: true

        Image {
          anchors.fill: parent
          anchors.margins: root.glowPad
          visible: root.imageReady
          source: root.imageReady ? root.iconUrl : ""
          sourceSize.width: root.sourcePx
          sourceSize.height: root.sourcePx
          fillMode: Image.PreserveAspectFit
          smooth: true
        }

        Rectangle {
          anchors.fill: parent
          anchors.margins: root.glowPad
          visible: !root.imageReady
          color: "transparent"
          radius: root.frameRadius
          border.width: 1
          border.color: "white"
        }

        Text {
          anchors.centerIn: parent
          visible: !root.imageReady
          text: root.letter
          color: "white"
          font.family: Style.font.family
          font.pixelSize: root.letterPx
          font.bold: true
        }
      }

      // What fills the mask: the status colour, and the sweep gradient or the
      // shimmer band over it.
      Item {
        id: fill
        anchors.fill: parent
        visible: false
        clip: true

        Rectangle {
          anchors.fill: parent
          color: root.fillColor
        }

        // The sweep and the band cross the mark itself, inside the glow margin.
        Rectangle {
          visible: root.motion === "sweep"
          width: root.width * 2
          height: parent.height
          x: root.glowPad - root.width * (1 - root.f.sweep)
          gradient: Gradient {
            orientation: Gradient.Horizontal
            GradientStop { position: 0; color: root.toneColor }
            GradientStop { position: 0.25; color: root.highlight }
            GradientStop { position: 0.5; color: root.toneColor }
            GradientStop { position: 0.75; color: root.highlight }
            GradientStop { position: 1; color: root.toneColor }
          }
        }

        // Visible for the whole motion and parked outside while it rests: an
        // effect source whose children turn visible or hidden keeps its old
        // texture.
        Rectangle {
          visible: root.motion === "shimmer"
          width: Math.max(2, root.width * 0.4)
          height: parent.height * 1.6
          y: -parent.height * 0.3
          x: root.f.band < 0 ? -width * 3 : root.glowPad - width + (root.width + width) * root.f.band
          rotation: 20
          gradient: Gradient {
            orientation: Gradient.Horizontal
            GradientStop { position: 0; color: "transparent" }
            GradientStop { position: 0.5; color: Qt.rgba(1, 1, 1, 0.9) }
            GradientStop { position: 1; color: "transparent" }
          }
        }
      }

      MultiEffect {
        anchors.fill: parent
        source: fill
        maskEnabled: true
        maskSource: shape
        autoPaddingEnabled: false
        brightness: root.f.brightness
        shadowEnabled: root.motion === "breathe" || root.motion === "flash"
        shadowColor: root.toneColor
        shadowBlur: 0.6
        shadowOpacity: Math.min(1, root.f.glow)
        shadowHorizontalOffset: 0
        shadowVerticalOffset: 0
        blurMax: Math.max(4, Math.round(root.glowPad * 1.2))
        opacity: (root.mark ? root.mark.opacity : 1) * root.f.opacity
      }
    }
  }
}
