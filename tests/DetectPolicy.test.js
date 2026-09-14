"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const loadLib = require("./support/loadLib.cjs")

const Detect = loadLib("lib/DetectPolicy.js")
const Preset = loadLib("lib/PresetModel.js")
const Config = loadLib("lib/ConfigModel.js")

const HOME = "/home/test"

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

const MONITORS = JSON.stringify([
  { name: "DP-1", focused: true, disabled: false, width: 3840, height: 2160 },
  { name: "HDMI-A-2", focused: false, disabled: false, width: 1024, height: 600 }
])
const DEVICES = JSON.stringify({ keyboards: [], touch: [
  { address: "0x1", name: "wch.cn-usb2iic_ctp_control-1" }, { address: "0x2", name: "wch.cn-usb2iic_ctp_control" }] })
const INPUT_LUA = `
-- Touchscreen on the panel
hl.device({ name = "wch.cn-usb2iic_ctp_control", output = "HDMI-A-2" })
hl.device({ name = "wch.cn-usb2iic_ctp_control-1", output = "HDMI-A-2" })
-- hl.device({ name = "old-panel", output = "DP-9" })
hl.device({ name = "pen", sensitivity = 0.5 })
hl.device({
  output = "DP-1",
  name = "big-touch", -- a comment inside
})
hl.device({ name = "bad name", output = "HDMI-A-2" }) hl.device({ name = "x", output = "bad output!" })
`

function input(overrides) {
  return Object.assign({
    monitors: Detect.parseMonitors(MONITORS).monitors,
    touchDevices: Detect.parseTouchDevices(DEVICES).names,
    bindings: Detect.touchBindings(INPUT_LUA),
    previous: null
  }, overrides)
}

test("the sidebar Dock gjetr shows without a Config starts shown", () => {
  assert.equal(Detect.SIDEBAR_VISIBLE, true)
})

test("touchBindings reads each hl.device output binding and skips comments and bad names", () => {
  assert.deepEqual(plain(Detect.touchBindings(INPUT_LUA)), [
    { name: "wch.cn-usb2iic_ctp_control", output: "HDMI-A-2" },
    { name: "wch.cn-usb2iic_ctp_control-1", output: "HDMI-A-2" },
    { name: "big-touch", output: "DP-1" }
  ])
  assert.deepEqual(plain(Detect.touchBindings("--[[ hl.device({ name = \"a\", output = \"B\" }) ]]\n")), [])
  assert.deepEqual(plain(Detect.touchBindings(null)), [])
  assert.deepEqual(plain(Detect.touchBindings("hl.device({ name = \"a--b\", output = \"B\" })")), [{ name: "a--b", output: "B" }])
})

test("parseMonitors and parseTouchDevices read hyprctl's JSON and refuse junk", () => {
  assert.deepEqual(plain(Detect.parseMonitors(MONITORS).monitors), [
    { name: "DP-1", focused: true, disabled: false, width: 3840, height: 2160 },
    { name: "HDMI-A-2", focused: false, disabled: false, width: 1024, height: 600 }
  ])
  assert.deepEqual(plain(Detect.parseMonitors('[{"name":"bad name"},{"name":"DP-2","focused":"yes"}]')),
    { ok: true, monitors: [{ name: "DP-2", focused: false, disabled: false, width: 0, height: 0 }] })
  assert.deepEqual(plain(Detect.parseMonitors("not json")), { ok: false, monitors: [] })
  assert.deepEqual(plain(Detect.parseMonitors('{"name":"DP-1"}')), { ok: false, monitors: [] })
  assert.deepEqual(plain(Detect.parseTouchDevices(DEVICES).names), ["wch.cn-usb2iic_ctp_control-1", "wch.cn-usb2iic_ctp_control"])
  assert.deepEqual(plain(Detect.parseTouchDevices('{"touch":"x"}')), { ok: true, names: [] })
  assert.deepEqual(plain(Detect.parseTouchDevices("")), { ok: false, names: [] })
})

test("a connected touchscreen bound to an output of its own shows the panel preset there", () => {
  assert.deepEqual(plain(Detect.detect(input())), {
    ready: true, preset: "panel", touchscreen: "HDMI-A-2", monitor: "DP-1", device: "wch.cn-usb2iic_ctp_control",
    reason: "touchscreen wch.cn-usb2iic_ctp_control is bound to HDMI-A-2"
  })
})

test("without a usable touchscreen the sidebar preset goes on the focused monitor", () => {
  const unplugged = Detect.detect(input({ touchDevices: ["big-touch-2"] }))
  assert.deepEqual(plain(unplugged), { ready: true, preset: "sidebar", touchscreen: "", monitor: "DP-1", device: "",
    reason: "no connected touchscreen is bound to an output" })
  const gone = Detect.detect(input({ bindings: [{ name: "wch.cn-usb2iic_ctp_control", output: "HDMI-A-9" }] }))
  assert.equal(gone.preset, "sidebar")
  assert.equal(gone.monitor, "DP-1")
  const unbound = Detect.detect(input({ bindings: [] }))
  assert.equal(unbound.preset, "sidebar")
  const focusedPanel = Detect.detect(input({ bindings: [], monitors: [
    { name: "DP-1", focused: false, disabled: false, width: 3840, height: 2160 },
    { name: "HDMI-A-2", focused: true, disabled: false, width: 1024, height: 600 }] }))
  assert.equal(focusedPanel.monitor, "HDMI-A-2")
})

test("a touchscreen that is the only monitor gets the sidebar, not a panel over the whole desktop", () => {
  const laptop = Detect.detect(input({ monitors: [{ name: "eDP-1", focused: true, disabled: false, width: 1920, height: 1200 }],
    touchDevices: ["elan-touch"], bindings: [{ name: "elan-touch", output: "eDP-1" }] }))
  assert.deepEqual(plain(laptop), { ready: true, preset: "sidebar", touchscreen: "", monitor: "eDP-1", device: "",
    reason: "touchscreen elan-touch is bound to eDP-1, the only monitor" })
})

test("detection keeps the outputs it chose while they are still there, so a hotplug does not move the Dock", () => {
  const previous = { preset: "sidebar", touchscreen: "", monitor: "HDMI-A-2" }
  const kept = Detect.detect(input({ bindings: [], previous: previous }))
  assert.equal(kept.monitor, "HDMI-A-2")
  const moved = Detect.detect(input({ bindings: [], previous: { preset: "sidebar", touchscreen: "", monitor: "DP-7" } }))
  assert.equal(moved.monitor, "DP-1")
  // Two bound touchscreens: the one shown before stays.
  const two = input({ touchDevices: ["wch.cn-usb2iic_ctp_control", "big-touch"],
    monitors: Detect.parseMonitors(MONITORS).monitors.concat([{ name: "DP-3", focused: false, disabled: false, width: 800, height: 480 }]),
    bindings: [{ name: "wch.cn-usb2iic_ctp_control", output: "HDMI-A-2" }, { name: "big-touch", output: "DP-3" }] })
  assert.equal(Detect.detect(two).touchscreen, "HDMI-A-2")
  assert.equal(Detect.detect(Object.assign({}, two, { previous: { preset: "panel", touchscreen: "DP-3", monitor: "DP-1" } })).touchscreen, "DP-3")
})

test("detection waits for the monitors, and shows nothing without one", () => {
  assert.deepEqual(plain(Detect.detect(input({ monitors: null }))), { ready: false, preset: "", touchscreen: "", monitor: "",
    device: "", reason: "reading monitors" })
  assert.deepEqual(plain(Detect.detect(input({ monitors: [], touchDevices: null }))), { ready: true, preset: "", touchscreen: "",
    monitor: "", device: "", reason: "no monitor" })
  assert.equal(Detect.detect(input({ touchDevices: null })).preset, "sidebar")
  assert.equal(Detect.detect(input({ monitors: [{ name: "DP-1", focused: true, disabled: true }] })).preset, "")
})

test("detectedConfig shows each Dock as SIDEBAR_VISIBLE says and leaves surfaces and its input alone", () => {
  const read = Config.readMain('[[display]]\nname = "HDMI-A-2"\n[[display]]\nkind = "dock"\nname = "DP-1"\nvisible = false\n', HOME)
  const shown = Detect.detectedConfig(read.config)
  assert.deepEqual(plain(shown.displays.map(d => [d.name, d.visible])), [["HDMI-A-2", true], ["DP-1", Detect.SIDEBAR_VISIBLE]])
  assert.equal(read.config.displays[1].visible, false)
  assert.equal(shown.socket, read.config.socket)
})

test("without a Config or a touchscreen the shipped sidebar preset is a shown Dock on the focused monitor", () => {
  const text = fs.readFileSync(path.join(__dirname, "..", "presets", "sidebar.toml"), "utf8")
  const detection = Detect.detect(input({ bindings: [] }))
  const rendered = Preset.render(text, { touchscreen: detection.touchscreen, monitor: detection.monitor })
  const config = Detect.detectedConfig(Config.readMain(rendered.text, HOME).config)
  assert.deepEqual(plain(config.displays.map(d => ({ kind: d.kind, name: d.name, edge: d.edge, visible: d.visible, deck: d.deck }))),
    [{ kind: "dock", name: "DP-1", edge: "left", visible: true, deck: ["sidebar"] }])
})

// step: detection as a pipeline, driven by a script of events.

test("step: a refresh reads monitors and touch devices", () => {
  const out = Detect.step(Detect.initial(), { type: "refresh" }, 1000)
  assert.deepEqual(plain(out.commands.map(c => c.argv)), [["hyprctl", "-j", "monitors"], ["hyprctl", "-j", "devices"]])
  assert.equal(out.state.detection.ready, false)
})

function reply(state, id, text, now) {
  return Detect.step(state, { type: "reply", id, text, code: 0 }, now)
}

test("step: replies in either order detect once both are in; a reply from the previous refresh is ignored", () => {
  let out = Detect.step(Detect.initial(), { type: "bindings", bindings: Detect.touchBindings(INPUT_LUA) }, 900)
  out = Detect.step(out.state, { type: "refresh" }, 1000)
  const [monitors1, devices1] = out.commands.map(c => c.id)
  // A hotplug starts a second refresh before the first has answered.
  out = Detect.step(out.state, { type: "refresh" }, 1100)
  const [monitors2, devices2] = out.commands.map(c => c.id)
  out = reply(out.state, devices2, DEVICES, 1200)
  assert.equal(out.state.detection.ready, false)
  // The first refresh answers late, with a panel that has gone.
  out = reply(out.state, monitors1, JSON.stringify([{ name: "DP-1", focused: true }]), 1250)
  out = reply(out.state, devices1, JSON.stringify({ touch: [] }), 1260)
  assert.equal(out.state.detection.ready, false)
  out = reply(out.state, monitors2, MONITORS, 1300)
  assert.deepEqual(plain(out.state.detection), { ready: true, preset: "panel", touchscreen: "HDMI-A-2", monitor: "DP-1",
    device: "wch.cn-usb2iic_ctp_control", reason: "touchscreen wch.cn-usb2iic_ctp_control is bound to HDMI-A-2" })
  assert.deepEqual(plain(out.commands), [])
})

test("step: a failed monitor read is read again, with the devices, only once retryAt has passed", () => {
  let out = Detect.step(Detect.initial(), { type: "refresh" }, 1000)
  const [monitors, devices] = out.commands.map(c => c.id)
  out = Detect.step(out.state, { type: "reply", id: monitors, text: "", code: 1 }, 1100)
  out = reply(out.state, devices, DEVICES, 1200)
  assert.equal(out.state.detection.ready, false)
  assert.equal(out.state.retryAt, 1200 + Detect.RETRY_MS)
  assert.deepEqual(plain(Detect.step(out.state, { type: "tick" }, 1200 + Detect.RETRY_MS - 1).commands), [])
  const retry = Detect.step(out.state, { type: "tick" }, 1200 + Detect.RETRY_MS)
  assert.deepEqual(plain(retry.commands.map(c => c.argv)), [["hyprctl", "-j", "monitors"], ["hyprctl", "-j", "devices"]])
  // Once retried, later ticks do not ask again.
  assert.deepEqual(plain(Detect.step(retry.state, { type: "tick" }, 1200 + Detect.RETRY_MS * 3).commands), [])
})

test("step: inputs that did not change keep the detection, and a re-read that detects the same keeps its reference", () => {
  let out = Detect.step(Detect.initial(), { type: "bindings", bindings: Detect.touchBindings(INPUT_LUA) }, 900)
  out = Detect.step(out.state, { type: "refresh" }, 1000)
  let [monitors, devices] = out.commands.map(c => c.id)
  out = reply(reply(out.state, monitors, MONITORS, 1100).state, devices, DEVICES, 1200)
  const detected = out.state
  assert.equal(detected.detection.preset, "panel")
  // input.lua read again with the same bindings.
  assert.equal(Detect.step(detected, { type: "bindings", bindings: Detect.touchBindings(INPUT_LUA) }, 1300).state, detected)
  // A hotplug elsewhere reads the same outputs again.
  out = Detect.step(detected, { type: "refresh" }, 2000);
  [monitors, devices] = out.commands.map(c => c.id)
  out = reply(reply(out.state, devices, DEVICES, 2100).state, monitors, MONITORS, 2200)
  assert.equal(out.state.detection, detected.detection)
  // Removing the panel's binding changes it.
  out = Detect.step(out.state, { type: "bindings", bindings: [] }, 2300)
  assert.equal(out.state.detection.preset, "sidebar")
})
