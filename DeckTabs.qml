pragma ComponentBehavior: Bound

import QtQuick
import qs.Commons
import "lib/CardPolicy.js" as CardPolicy

// The Deck's tab bar on one short edge. Renders only: Layout names, the active
// one, and Attention badges come from the surface; a tap reports the name.
Item {
  id: root

  property string edge: "left"
  property var names: []
  property string active: ""
  property var badges: []
  property real textScale: 1.25

  signal selected(string name)

  readonly property bool vertical: edge === "left" || edge === "right"
  readonly property real length: vertical ? height : width
  readonly property real tabLength: names.length > 0
    ? Math.max(CardPolicy.MIN_TOUCH_PX, Math.min(220, Math.floor(length / names.length))) : 0

  // Divider on the content side.
  Rectangle {
    color: Util.alpha(Color.foreground, 0.12)
    x: root.edge === "left" ? root.width - 1 : 0
    y: root.edge === "top" ? root.height - 1 : 0
    width: root.vertical ? 1 : root.width
    height: root.vertical ? root.height : 1
  }

  Grid {
    columns: root.vertical ? 1 : Math.max(1, root.names.length)

    Repeater {
      model: root.names

      Item {
        id: tab
        required property var modelData
        required property int index

        readonly property bool current: modelData === root.active
        readonly property int badge: root.badges && root.badges.length > index ? root.badges[index] : 0

        width: root.vertical ? root.width : root.tabLength
        height: root.vertical ? root.tabLength : root.height

        Rectangle {
          anchors.fill: parent
          color: tabTap.pressed ? Style.pressedFillFor(Color.foreground, Color.accent)
            : tab.current ? Style.selectedFillFor(Color.foreground, Color.accent) : "transparent"
        }

        // Active marker on the content side.
        Rectangle {
          visible: tab.current
          color: Color.accent
          x: root.edge === "left" ? parent.width - width : 0
          y: root.edge === "top" ? parent.height - height : 0
          width: root.vertical ? 3 : parent.width
          height: root.vertical ? parent.height : 3
        }

        Text {
          anchors.centerIn: parent
          // Side tabs read along the edge.
          rotation: root.edge === "left" ? -90 : root.edge === "right" ? 90 : 0
          width: root.vertical ? tab.height - 8 : tab.width - 8
          horizontalAlignment: Text.AlignHCenter
          elide: Text.ElideRight
          text: tab.modelData
          color: tab.current ? Color.foreground : Color.muted
          font.family: Style.font.family
          font.pixelSize: Math.round(Style.font.body * root.textScale)
          font.bold: tab.current
        }

        // Attention badge: count of Agents in Attention, on tabs not shown.
        Rectangle {
          visible: tab.badge > 0
          width: Math.max(22, badgeText.implicitWidth + 10)
          height: 22
          radius: 11
          color: Color.urgent
          anchors { top: parent.top; right: parent.right; margins: 6 }

          Text {
            id: badgeText
            anchors.centerIn: parent
            text: tab.badge > 99 ? "99+" : String(tab.badge)
            color: Color.background
            font.family: Style.font.family
            font.pixelSize: Math.round(Style.font.caption * root.textScale)
            font.bold: true
          }
        }

        TapHandler {
          id: tabTap
          onTapped: root.selected(tab.modelData)
        }
      }
    }
  }
}
