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
