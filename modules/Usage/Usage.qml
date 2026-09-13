pragma ComponentBehavior: Bound

import QtQuick
import qs.Commons
import "../../lib/CardPolicy.js" as CardPolicy
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

  readonly property real textScale: 1.25
  readonly property int gap: Style.spacing.lg
  readonly property int pad: Style.spacing.xxl
  readonly property int captionPx: Math.round(Style.font.caption * textScale)
  readonly property int bodyPx: Math.round(Style.font.body * textScale)
  readonly property int titlePx: Math.round(Style.font.title * textScale)

  // Meter colours: theme tokens only, loudest at the highest share used.
  function levelColor(level) {
    if (level === "critical") return Color.urgent
    if (level === "warn") return Color.accent
    return Color.foreground
  }

  Item {
    id: header
    anchors { top: parent.top; left: parent.left; right: parent.right }
    height: CardPolicy.MIN_TOUCH_PX

    Rectangle {
      anchors.fill: parent
      color: headerTap.pressed ? Style.pressedFillFor(Color.foreground, Color.accent) : "transparent"
    }

    Text {
      anchors { left: parent.left; leftMargin: root.gap * 2; verticalCenter: parent.verticalCenter }
      text: "usage"
      color: Color.foreground
      font.family: Style.font.family
      font.pixelSize: root.titlePx
      font.bold: true
    }

    Text {
      anchors { right: parent.right; rightMargin: root.gap * 2; verticalCenter: parent.verticalCenter }
      text: root.refreshing ? "refreshing" : UsageModel.ageLabel(root.newestUpdate, root.now)
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
      x: root.gap * 2
      y: root.gap * 2
      width: body.width - root.gap * 4
      spacing: root.gap * 3

      Repeater {
        model: root.providers

        delegate: Column {
          id: section
          required property var modelData

          readonly property var provider: modelData
          readonly property bool stale: provider.ready && UsageModel.isStale(provider.updatedAtMs, root.now, root.refreshSeconds)

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
            visible: !section.provider.ready
            width: section.width
            text: section.provider.statusText !== "" ? section.provider.statusText : "not ready"
            textFormat: Text.PlainText
            wrapMode: Text.WordWrap
            color: Color.muted
            font.family: Style.font.family
            font.pixelSize: root.bodyPx
          }

          Repeater {
            model: section.provider.ready ? root.show : []

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
