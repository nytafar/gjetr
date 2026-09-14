pragma Singleton

import QtQuick
import qs.Commons

// A tone name (CardModel, StatusPolicy, IndicatorPolicy) to its theme colour.
// `success` is the theme's green the service resolved; unknown names are muted.
QtObject {
  function color(tone, successColor) {
    if (tone === "success") return successColor !== undefined ? successColor : Color.accent
    if (tone === "urgent") return Color.urgent
    if (tone === "accent") return Color.accent
    if (tone === "foreground") return Color.foreground
    return Color.muted
  }
}
