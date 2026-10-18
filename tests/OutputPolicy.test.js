"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")
const loadLib = require("./support/loadLib.cjs")

const Output = loadLib("lib/OutputPolicy.js")

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

const MONITORS = [
  { name: "DP-1", description: "Dell Inc. DELL U2720Q 8FDSM13", disabled: false },
  { name: "HDMI-A-2", description: "JRP JRP7006H 0", disabled: false },
  { name: "DP-2", description: "JRP JRP7006H", disabled: false },
  { name: "DP-3", description: "LG Electronics LG ULTRAFINE 1", disabled: true }
]

test("a Display name is a port name or desc:<description>", () => {
  for (const name of ["DP-1", "HDMI-A-2", "eDP-1", "desc:JRP JRP7006H 0", "desc: Dell Inc. (x), y"]) {
    assert.equal(Output.isDisplayName(name), true, name)
  }
  for (const name of ["", "desc:", "desc:   ", "desc:a\nb", "JRP JRP7006H 0", "DP 1", null, 3, "desc:" + "x".repeat(129)]) {
    assert.equal(Output.isDisplayName(name), false, String(name))
  }
  assert.equal(Output.descriptionOf("desc:  JRP JRP7006H 0 "), "JRP JRP7006H 0")
  assert.equal(Output.descriptionOf("DP-1"), "")
  assert.equal(Output.isDescName("DP-1"), false)
})

test("resolve keeps a port name and finds a description's port, exactly first", () => {
  assert.equal(Output.resolve("DP-9", MONITORS), "DP-9")
  assert.equal(Output.resolve("desc:JRP JRP7006H 0", MONITORS), "HDMI-A-2")
  // Exact beats an earlier prefix match: "JRP JRP7006H" is a prefix of HDMI-A-2's.
  assert.equal(Output.resolve("desc:JRP JRP7006H", MONITORS), "DP-2")
  // Otherwise the first prefix match, as Hyprland does.
  assert.equal(Output.resolve("desc:JRP", MONITORS), "HDMI-A-2")
  assert.equal(Output.resolve("desc:Dell Inc.", MONITORS), "DP-1")
})

test("resolve finds nothing for an unknown, disabled or junk description", () => {
  assert.equal(Output.resolve("desc:Samsung", MONITORS), "")
  assert.equal(Output.resolve("desc:LG Electronics", MONITORS), "")
  assert.equal(Output.resolve("desc:", MONITORS), "")
  assert.equal(Output.resolve("desc:JRP", null), "")
  assert.equal(Output.resolve("desc:JRP", [null, { name: "bad name", description: "JRP" }, { name: "DP-5" }]), "")
  assert.equal(Output.resolve("not an output", MONITORS), "")
})

test("resolveDisplays puts desc: Displays on their ports and keeps the configured name", () => {
  const displays = [
    { name: "desc:JRP JRP7006H 0", kind: "surface" },
    { name: "DP-1", kind: "dock" },
    { name: "desc:Samsung", kind: "surface" }
  ]
  const out = Output.resolveDisplays(displays, MONITORS)
  assert.deepEqual(plain(out), {
    displays: [
      { name: "HDMI-A-2", kind: "surface", match: "desc:JRP JRP7006H 0" },
      { name: "DP-1", kind: "dock", match: "DP-1" },
      { name: "desc:Samsung", kind: "surface", match: "desc:Samsung" }
    ],
    errors: []
  })
  // The input is not changed, and resolving again starts from `match`.
  assert.equal(displays[0].name, "desc:JRP JRP7006H 0")
  const again = Output.resolveDisplays(out.displays, [{ name: "HDMI-A-1", description: "JRP JRP7006H 0" }])
  assert.deepEqual(plain(again.displays).map((d) => d.name), ["HDMI-A-1", "DP-1", "desc:Samsung"])
})

test("resolveDisplays skips a Display on an output an earlier one holds", () => {
  const out = Output.resolveDisplays([{ name: "HDMI-A-2" }, { name: "desc:JRP JRP7006H 0" }], MONITORS)
  assert.deepEqual(plain(out.displays), [{ name: "HDMI-A-2", match: "HDMI-A-2" }])
  assert.deepEqual(plain(out.errors),
    ['gjetr.toml: display "desc:JRP JRP7006H 0" is on HDMI-A-2, which "HDMI-A-2" already holds; display skipped'])
  assert.deepEqual(plain(Output.resolveDisplays(null, MONITORS)), { displays: [], errors: [] })
})
