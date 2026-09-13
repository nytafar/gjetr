pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Window
import qs.Commons
import "../../lib/CardPolicy.js" as CardPolicy
import "../../lib/DensityPolicy.js" as DensityPolicy
import "../../lib/LayoutPolicy.js" as LayoutPolicy
import "../../lib/ListSyncPolicy.js" as ListSyncPolicy
import "../../lib/StatusPolicy.js" as StatusPolicy
import "../../lib/IndicatorPolicy.js" as IndicatorPolicy
import "../../lib/MotionPolicy.js" as MotionPolicy
import "../../components"

// The Workspace List Module: herdr's workspaces, tabs and panes as a tree that
// expands in place, panes without an Agent included. Presentation only. Rows
// come from the service (WorkspaceTreeModel), expansion is the service's
// session state for this Module, and every tap goes to the service with this
// Module's key and the tapped zone; what it does depends on the Module's tap
// setting.
Item {
  id: root

  property var service: null
  // <layout>#<index>: this Module's settings, Overrides and expansion.
  property string moduleKey: ""
  // "pointer" on a Dock, "touch" on a surface: with the Module's size it picks
  // the density (DensityPolicy), the same as an Agent List's.
  property string input: "touch"

  readonly property var density: DensityPolicy.tokens({ width: width, height: height, input: input,
    setting: moduleState ? moduleState.density : DensityPolicy.DEFAULT_SETTING, module: "workspace-list",
    fonts: { caption: Style.font.caption, body: Style.font.body, title: Style.font.title },
    spacing: { sm: Style.spacing.sm, lg: Style.spacing.lg, xxl: Style.spacing.xxl }, dpr: Screen.devicePixelRatio })
  readonly property bool compact: !density.boxed

  // Checked by type: while a Layout file loads, this key can briefly name a
  // Module of another type.
  readonly property var moduleState: service && service.moduleStates[moduleKey]
    && service.moduleStates[moduleKey].type === "workspace-list" ? service.moduleStates[moduleKey] : null
  readonly property string tapMode: moduleState ? moduleState.tap : "expand"
  readonly property string focusMode: moduleState ? moduleState.focus : "herdr"
  // The kind mark as status indicator (IndicatorPolicy), as on Agent Cards.
  // Workspace rows have no mark, so they keep their glyph with "icon".
  readonly property string indicatorMode: moduleState ? moduleState.indicator : IndicatorPolicy.DEFAULT_MODE
  readonly property string workingEffect: moduleState ? moduleState.workingEffect : IndicatorPolicy.DEFAULT_WORKING_EFFECT
  readonly property bool windowShown: !Window.window || Window.window.visible
  readonly property var rows: service
    ? service.workspaceRows(moduleKey, service.workspaceTree, service.treeExpanded, service.attention) : []
  readonly property int workspaceCount: service && service.workspaceTree ? service.workspaceTree.workspaces.length : 0
  readonly property bool online: !!service && service.herdrOnline
  readonly property bool offline: !!service && service.herdrOffline

  readonly property real textScale: density.textScale
  readonly property int gap: density.gap
  readonly property int pad: density.pad
  readonly property int headerPad: compact ? density.pad + 2 : gap * 2
  readonly property int rowHeight: density.rowHeight
  readonly property int rowGap: density.rowGap
  readonly property int pitch: rowHeight + rowGap
  readonly property int indent: density.indent
  readonly property int chevronWidth: compact && input === "pointer" ? density.lineHeight + density.pad : CardPolicy.MIN_TOUCH_PX
  readonly property int statusSize: compact ? density.statusWidth : 24
  readonly property int iconSize: compact ? density.iconPx : 24

  // Rows are keyed by node in a ListModel updated in place, so a snapshot or
  // an expansion keeps every row, its pulse and the scroll position. Each row
  // finds its data in rowByKey and its place in rowIndex.
  property var rowByKey: ({})
  property var rowIndex: ({})
  property var rowOrder: []

  function syncRows() {
    var map = {}
    var index = {}
    var keys = []
    for (var i = 0; i < rows.length; i++) {
      map[rows[i].key] = rows[i]
      index[rows[i].key] = i
      keys.push(rows[i].key)
    }
    var before = rowOrder
    var y = list.contentY
    var current = []
    for (var j = 0; j < rowModel.count; j++) current.push(rowModel.get(j).nodeKey)
    rowByKey = map
    rowIndex = index
    var steps = ListSyncPolicy.syncSteps(current, keys)
    for (var k = 0; k < steps.length; k++) {
      var step = steps[k]
      if (step.op === "remove") rowModel.remove(step.index, 1)
      else if (step.op === "move") rowModel.move(step.from, step.to, 1)
      else rowModel.insert(step.index, { nodeKey: step.key })
    }
    rowOrder = keys
    // The row at the top of the view stays where it is on screen.
    if (!list.moving && y > 0)
      list.contentY = LayoutPolicy.clampScroll(LayoutPolicy.keepRowScroll(before, keys, pitch, y), keys.length * pitch, list.height)
  }

  function toneColor(tone) {
    if (tone === "success") return service ? service.successColor : Color.accent
    if (tone === "urgent") return Color.urgent
    if (tone === "accent") return Color.accent
    if (tone === "foreground") return Color.foreground
    return Color.muted
  }

  onRowsChanged: syncRows()
  Component.onCompleted: syncRows()

  ListModel {
    id: rowModel
  }

  Item {
    id: header
    anchors { top: parent.top; left: parent.left; right: parent.right }
    height: root.density.headerHeight

    Text {
      anchors {
        left: parent.left; leftMargin: root.headerPad
        right: tapLabel.left; rightMargin: root.gap
        verticalCenter: parent.verticalCenter
      }
      elide: Text.ElideRight
      text: root.workspaceCount === 1 ? "1 workspace" : root.workspaceCount + " workspaces"
      color: Color.foreground
      font.family: Style.font.family
      font.pixelSize: root.density.titlePx
      font.bold: true
    }

    // A narrow list (a Dock) shows its header values without captions.
    Text {
      id: tapLabel
      anchors { right: focusToggle.left; rightMargin: root.headerPad; verticalCenter: parent.verticalCenter }
      text: CardPolicy.headerCaption("tap", root.tapMode, CardPolicy.compactHeader(root.width))
      color: Color.muted
      font.family: Style.font.family
      font.pixelSize: root.density.bodyPx
    }

    // Focus behaviour: herdr only, or also the hosting window.
    Rectangle {
      id: focusToggle
      anchors { top: parent.top; bottom: parent.bottom; right: parent.right }
      width: Math.max(root.density.headerHeight, focusLabel.implicitWidth + root.headerPad * 2)
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
        text: CardPolicy.headerCaption("focus", root.focusMode, CardPolicy.compactHeader(root.width))
        color: root.moduleState && root.moduleState.focusOverridden ? Color.accent : Color.muted
        font.family: Style.font.family
        font.pixelSize: root.density.bodyPx
      }

      TapHandler {
        id: focusTap
        onTapped: if (root.service) root.service.toggleFocusMode(root.moduleKey)
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
    // Offline wins; online to an untested herdr protocol shows a quiet cue.
    visible: !root.online || (root.service ? root.service.herdrMismatchCue !== "" : false)
    height: visible ? implicitHeight : 0
    horizontalAlignment: Text.AlignHCenter
    elide: Text.ElideRight
    text: !root.online ? (root.offline ? "herdr offline, retrying" : "connecting to herdr")
      : (root.service ? root.service.herdrMismatchCue : "")
    color: Color.muted
    font.family: Style.font.family
    font.pixelSize: Math.round(Style.font.body * root.textScale)
  }

  Flickable {
    id: list
    anchors {
      top: banner.bottom; bottom: parent.bottom; left: parent.left; right: parent.right
      topMargin: root.gap; leftMargin: root.compact ? 0 : root.gap
    }
    clip: true
    contentWidth: width
    contentHeight: root.rowOrder.length * root.pitch
    flickableDirection: Flickable.VerticalFlick
    boundsBehavior: Flickable.StopAtBounds
    // The last known tree stays visible while Offline, greyed out.
    opacity: root.online ? 1 : 0.4

    Repeater {
      model: rowModel

      delegate: Item {
        id: rowItem
        required property string nodeKey

        readonly property var row: root.rowByKey[nodeKey] || null
        readonly property bool parentRow: !!row && row.expandable
        // In focus mode a parent row keeps a separate chevron area to expand it.
        readonly property bool chevronZone: root.tapMode === "focus" && parentRow
        readonly property int depth: row ? row.depth : 0
        // Status as glyph, tone and motion (StatusPolicy), the same as on a Card;
        // rows show the glyph without the word.
        readonly property var indicator: StatusPolicy.indicator(row ? row.status : "")
        readonly property color statusColor: root.toneColor(indicator.tone)
        readonly property color attentionColor: row && row.attention === "blocked" ? Color.urgent : Color.accent
        readonly property string iconUrl: row && row.kind !== "" && root.service ? root.service.kindIconUrl(row.kind) : ""
        readonly property var mark: IndicatorPolicy.markFor(row ? row.status : "", row ? row.attention : "", root.workingEffect)
        readonly property bool onScreen: root.windowShown && y + height > list.contentY && y < list.contentY + list.height

        x: depth * root.indent
        y: (root.rowIndex[nodeKey] !== undefined ? root.rowIndex[nodeKey] : 0) * root.pitch
        width: list.width - (root.compact ? 0 : root.gap) - x
        height: root.rowHeight
        visible: row !== null

        Rectangle {
          anchors.fill: parent
          radius: Style.cornerRadius
          color: rowTap.pressed || chevronTap.pressed ? Style.pressedFillFor(Color.foreground, Color.accent)
            : rowItem.row && rowItem.row.focused ? Style.selectedFillFor(Color.foreground, Color.accent)
            : root.compact && rowHover.hovered ? Util.alpha(Color.foreground, 0.06)
            : rowItem.depth === 0 && !root.compact ? Style.normalFillFor(Color.foreground, Color.accent)
            : "transparent"
          // Compact rows have no box: selection and hover are fills only.
          border.width: root.compact ? 0 : 1
          border.color: rowItem.row && rowItem.row.focused ? Util.alpha(Color.accent, rowItem.depth === 0 ? 0.8 : 0.4)
            : Util.alpha(Color.foreground, rowItem.depth === 0 ? 0.1 : 0.06)
        }

        HoverHandler {
          id: rowHover
          enabled: root.compact && root.online
          cursorShape: Qt.PointingHandCursor
        }

        // Attention: the same breathing tint and border as a Card.
        Rectangle {
          id: pulse
          anchors.fill: parent
          radius: Style.cornerRadius
          visible: !!rowItem.row && rowItem.row.attention !== ""
          color: Util.alpha(rowItem.attentionColor, 0.25)
          border.width: 2
          border.color: rowItem.attentionColor

          opacity: pulseMotion.running ? MotionPolicy.pulseOpacity(pulseMotion.ms, 0.2) : 1

          Motion {
            id: pulseMotion
            clock: root.service ? root.service.motionClock : null
            running: pulse.visible && rowItem.onScreen
          }
        }

        Item {
          id: statusGlyph
          visible: IndicatorPolicy.showsGlyph(root.indicatorMode, kindIcon.visible)
          anchors { left: parent.left; leftMargin: root.compact ? root.pad : root.gap; verticalCenter: parent.verticalCenter }
          width: visible ? root.statusSize : 0
          height: root.statusSize

          Text {
            id: glyph
            anchors.centerIn: parent
            text: rowItem.indicator.glyph
            color: rowItem.statusColor
            opacity: rowItem.indicator.opacity
            font.family: Style.font.family
            font.pixelSize: root.compact ? root.density.glyphPx
              : Math.round((rowItem.depth === 0 ? Style.font.title : Style.font.body) * root.textScale * 1.2)
            font.bold: rowItem.indicator.status === "blocked" || rowItem.indicator.status === "done"

            rotation: spinMotion.running ? MotionPolicy.spinAngle(spinMotion.ms) : 0

            Motion {
              id: spinMotion
              clock: root.service ? root.service.motionClock : null
              running: rowItem.indicator.motion === "spin" && rowItem.visible && statusGlyph.visible && rowItem.onScreen
            }
          }
        }

        KindMark {
          id: kindIcon
          visible: rowItem.row !== null && rowItem.row.kind !== "" && rowItem.row.type !== "workspace"
          anchors { left: statusGlyph.right; leftMargin: statusGlyph.visible ? root.gap : 0; verticalCenter: parent.verticalCenter }
          width: visible ? root.iconSize : 0
          height: root.iconSize
          iconUrl: rowItem.iconUrl
          tinted: rowItem.row && root.service ? root.service.kindIconTinted(rowItem.row.kind) : false
          letter: rowItem.row ? CardPolicy.kindGlyph(rowItem.row.kind, rowItem.row.displayKind) : ""
          sourcePx: root.compact ? root.density.iconSourcePx : 48
          letterPx: root.compact ? root.density.detailPx : Math.round(Style.font.body * root.textScale)
          frameRadius: Math.min(Style.cornerRadius, 4)
          stateful: IndicatorPolicy.marksState(root.indicatorMode)
          mark: rowItem.mark
          toneColor: root.toneColor(rowItem.mark.tone)
          palette: root.service ? root.service.indicatorPalette : []
          animate: rowItem.onScreen
          clock: root.service ? root.service.motionClock : null
        }

        Text {
          anchors {
            left: kindIcon.right; leftMargin: kindIcon.visible ? root.pad : (root.compact ? root.gap : 0)
            right: detail.left; rightMargin: root.pad
            verticalCenter: parent.verticalCenter
          }
          text: rowItem.row ? rowItem.row.label : ""
          textFormat: Text.PlainText
          color: Color.foreground
          opacity: rowItem.indicator.textOpacity
          elide: Text.ElideRight
          maximumLineCount: 1
          font.family: Style.font.family
          font.pixelSize: root.compact ? root.density.namePx
            : Math.round((rowItem.depth === 0 ? Style.font.title : Style.font.body) * root.textScale)
          font.bold: rowItem.depth === 0 || (!!rowItem.row && rowItem.row.focused)
        }

        Text {
          id: detail
          anchors {
            right: chevron.visible ? chevron.left : parent.right
            rightMargin: chevron.visible ? root.gap : root.pad
            verticalCenter: parent.verticalCenter
          }
          text: rowItem.row ? rowItem.row.detail : ""
          color: Color.muted
          font.family: Style.font.family
          font.pixelSize: root.compact ? root.density.detailPx : Math.round(Style.font.body * root.textScale)
        }

        // The row area: toggles, or focuses, as the Module's tap mode says.
        Item {
          anchors { left: parent.left; top: parent.top; bottom: parent.bottom; right: rowItem.chevronZone ? chevron.left : parent.right }

          TapHandler {
            id: rowTap
            enabled: root.online
            onTapped: if (root.service && rowItem.row) root.service.tapWorkspaceRow(root.moduleKey, rowItem.row, "row", root.input)
          }
        }

        Item {
          id: chevron
          visible: rowItem.parentRow
          anchors { right: parent.right; top: parent.top; bottom: parent.bottom }
          width: visible ? root.chevronWidth : 0

          Rectangle {
            visible: rowItem.chevronZone
            anchors { left: parent.left; verticalCenter: parent.verticalCenter }
            width: 1
            height: parent.height / 2
            color: Util.alpha(Color.foreground, 0.12)
          }

          Text {
            anchors.centerIn: parent
            text: rowItem.row && rowItem.row.expanded ? "▾" : "▸"
            color: rowItem.chevronZone ? Color.accent : Color.muted
            font.family: Style.font.family
            font.pixelSize: root.compact ? root.density.namePx : Math.round(Style.font.title * root.textScale)
          }

          TapHandler {
            id: chevronTap
            enabled: rowItem.chevronZone && root.online
            onTapped: if (root.service && rowItem.row) root.service.tapWorkspaceRow(root.moduleKey, rowItem.row, "chevron", root.input)
          }
        }
      }
    }
  }

  Text {
    anchors.centerIn: list
    visible: root.online && root.rows.length === 0
    text: "No workspaces"
    color: Color.muted
    font.family: Style.font.family
    font.pixelSize: root.density.titlePx
  }
}
