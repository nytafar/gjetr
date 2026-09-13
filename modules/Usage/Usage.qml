pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Window
import qs.Commons
import "../../lib/CardPolicy.js" as CardPolicy
import "../../lib/DensityPolicy.js" as DensityPolicy
import "../../lib/UsageModel.js" as UsageModel

// The Usage Module: each AI provider's limits and usage, from the service's
// usage Source in UsageModel's provider-neutral shape. Presentation only.
// Which items show, and for which providers, is this Module's Config; a
// header tap asks the service for a refresh. Providers that are not ready,
// and numbers that are stale, are shown quietly rather than hidden.
Item {
  id: root

  property var service: null
  // <layout>#<index>: this Module's settings.
  property string moduleKey: ""
  // "pointer" on a Dock, "touch" on a surface: with the Module's size it picks
  // the density (DensityPolicy). Compact draws each limit as one line.
  property string input: "touch"

  readonly property var density: DensityPolicy.tokens({ width: width, height: height, input: input,
    fonts: { caption: Style.font.caption, body: Style.font.body, title: Style.font.title },
    spacing: { sm: Style.spacing.sm, lg: Style.spacing.lg, xxl: Style.spacing.xxl }, dpr: Screen.devicePixelRatio })
  readonly property bool compact: !density.boxed
  readonly property bool showsLimits: show.indexOf("limits") >= 0
  // Compact limit lines across every shown provider (UsageModel.compactLimits).
  readonly property var compactLines: compact && showsLimits ? UsageModel.compactLimits(providers, now, refreshSeconds) : []

  // Checked by type: while a Layout file loads, this key can briefly name a
  // Module of another type.
  readonly property var moduleState: service && service.moduleStates[moduleKey]
    && service.moduleStates[moduleKey].type === "usage" ? service.moduleStates[moduleKey] : null
  readonly property var show: moduleState ? moduleState.show : UsageModel.DEFAULT_SHOW
  readonly property var providers: service
    ? UsageModel.visibleProviders(service.usageProviders, moduleState ? moduleState.providers : []) : []
  readonly property double now: service ? service.usageNowMs : Date.now()
  readonly property int refreshSeconds: service ? service.usageRefreshSeconds : UsageModel.DEFAULT_REFRESH_SECONDS
  readonly property bool refreshing: !!service && service.usageRefreshing
  readonly property double newestUpdate: {
    var best = 0
    for (var i = 0; i < providers.length; i++) best = Math.max(best, providers[i].updatedAtMs || 0)
    return best
  }

  readonly property real textScale: density.textScale
  readonly property int gap: density.gap
  readonly property int pad: density.pad
  readonly property int headerPad: compact ? density.pad + 2 : gap * 2
  readonly property int captionPx: density.captionPx
  readonly property int bodyPx: density.bodyPx
  readonly property int titlePx: density.titlePx
  // A compact line: code, meter, percent, and the reset time when there is room.
  readonly property int lineHeight: density.lineHeight + 3
  readonly property bool resetShown: width >= 240

  // Meter colours: theme tokens only, loudest at the highest share used.
  function levelColor(level) {
    if (level === "critical") return Color.urgent
    if (level === "warn") return Color.accent
    return Color.foreground
  }

  Item {
    id: header
    anchors { top: parent.top; left: parent.left; right: parent.right }
    height: root.density.headerHeight

    Rectangle {
      anchors.fill: parent
      color: headerTap.pressed ? Style.pressedFillFor(Color.foreground, Color.accent) : "transparent"
    }

    Text {
      anchors { left: parent.left; leftMargin: root.headerPad; verticalCenter: parent.verticalCenter }
      text: "usage"
      color: Color.foreground
      font.family: Style.font.family
      font.pixelSize: root.titlePx
      font.bold: true
    }

    Text {
      anchors { right: parent.right; rightMargin: root.headerPad; verticalCenter: parent.verticalCenter }
      // Compact: the bare age of the newest record.
      text: root.compact
        ? (root.refreshing ? "↻" : root.newestUpdate > 0 ? UsageModel.shortDuration(root.now - root.newestUpdate) : "")
        : root.refreshing ? "refreshing" : UsageModel.ageLabel(root.newestUpdate, root.now)
      color: Color.muted
      font.family: Style.font.family
      font.pixelSize: root.bodyPx
    }

    // A tap refreshes now; a run already going is not started twice.
    TapHandler {
      id: headerTap
      onTapped: if (root.service) root.service.refreshUsage()
    }

    Rectangle {
      anchors { left: parent.left; right: parent.right; bottom: parent.bottom }
      height: 1
      color: Util.alpha(Color.foreground, 0.12)
    }
  }

  Flickable {
    id: body
    anchors { top: header.bottom; bottom: parent.bottom; left: parent.left; right: parent.right }
    clip: true
    contentWidth: width
    contentHeight: sections.implicitHeight + root.gap * 2
    flickableDirection: Flickable.VerticalFlick
    boundsBehavior: Flickable.StopAtBounds

    Column {
      id: sections
      x: root.compact ? root.headerPad : root.gap * 2
      y: root.compact ? root.gap * 2 : root.gap * 2
      width: body.width - x * 2
      spacing: root.gap * 3

      // Compact limits: one line per limit, providers one after another. The
      // provider's mark starts its first line; the meter shows the share used
      // in its level colour with a tick where an even pace would be (accent
      // when usage runs ahead of it); then the percent and the time to reset.
      Column {
        id: compactLimits
        visible: root.compactLines.length > 0
        width: sections.width

        TextMetrics {
          id: codeMetrics
          font.family: Style.font.family
          font.pixelSize: root.captionPx + 1
          text: "F14d"
        }

        TextMetrics {
          id: percentMetrics
          font.family: Style.font.family
          font.pixelSize: root.bodyPx
          font.bold: true
          text: "100"
        }

        TextMetrics {
          id: resetMetrics
          font.family: Style.font.family
          font.pixelSize: root.captionPx
          text: "30d"
        }

        Repeater {
          model: root.compactLines

          delegate: Item {
            id: line
            required property var modelData
            required property int index

            readonly property var entry: modelData
            readonly property string iconUrl: root.service ? root.service.kindIconUrl(entry.providerId) : ""
            // Space above a provider's first line, after the one before it.
            readonly property int lead: entry.first && index > 0 ? root.gap * 2 : 0

            width: compactLimits.width
            height: root.lineHeight + lead
            opacity: entry.stale ? 0.5 : 1

            Item {
              id: row
              anchors { left: parent.left; right: parent.right; bottom: parent.bottom }
              height: root.lineHeight

              Item {
                id: mark
                anchors { left: parent.left; verticalCenter: parent.verticalCenter }
                width: root.density.iconPx
                height: root.density.iconPx

                Image {
                  id: markImage
                  anchors.fill: parent
                  visible: line.entry.first && status === Image.Ready
                  source: line.entry.first ? line.iconUrl : ""
                  sourceSize.width: root.density.iconSourcePx
                  sourceSize.height: root.density.iconSourcePx
                  fillMode: Image.PreserveAspectFit
                  smooth: true
                }

                Text {
                  anchors.centerIn: parent
                  visible: line.entry.first && markImage.status !== Image.Ready
                  text: line.entry.mark
                  color: Color.muted
                  font.family: Style.font.family
                  font.pixelSize: root.captionPx
                  font.bold: true
                }
              }

              // A provider that is not ready, or reports no limits: one quiet line.
              Text {
                visible: line.entry.kind === "status"
                anchors { left: mark.right; leftMargin: root.pad; right: parent.right; verticalCenter: parent.verticalCenter }
                text: line.entry.text
                textFormat: Text.PlainText
                elide: Text.ElideRight
                color: Color.muted
                font.family: Style.font.family
                font.pixelSize: root.captionPx
              }

              Text {
                id: code
                visible: line.entry.kind === "limit"
                anchors { left: mark.right; leftMargin: root.pad; verticalCenter: parent.verticalCenter }
                width: Math.ceil(codeMetrics.advanceWidth)
                text: line.entry.code
                color: Color.muted
                font.family: Style.font.family
                font.pixelSize: root.captionPx + 1
              }

              Item {
                id: meter
                visible: line.entry.kind === "limit"
                anchors {
                  left: code.right; leftMargin: root.pad
                  right: percent.left; rightMargin: root.pad
                  verticalCenter: parent.verticalCenter
                }
                height: Math.max(8, root.captionPx)

                Rectangle {
                  anchors { left: parent.left; right: parent.right; verticalCenter: parent.verticalCenter }
                  height: 4
                  radius: 2
                  color: Util.alpha(Color.foreground, 0.14)
                }

                Rectangle {
                  anchors { left: parent.left; verticalCenter: parent.verticalCenter }
                  width: Math.round(parent.width * Math.max(0, Math.min(1, line.entry.fraction)))
                  height: 4
                  radius: 2
                  color: root.levelColor(line.entry.level)
                }

                // Where usage would be at an even pace through the window.
                Rectangle {
                  visible: line.entry.elapsed >= 0
                  x: Math.round((parent.width - width) * line.entry.elapsed)
                  anchors.verticalCenter: parent.verticalCenter
                  width: 2
                  height: parent.height
                  radius: 1
                  color: line.entry.pace === "ahead" ? Color.accent : Util.alpha(Color.foreground, 0.5)
                }
              }

              Text {
                id: percent
                visible: line.entry.kind === "limit"
                anchors { right: reset.left; rightMargin: reset.visible ? root.pad : 0; verticalCenter: parent.verticalCenter }
                width: Math.ceil(percentMetrics.advanceWidth)
                horizontalAlignment: Text.AlignRight
                text: line.entry.percent
                color: root.levelColor(line.entry.level)
                font.family: Style.font.family
                font.pixelSize: root.bodyPx
                font.bold: line.entry.level !== "ok"
                font.features: { "tnum": 1 }
              }

              Text {
                id: reset
                visible: line.entry.kind === "limit" && root.resetShown
                anchors { right: parent.right; verticalCenter: parent.verticalCenter }
                width: visible ? Math.ceil(resetMetrics.advanceWidth) : 0
                horizontalAlignment: Text.AlignRight
                text: line.entry.reset
                color: Color.muted
                opacity: 0.8
                font.family: Style.font.family
                font.pixelSize: root.captionPx
                font.features: { "tnum": 1 }
              }
            }

            // With the mouse, the full label and reset time on hover.
            HoverHandler {
              id: lineHover
            }

            Rectangle {
              visible: lineHover.hovered && line.entry.kind === "limit"
              z: 5
              // Above the line, except the first, which the list would clip.
              anchors.right: parent.right
              y: line.index === 0 ? line.height : -height
              width: hoverText.implicitWidth + root.pad * 2
              height: hoverText.implicitHeight + root.gap
              radius: Math.min(Style.cornerRadius, 4)
              color: Color.background
              border.width: 1
              border.color: Util.alpha(Color.foreground, 0.2)

              Text {
                id: hoverText
                anchors.centerIn: parent
                text: line.entry.label + "  " + UsageModel.formatPercent(line.entry.fraction)
                  + (line.entry.resetsAtMs > 0 ? "  ·  " + UsageModel.resetLabel(line.entry.resetsAtMs, root.now) : "")
                textFormat: Text.PlainText
                color: Color.foreground
                font.family: Style.font.family
                font.pixelSize: root.captionPx
              }
            }
          }
        }
      }

      Repeater {
        model: root.providers

        delegate: Column {
          id: section
          required property var modelData

          readonly property var provider: modelData
          readonly property bool stale: provider.ready && UsageModel.isStale(provider.updatedAtMs, root.now, root.refreshSeconds)
          // Compact draws limits as lines above, so a section keeps only the rest.
          readonly property var items: root.compact ? root.show.filter(function(name) { return name !== "limits" }) : root.show

          visible: !root.compact || items.length > 0
          width: sections.width
          spacing: root.gap

          Item {
            width: section.width
            height: nameText.implicitHeight

            Text {
              id: nameText
              text: section.provider.name
              textFormat: Text.PlainText
              color: section.provider.ready ? Color.foreground : Color.muted
              font.family: Style.font.family
              font.pixelSize: root.titlePx
              font.bold: true
            }

            Text {
              anchors { left: nameText.right; leftMargin: root.pad; baseline: nameText.baseline; right: staleText.left; rightMargin: root.gap }
              text: section.provider.tier
              textFormat: Text.PlainText
              color: Color.muted
              elide: Text.ElideRight
              font.family: Style.font.family
              font.pixelSize: root.bodyPx
            }

            Text {
              id: staleText
              anchors { right: parent.right; baseline: nameText.baseline }
              text: section.stale ? (UsageModel.ageLabel(section.provider.updatedAtMs, root.now) || "no update time") : ""
              color: Color.muted
              font.family: Style.font.family
              font.pixelSize: root.captionPx
            }
          }

          Text {
            visible: !section.provider.ready && !(root.compact && root.showsLimits)
            width: section.width
            text: section.provider.statusText !== "" ? section.provider.statusText : "not ready"
            textFormat: Text.PlainText
            wrapMode: Text.WordWrap
            color: Color.muted
            font.family: Style.font.family
            font.pixelSize: root.bodyPx
          }

          Repeater {
            model: section.provider.ready ? section.items : []

            delegate: Column {
              id: item
              required property string modelData

              width: section.width
              spacing: root.gap

              // limits: a meter per window, with percent and time to reset.
              Column {
                visible: item.modelData === "limits"
                width: item.width
                spacing: root.gap

                Text {
                  visible: section.provider.limits.length === 0
                  text: "no limits reported"
                  color: Color.muted
                  font.family: Style.font.family
                  font.pixelSize: root.bodyPx
                }

                Repeater {
                  model: item.modelData === "limits" ? section.provider.limits : []

                  delegate: Column {
                    id: limit
                    required property var modelData

                    readonly property string level: UsageModel.limitLevel(modelData.fraction)

                    width: item.width
                    spacing: Style.spacing.sm

                    Item {
                      width: limit.width
                      height: limitLabel.implicitHeight

                      Text {
                        id: limitLabel
                        anchors { left: parent.left; right: percentText.left; rightMargin: root.gap }
                        text: limit.modelData.label
                        textFormat: Text.PlainText
                        elide: Text.ElideRight
                        color: Color.foreground
                        font.family: Style.font.family
                        font.pixelSize: root.bodyPx
                      }

                      Text {
                        id: percentText
                        anchors.right: parent.right
                        text: UsageModel.formatPercent(limit.modelData.fraction)
                        color: root.levelColor(limit.level)
                        font.family: Style.font.family
                        font.pixelSize: root.bodyPx
                        font.bold: limit.level !== "ok"
                        font.features: { "tnum": 1 }
                      }
                    }

                    Rectangle {
                      width: limit.width
                      height: 8
                      radius: 4
                      color: Util.alpha(Color.foreground, 0.12)

                      Rectangle {
                        width: Math.round(parent.width * Math.max(0, Math.min(1, limit.modelData.fraction)))
                        height: parent.height
                        radius: parent.radius
                        color: root.levelColor(limit.level)
                      }
                    }

                    Text {
                      width: limit.width
                      horizontalAlignment: Text.AlignRight
                      visible: text !== ""
                      text: UsageModel.resetLabel(limit.modelData.resetsAtMs, root.now)
                      color: Color.muted
                      font.family: Style.font.family
                      font.pixelSize: root.captionPx
                    }
                  }
                }
              }

              // today: tokens, prompts and sessions.
              Column {
                visible: item.modelData === "today"
                width: item.width
                spacing: Style.spacing.xs

                Text {
                  text: "today"
                  color: Color.muted
                  font.family: Style.font.family
                  font.pixelSize: root.captionPx
                }

                Text {
                  width: item.width
                  wrapMode: Text.WordWrap
                  text: {
                    var today = section.provider.today
                    var parts = [UsageModel.formatTokens(today.tokens) + " tokens"]
                    if (today.hasPrompts) parts.push(today.prompts + (today.prompts === 1 ? " prompt" : " prompts"))
                    parts.push(today.sessions + (today.sessions === 1 ? " session" : " sessions"))
                    return parts.join("  ·  ")
                  }
                  color: Color.foreground
                  font.family: Style.font.family
                  font.pixelSize: root.bodyPx
                }
              }

              // recent_days: tokens per day as a small bar chart, today last.
              Column {
                id: recent
                visible: item.modelData === "recent_days"
                width: item.width
                spacing: Style.spacing.xs

                readonly property var bars: item.modelData === "recent_days" ? UsageModel.dayBars(section.provider.recentDays, 7) : []
                readonly property int barGap: 6
                readonly property int chartHeight: 44

                Item {
                  width: recent.width
                  height: recentTitle.implicitHeight

                  Text {
                    id: recentTitle
                    text: "last " + recent.bars.length + " days"
                    color: Color.muted
                    font.family: Style.font.family
                    font.pixelSize: root.captionPx
                  }

                  Text {
                    anchors.right: parent.right
                    text: {
                      var peak = 0
                      for (var i = 0; i < recent.bars.length; i++) peak = Math.max(peak, recent.bars[i].tokens)
                      return peak > 0 ? "peak " + UsageModel.formatTokens(peak) : ""
                    }
                    color: Color.muted
                    font.family: Style.font.family
                    font.pixelSize: root.captionPx
                  }
                }

                Text {
                  visible: recent.bars.length === 0
                  text: "no daily usage"
                  color: Color.muted
                  font.family: Style.font.family
                  font.pixelSize: root.bodyPx
                }

                Row {
                  visible: recent.bars.length > 0
                  spacing: recent.barGap

                  Repeater {
                    model: recent.bars

                    delegate: Item {
                      id: bar
                      required property var modelData
                      required property int index

                      width: Math.max(8, Math.floor((recent.width - recent.barGap * 6) / 7))
                      height: recent.chartHeight + dayLabel.implicitHeight + 2

                      Rectangle {
                        anchors { left: parent.left; right: parent.right; bottom: dayLabel.top; bottomMargin: 2 }
                        height: Math.max(2, Math.round(recent.chartHeight * bar.modelData.fraction))
                        radius: 2
                        color: bar.index === recent.bars.length - 1 ? Color.accent : Util.alpha(Color.foreground, 0.45)
                      }

                      Text {
                        id: dayLabel
                        anchors { bottom: parent.bottom; horizontalCenter: parent.horizontalCenter }
                        text: bar.modelData.label
                        color: Color.muted
                        font.family: Style.font.family
                        font.pixelSize: root.captionPx
                      }
                    }
                  }
                }
              }

              // models: today's tokens by model, largest first.
              Column {
                visible: item.modelData === "models"
                width: item.width
                spacing: Style.spacing.xs

                Text {
                  text: "today by model"
                  color: Color.muted
                  font.family: Style.font.family
                  font.pixelSize: root.captionPx
                }

                Text {
                  visible: section.provider.models.length === 0
                  text: "no model usage today"
                  color: Color.muted
                  font.family: Style.font.family
                  font.pixelSize: root.bodyPx
                }

                Repeater {
                  model: item.modelData === "models" ? section.provider.models.slice(0, 5) : []

                  delegate: Item {
                    id: modelRow
                    required property var modelData

                    width: item.width
                    height: modelName.implicitHeight

                    Text {
                      id: modelName
                      anchors { left: parent.left; right: modelTokens.left; rightMargin: root.gap }
                      text: modelRow.modelData.name
                      textFormat: Text.PlainText
                      elide: Text.ElideRight
                      color: Color.foreground
                      font.family: Style.font.family
                      font.pixelSize: root.bodyPx
                    }

                    Text {
                      id: modelTokens
                      anchors.right: parent.right
                      text: UsageModel.formatTokens(modelRow.modelData.tokens)
                      color: Color.foreground
                      font.family: Style.font.family
                      font.pixelSize: root.bodyPx
                      font.features: { "tnum": 1 }
                    }
                  }
                }
              }
            }
          }

          Rectangle {
            width: section.width
            height: 1
            color: Util.alpha(Color.foreground, 0.08)
          }
        }
      }
    }
  }

  Text {
    anchors.centerIn: body
    width: body.width - root.gap * 4
    horizontalAlignment: Text.AlignHCenter
    wrapMode: Text.WordWrap
    visible: root.providers.length === 0
    text: root.refreshing ? "reading usage" : "No usage data yet"
    color: Color.muted
    font.family: Style.font.family
    font.pixelSize: root.titlePx
  }
}
