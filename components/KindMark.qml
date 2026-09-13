import QtQuick
import QtQuick.Effects
import qs.Commons
import "../lib/IndicatorPolicy.js" as IndicatorPolicy
import "../lib/MotionPolicy.js" as MotionPolicy

// An agent kind's mark: its SVG where it has one, else the kind's letter in a
// thin frame. Plain, a brand-colour SVG (Omarchy's) draws as itself; a
// one-colour SVG (`tinted`, gjetr's assets/kinds, black as Qt draws
// currentColor) and the letter draw in `plainColor`. Stateful (a Module's
// indicator = "icon" or "both"), every mark is a mask filled with its Agent's
// status from IndicatorPolicy: the tone's colour, a moving gradient, hue, glow
// or highlight band while working, a flash while blocked, a pulse while done in
// Attention, faded when idle or unknown.
//
// A mask that already exists goes blank when what it draws changes (its layer
// turned on, or its image appearing or going; Qt 6.11). So the masked drawing
// is rebuilt whenever its image, letter or sizes change: it is the one delegate
// of a Repeater keyed by them, and draws either the image or the letter, never
// both. A tinted mark is the same mask over a still `plainColor` fill. A plain
// brand-colour or letter mark has no layer or effect at all.
//
// Breathe and the blocked flash glow, which takes MultiEffect's blur over a
// still fill. Every other mask is shaders/kind-fill.frag, whose sweep, shimmer
// and hue are uniforms: an effect whose source moves re-renders that source and
// asks for a second frame after every tick, doubling what a moving mark costs.
// Which of the two draws a mark is part of the Repeater's key.
//
// One phase drives every motion, read from the service's MotionClock (`clock`,
// 20 frames a second). It moves only while the mark is stateful, has a motion,
// is visible and `animate` (on screen, its window shown), and is 0 otherwise;
// IndicatorPolicy.frame is neutral without a motion, so no colour or glow is
// left behind when the status changes.
Item {
  id: root

  property string iconUrl: ""
  property string letter: ""
  property int sourcePx: 56
  property int letterPx: 12
  property real frameRadius: 4
  property color plainColor: Color.muted
  property real plainOpacity: 1
  // The SVG is one colour, drawn in plainColor (or the status) rather than as itself.
  property bool tinted: false

  property bool stateful: false
  property var mark: IndicatorPolicy.markFor("unknown", "", "")
  property color toneColor: Color.muted
  // Theme colours for the hue effect, in order.
  property var palette: []
  property bool animate: true
  // The service's MotionClock.
  property var clock: null

  readonly property string motion: stateful && mark ? mark.motion : ""
  readonly property bool moving: motion !== "" && animate && visible && width > 0
  readonly property real phase: moving && mark ? MotionPolicy.phase(phaseMotion.ms, mark.period) : 0
  readonly property var f: IndicatorPolicy.frame(moving ? motion : "", phase)
  readonly property color highlight: Qt.lighter(toneColor, IndicatorPolicy.SWEEP_HIGHLIGHT)
  // The palette as colour components, read when it changes rather than on
  // every frame of the hue cycle.
  readonly property var paletteColors: (palette || []).map(function(entry) {
    var c = typeof entry === "string" ? Qt.color(entry) : entry
    return { r: c.r, g: c.g, b: c.b, a: c.a }
  })
  readonly property color fillColor: {
    if (motion !== "hue") return toneColor
    var c = IndicatorPolicy.hueColor(paletteColors, phase)
    return c ? Qt.rgba(c.r, c.g, c.b, c.a) : toneColor
  }
  // Drawn as a mask: stateful, or a one-colour SVG.
  readonly property bool masked: stateful || (tinted && iconUrl !== "")
  // Whether the kind's image has loaded, from an image outside any mask.
  readonly property bool imageReady: probe.status === Image.Ready
  // What a mask draws; a change rebuilds it.
  readonly property string maskKey: [iconUrl, imageReady, letter, sourcePx, letterPx].join("|")
  // Room around the mark inside the mask and the fill for the glow. The effect's
  // own padding scales the mask apart from the fill, so it stays off and both
  // carry this margin instead.
  readonly property int glowPad: Math.max(3, Math.round(Math.min(width, height) * 0.4))
  // Drawn with MultiEffect for its glow; otherwise with the kind-fill shader.
  readonly property bool glow: motion === "breathe" || motion === "flash"

  Motion {
    id: phaseMotion
    clock: root.clock
    running: root.moving
  }

  Image {
    id: probe
    visible: false
    source: root.masked ? root.iconUrl : ""
    sourceSize.width: root.sourcePx
    sourceSize.height: root.sourcePx
  }

  // The mark as itself.
  Loader {
    anchors.fill: parent
    active: !root.masked

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

  // The mark as a mask over its status fill (plainColor when not stateful),
  // rebuilt when maskKey changes or the mark starts or stops glowing.
  Repeater {
    model: root.masked ? [root.maskKey + "|" + root.glow] : []

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

      // Breathe and flash: the status colour, brightened and glowing.
      Loader {
        anchors.fill: parent
        active: root.glow

        sourceComponent: Item {
          Rectangle {
            id: fill
            anchors.fill: parent
            visible: false
            color: root.fillColor
          }

          MultiEffect {
            anchors.fill: parent
            source: fill
            maskEnabled: true
            maskSource: shape
            autoPaddingEnabled: false
            brightness: root.f.brightness
            shadowEnabled: true
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

      // Everything else: the colour, the sweep gradient or the shimmer band,
      // as uniforms of shaders/kind-fill.frag over the mark.
      ShaderEffect {
        id: kindFill
        anchors.fill: parent
        visible: !root.glow
        property var mask: shape
        property color tone: root.stateful ? root.fillColor : root.plainColor
        property color highlight: root.highlight
        property real sweep: root.motion === "sweep" ? root.f.sweep : -1
        property real band: root.motion === "shimmer" ? root.f.band : -1
        property real pad: root.glowPad
        property real markWidth: root.width
        property real boxWidth: kindFill.width
        property real boxHeight: kindFill.height
        fragmentShader: Qt.resolvedUrl("../shaders/kind-fill.frag.qsb")
        opacity: root.stateful ? (root.mark ? root.mark.opacity : 1) * root.f.opacity : root.plainOpacity
      }
    }
  }
}
