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

test("rotateOutput writes every field of the runtime monitor rule", () => {
  const argv = Command.rotateOutput("HDMI-A-2", 1, 1920, 0, 1)
  assert.deepEqual(Array.from(argv), ["hyprctl", "eval",
    'hl.monitor({ output = "HDMI-A-2", mode = "preferred", position = "1920x0", scale = 1, transform = 1 })'])
  assert.equal(Command.allowed(argv), true)
  assert.equal(Command.allowed(Command.rotateOutput("DP-1", 0, -1920, 1080, 1.333333)), true)
  assert.equal(Command.allowed(Array.from(Command.MONITORS)), true)
})

test("rotateOutput refuses values outside the allowlist", () => {
  for (const args of [
    ['HDMI-A-2", disabled = true, x = "', 1, 0, 0, 1],
    ["HDMI-A-2", 8, 0, 0, 1],
    ["HDMI-A-2", 1.5, 0, 0, 1],
    ["HDMI-A-2", "1", 0, 0, 1],
    ["HDMI-A-2", 1, 0.5, 0, 1],
    ["HDMI-A-2", 1, 0, 0, 0],
    ["HDMI-A-2", 1, 0, 0, NaN],
    ["", 1, 0, 0, 1]
  ]) {
    assert.deepEqual(Array.from(Command.rotateOutput(...args)), [], JSON.stringify(args))
  }
  assert.equal(Command.allowed(["hyprctl", "eval", 'hl.monitor({ output = "HDMI-A-2", disabled = true })']), false)
})

const SESSION = "cf43ca7f-58ec-4ecd-a3ae-8efb244388cc"
const PROJECTS = "/home/test/.claude/projects"
const TRANSCRIPT = PROJECTS + "/-home-test-code/" + SESSION + ".jsonl"

test("Recap commands locate, stat and grep transcripts only", () => {
  const find = Command.locateTranscript(PROJECTS, SESSION)
  assert.deepEqual(Array.from(find), ["find", PROJECTS, "-mindepth", "2", "-maxdepth", "2", "-type", "f", "-name", SESSION + ".jsonl"])
  assert.equal(Command.allowed(find), true)
  const stat = Command.statTranscripts([TRANSCRIPT, TRANSCRIPT.replace("-code", "-docs")])
  assert.deepEqual(Array.from(stat).slice(0, 4), ["stat", "-c", "%Y %s %n", "--"])
  assert.equal(Command.allowed(stat), true)
  const grep = Command.grepRecaps(TRANSCRIPT)
  assert.deepEqual(Array.from(grep), ["grep", "-F", "--", '"subtype":"away_summary"', TRANSCRIPT])
  assert.equal(Command.allowed(grep), true)
})

test("Recap commands refuse other paths, ids and shapes", () => {
  const newline = String.fromCharCode(10)
  assert.deepEqual(Array.from(Command.locateTranscript("/etc", SESSION)), [])
  assert.deepEqual(Array.from(Command.locateTranscript(PROJECTS, "*")), [])
  assert.deepEqual(Array.from(Command.locateTranscript("relative/.claude/projects", SESSION)), [])
  assert.deepEqual(Array.from(Command.grepRecaps("/etc/passwd")), [])
  assert.deepEqual(Array.from(Command.grepRecaps(PROJECTS + "/../" + SESSION + ".jsonl")), [])
  assert.deepEqual(Array.from(Command.grepRecaps(PROJECTS + "/a" + newline + "b/" + SESSION + ".jsonl")), [])
  assert.deepEqual(Array.from(Command.statTranscripts([])), [])
  assert.deepEqual(Array.from(Command.statTranscripts([TRANSCRIPT, "/etc/shadow"])), [])
  for (const argv of [
    ["find", PROJECTS, "-name", "*", "-delete"],
    ["find", PROJECTS, "-mindepth", "2", "-maxdepth", "2", "-type", "f", "-name", SESSION + ".jsonl", "-delete"],
    ["grep", "-r", "--", '"subtype":"away_summary"', TRANSCRIPT],
    ["grep", "-F", "--", "password", TRANSCRIPT],
    ["stat", "-c", "%Y %s %n", "/etc/passwd"],
    ["stat", "-c", "%Y %s %n", "--", "/etc/passwd"],
    ["tail", "-c", "10", TRANSCRIPT]
  ]) {
    assert.equal(Command.allowed(argv), false, JSON.stringify(argv))
  }
})

test("touch transforms follow a rotation, globally or per device", () => {
  assert.deepEqual(Array.from(Command.touchTransform(1)),
    ["hyprctl", "eval", "hl.config({ input = { touchdevice = { transform = 1 } } })"])
  const device = Command.deviceTransform("wch.cn-usb2iic_ctp_control-1", "HDMI-A-2", 3)
  assert.deepEqual(Array.from(device),
    ["hyprctl", "eval", 'hl.device({ name = "wch.cn-usb2iic_ctp_control-1", output = "HDMI-A-2", transform = 3 })'])
  assert.equal(Command.allowed(Command.touchTransform(0)), true)
  assert.equal(Command.allowed(device), true)
  assert.deepEqual(Array.from(Command.touchTransform(8)), [])
  assert.deepEqual(Array.from(Command.deviceTransform('x", enabled = false, y = "', "HDMI-A-2", 1)), [])
  assert.equal(Command.allowed(["hyprctl", "eval", 'hl.device({ name = "x", enabled = false })']), false)
})
