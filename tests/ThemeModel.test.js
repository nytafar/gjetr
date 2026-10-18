"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")
const loadLib = require("./support/loadLib.cjs")

const Theme = loadLib("lib/ThemeModel.js")

test("the success colour is the theme's green from colors.toml", () => {
  assert.equal(Theme.successColor('mode = "dark"\naccent = "#f38d70"\ngreen = "#adda78"\n'), "#adda78")
  assert.equal(Theme.successColor('green = "#80adda78"\n'), "#80adda78")
})

test("a missing, malformed or oversized palette gives no success colour", () => {
  for (const text of [null, "", 'accent = "#f38d70"\n', 'green = "lime"\n', 'green = 5\n', "green = \n", "# " + "x".repeat(70000)]) {
    assert.equal(Theme.successColor(text), "", String(text).slice(0, 20))
  }
})

test("palette lists the accent and the theme's hues once each, in order", () => {
  const Palette = loadLib("lib/ThemeModel.js")
  const text = 'accent = "#f38d70"\nred = "#fd6883"\nyellow = "#F9CC6C"\ngreen = "#adda78"\ncyan = "nope"\nblue = "#F38D70"\nmagenta = "#a8a9eb"\n'
  assert.deepEqual(Array.from(Palette.palette(text)), ["#f38d70", "#fd6883", "#F9CC6C", "#adda78", "#a8a9eb"])
  for (const junk of [null, undefined, "", "= broken", "x".repeat(20000)]) {
    assert.deepEqual(Array.from(Palette.palette(junk)), [], String(junk).slice(0, 10))
  }
  assert.equal(Palette.successColor(text), "#adda78")
})

// A light theme (Omarchy's "Rose Pine Dawn"-like): dark text, mid accents.
const LIGHT_THEME = { foreground: "#575279", muted: "#9893a5", accent: "#1f3a6e", urgent: "#b4637a",
  success: "#56949f", palette: ["#1f3a6e", "#b4637a", "#ea9d34", "#56949f"] }
// A dark theme (Tokyo Night-like), every colour readable on black.
const DARK_THEME = { foreground: "#c0caf5", muted: "#787c99", accent: "#7aa2f7", urgent: "#f7768e",
  success: "#9ece6a", palette: ["#7aa2f7", "#f7768e", "#9ece6a"] }

function readsOn(colors, background) {
  assert.ok(Theme.contrast(colors.foreground, background) >= Theme.MIN_FOREGROUND_CONTRAST, "foreground " + colors.foreground)
  assert.ok(Theme.contrast(colors.muted, background) >= Theme.MIN_MUTED_CONTRAST, "muted " + colors.muted)
  for (const key of ["accent", "urgent", "success"]) {
    assert.ok(Theme.contrast(colors[key], background) >= Theme.MIN_ACCENT_CONTRAST, key + " " + colors[key])
  }
  for (const value of colors.palette) assert.ok(Theme.contrast(value, background) >= Theme.MIN_ACCENT_CONTRAST, value)
}

test("contrast is the WCAG ratio against the background as drawn", () => {
  assert.equal(Math.round(Theme.contrast("#ffffff", "#000000")), 21)
  assert.equal(Theme.contrast("#000000", "#000000"), 1)
  // Qt prints transparent as #00000000, and a translucent tint is over black.
  assert.equal(Math.round(Theme.contrast("#ffffff", "#00000000")), 21)
  assert.equal(Math.round(Theme.contrast("#ffffff", "#00ffffff")), 21)
  assert.equal(Theme.contrast("nope", "#000000"), 0)
  assert.equal(Theme.isLight("#000000"), false)
  assert.equal(Theme.isLight("#fffaf3"), true)
  assert.equal(Theme.isLight("#c0000000"), false)
  assert.equal(Theme.isLight("junk"), false)
})

test("a dark theme on black keeps every theme colour", () => {
  const colors = Theme.readable(DARK_THEME, "#000000")
  assert.deepEqual({ ...colors, palette: Array.from(colors.palette) },
    { background: "#000000", ...DARK_THEME })
})

test("a light theme on black gets light text and nudged accents that read", () => {
  const colors = Theme.readable(LIGHT_THEME, "#000000")
  assert.equal(colors.foreground, "#e6e6e6")
  assert.equal(colors.muted, "#9893a5", "the theme's muted already reads on black")
  readsOn(colors, "#000000")
  assert.notEqual(colors.accent, LIGHT_THEME.accent, "the theme's dark accent is lightened")
  assert.equal(colors.palette[2], "#ea9d34", "a hue that reads is kept")
})

test("on a light Config background the derivation goes the other way", () => {
  const dark = Theme.readable(DARK_THEME, "#fffaf3")
  assert.equal(dark.foreground, "#1a1a1a")
  assert.equal(dark.muted, DARK_THEME.muted, "the theme's muted still reads on cream")
  assert.equal(Theme.readable({ ...DARK_THEME, muted: "#c8c8d8" }, "#fffaf3").muted, "#5c5c5c")
  assert.equal(dark.background, "#fffaf3")
  readsOn(dark, "#fffaf3")
  const light = Theme.readable(LIGHT_THEME, "#ffffff")
  assert.equal(light.foreground, LIGHT_THEME.foreground)
  readsOn(light, "#ffffff")
})

test("transparent and tinted backgrounds are read over black", () => {
  for (const background of ["#00000000", "#c0000000", "transparent", ""]) {
    const colors = Theme.readable(LIGHT_THEME, background)
    assert.equal(colors.foreground, "#e6e6e6", background)
    readsOn(colors, background)
  }
  assert.equal(Theme.readable(LIGHT_THEME, "#80ffffff").background, "#808080")
})

test("a missing green is the accent, junk palette entries drop, and nothing is undefined", () => {
  const colors = Theme.readable({ ...DARK_THEME, success: "", palette: ["#7aa2f7", "nope", "#7aa2f7"] }, "#000000")
  assert.equal(colors.success, DARK_THEME.accent)
  assert.deepEqual(Array.from(colors.palette), ["#7aa2f7"])
  for (const theme of [null, undefined, {}, { foreground: 5 }]) {
    const fallback = Theme.readable(theme, "#000000")
    for (const key of ["background", "foreground", "muted", "accent", "urgent", "success"]) {
      assert.equal(typeof fallback[key], "string", key)
      assert.ok(fallback[key].startsWith("#"), key)
    }
    assert.deepEqual(Array.from(fallback.palette), [])
  }
})
