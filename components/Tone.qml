pragma Singleton

import QtQuick
import qs.Commons

// The colours gjetr draws with, and a tone name (CardModel, StatusPolicy,
// IndicatorPolicy) to one of them. The service derives them from the theme so
// they read on the Display background (ThemeModel.readable, its `colors`);
// `fallback` is the theme's own, for a component that has no service yet.
// Unknown tone names are muted.
QtObject {
  readonly property QtObject fallback: QtObject {
    readonly property color background: "black"
    readonly property color foreground: Color.foreground
    readonly property color muted: Color.muted
    readonly property color accent: Color.accent
    readonly property color urgent: Color.urgent
    readonly property color success: Color.accent
  }

  // A service's readable colours, or the fallback without one.
  function colorsOf(service) {
    return service && service.colors ? service.colors : fallback
  }

  function color(tone, colors) {
    var c = colors || fallback
    if (tone === "success") return c.success
    if (tone === "urgent") return c.urgent
    if (tone === "accent") return c.accent
    if (tone === "foreground") return c.foreground
    return c.muted
  }
}
