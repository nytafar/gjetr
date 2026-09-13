# Tickets

Ordered. Each lands with node tests for its `lib/*.js`, and ends with an
acceptance note from the real panel where one applies.

| # | Ticket | Covers | Needs |
|---|---|---|---|
| T01 | **Spike** (throwaway): `events.subscribe` from QML; runtime rotation of `HDMI-A-2` and whether touch follows; Bottom layer surface on the panel | risks | — |
| T02 | Plugin skeleton: manifest, Service, DeckSurface pinned to Config Display, black background, bar inset, hotplug | M1, M12, M17 | T01 |
| T03 | `HerdrModel.js` + connection: snapshot, subscription, collapsing, backoff, Offline state | M2, M10, M11 | T02 |
| T04 | `NamePolicy.js`, `SortPolicy.js`, `CacheTimerModel.js` (watch timers.json) | M3, M5, M7 | T03 |
| T05 | Agent List Module: Cards, presets, theme colours, tap to focus in herdr | M6, M8 (herdr side) | T04 |
| T06 | `ConfigModel.js`: TOML, validation, hot reload; Overrides state file; header cycles Sort mode | M4, M13, M14 | T05 |
| T07 | Focus behaviour: find most recent hosting window, switch and focus; panel toggle | M8 | T06 |
| T08 | `AttentionModel.js`: pulse, clear on focus | M9 | T05 |
| T09 | Deck: multiple Layouts, tabs on short edge, swipe, badges, orientation and rotation | M15, M16, M9 (badges) | T06, T08 |
| T10 | Docs: README, CONFIGURATION with example Config, ARCHITECTURE boundaries | — | T09 |
