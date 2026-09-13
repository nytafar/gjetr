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
