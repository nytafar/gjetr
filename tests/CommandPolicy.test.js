"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")
const loadLib = require("./support/loadLib.cjs")

const Command = loadLib("lib/CommandPolicy.js")

test("the fixed read commands are allowed exactly", () => {
  assert.equal(Command.allowed(Array.from(Command.PROCESSES)), true)
  assert.equal(Command.allowed(Array.from(Command.CLIENTS)), true)
  assert.equal(Command.allowed(["ps", "-e"]), false)
  assert.equal(Command.allowed(["hyprctl", "-j", "clients", "extra"]), false)
})

test("focusWindow builds a dispatch for a hex address only", () => {
  assert.deepEqual(Array.from(Command.focusWindow("0x5586ee998880")),
    ["hyprctl", "dispatch", 'hl.dsp.focus({ window = "address:0x5586ee998880" })'])
  for (const bad of ["0x", "5586", "0xABC", '0x1" }) os.execute("x', "0x1 ", null, 12]) {
    assert.deepEqual(Array.from(Command.focusWindow(bad)), [], String(bad))
  }
  assert.equal(Command.allowed(Command.focusWindow("0x5586ee998880")), true)
})

test("allowed refuses anything else", () => {
  for (const argv of [
    [],
    null,
    "hyprctl",
    ["sh", "-c", "hyprctl clients"],
    ["hyprctl", "dispatch", 'hl.dsp.focus({ window = "address:0x1" }) os.execute("x")'],
    ["hyprctl", "dispatch", 'hl.dsp.exec_cmd("x")'],
    ["hyprctl", "eval", "os.execute('x')"],
    ["hyprctl", "-j", 5]
  ]) {
    assert.equal(Command.allowed(argv), false, JSON.stringify(argv))
  }
})
