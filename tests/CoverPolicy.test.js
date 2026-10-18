"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")
const loadLib = require("./support/loadLib.cjs")

const Cover = loadLib("lib/CoverPolicy.js")

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

// The desk: DP-1 (2560x1440 at scale 1.25, so 2048x1152 logical) on the left,
// HDMI-A-2 (1024x600, turned a quarter, so 600x1024) to its right.
function monitors(overrides) {
  const list = [
    { id: 0, name: "DP-1", x: 0, y: 0, width: 2560, height: 1440, scale: 1.25, transform: 0,
      activeWorkspace: { id: 1, name: "1" }, specialWorkspace: { id: 0, name: "" }, disabled: false },
    { id: 1, name: "HDMI-A-2", x: 2048, y: 0, width: 1024, height: 600, scale: 1, transform: 1,
      activeWorkspace: { id: 5, name: "5" }, specialWorkspace: { id: 0, name: "" }, disabled: false }
  ]
  if (overrides) Object.assign(list[1], overrides)
  return JSON.stringify(list)
}

function client(fields) {
  return Object.assign({ address: "0x1", mapped: true, hidden: false, at: [2048, 0], size: [600, 1024],
    workspace: { id: 5, name: "5" }, floating: false, pseudo: false, monitor: 1, class: "Alacritty",
    title: "herdr", pinned: false, fullscreen: 0 }, fields)
}

function clients(...rows) {
  return JSON.stringify(rows.map(client))
}

test("parseMonitors gives logical rectangles, swapped for a quarter turn", () => {
  assert.deepEqual(plain(Cover.parseMonitors(monitors())), [
    { id: 0, name: "DP-1", x: 0, y: 0, width: 2048, height: 1152, workspace: 1, special: 0, disabled: false },
    { id: 1, name: "HDMI-A-2", x: 2048, y: 0, width: 600, height: 1024, workspace: 5, special: 0, disabled: false }
  ])
})

test("parsers refuse junk and drop invalid rows", () => {
  for (const text of ["", "not json", "{}", "1", null, undefined]) {
    assert.equal(Cover.parseMonitors(text), null)
    assert.equal(Cover.parseClients(text), null)
  }
  assert.deepEqual(plain(Cover.parseMonitors('[{"name":"x;rm","id":0,"x":0,"y":0,"width":1,"height":1}, 3]')), [])
  assert.deepEqual(plain(Cover.parseClients(JSON.stringify([client({ address: "nope" }), client({ at: "0,0" }),
    client({ size: [1] }), 5]))), [])
})

test("a tiled window on the surface's active workspace covers it", () => {
  const out = Cover.check(monitors(), clients({}), "HDMI-A-2")
  assert.deepEqual(plain(out), {
    checked: true, covered: true, count: 1, error: "",
    windows: [{ address: "0x1", title: "herdr", class: "Alacritty", workspace: "5", floating: false, fullscreen: false }]
  })
  assert.equal(Cover.warning("HDMI-A-2", out), "surface HDMI-A-2 is covered by Alacritty")
})

test("windows elsewhere, unmapped or hidden do not cover it", () => {
  const out = Cover.check(monitors(), clients(
    { address: "0x2", workspace: { id: 1, name: "1" }, at: [0, 0], size: [2048, 1152], monitor: 0 },
    { address: "0x3", workspace: { id: 6, name: "6" } },
    { address: "0x4", mapped: false },
    { address: "0x5", hidden: true }
  ), "HDMI-A-2")
  assert.equal(out.checked, true)
  assert.equal(out.covered, false)
  assert.equal(out.count, 0)
  assert.equal(Cover.warning("HDMI-A-2", out), "")
})

test("a window on the active workspace counts only where it overlaps the output", () => {
  // Floating, dragged entirely onto DP-1's area while still on workspace 5.
  const off = Cover.check(monitors(), clients({ floating: true, at: [100, 100], size: [400, 300] }), "HDMI-A-2")
  assert.equal(off.covered, false)
  // Touching the edge is not overlapping; one pixel in is.
  assert.equal(Cover.check(monitors(), clients({ floating: true, at: [1648, 0], size: [400, 300] }), "HDMI-A-2").covered, false)
  const partly = Cover.check(monitors(), clients({ floating: true, at: [1649, 0], size: [400, 300] }), "HDMI-A-2")
  assert.equal(partly.covered, true)
  assert.equal(partly.windows[0].floating, true)
})

test("an open special workspace and a pinned window cover it too", () => {
  const special = monitors({ specialWorkspace: { id: -98, name: "special:scratch" } })
  const out = Cover.check(special, clients({ address: "0x7", workspace: { id: -98, name: "special:scratch" },
    floating: true, at: [2100, 100], size: [400, 400] }), "HDMI-A-2")
  assert.equal(out.covered, true)
  assert.equal(out.windows[0].workspace, "special:scratch")
  // The same special workspace, closed, covers nothing.
  assert.equal(Cover.check(monitors(), clients({ address: "0x7", workspace: { id: -98, name: "special:scratch" },
    floating: true, at: [2100, 100], size: [400, 400] }), "HDMI-A-2").covered, false)
  const pinned = Cover.check(monitors(), clients({ pinned: true, floating: true, workspace: { id: 4, name: "4" },
    at: [2100, 100], size: [200, 200] }), "HDMI-A-2")
  assert.equal(pinned.covered, true)
})

test("a fullscreen window is reported as fullscreen", () => {
  const out = Cover.check(monitors(), clients({ fullscreen: 2 }), "HDMI-A-2")
  assert.equal(out.covered, true)
  assert.equal(out.windows[0].fullscreen, true)
})

test("several windows are counted, listed up to the cap, and named in the warning", () => {
  const rows = []
  for (let i = 0; i < Cover.MAX_WINDOWS + 3; i++) rows.push({ address: "0x" + (i + 16).toString(16), class: "c" + i })
  const out = Cover.check(monitors(), clients(...rows), "HDMI-A-2")
  assert.equal(out.count, Cover.MAX_WINDOWS + 3)
  assert.equal(out.windows.length, Cover.MAX_WINDOWS)
  assert.equal(Cover.warning("HDMI-A-2", out), "surface HDMI-A-2 is covered by c0 and " + (Cover.MAX_WINDOWS + 2) + " more")
})

test("an unknown output, a disabled monitor or unreadable replies leave cover unknown", () => {
  const missing = Cover.check(monitors(), clients({}), "DP-9")
  assert.deepEqual(plain(missing), { checked: false, covered: null, count: 0, windows: [],
    error: "output DP-9 not in hyprctl monitors" })
  assert.equal(Cover.check("junk", clients({}), "HDMI-A-2").error, "hyprctl monitors unreadable")
  assert.equal(Cover.check(monitors(), "junk", "HDMI-A-2").error, "hyprctl clients unreadable")
  assert.equal(Cover.check(monitors({ disabled: true }), clients({}), "HDMI-A-2").covered, false)
  assert.equal(Cover.warning("HDMI-A-2", missing), "")
  assert.deepEqual(plain(Cover.initial()), { checked: false, covered: null, count: 0, windows: [], error: "" })
})

test("same compares what state reports", () => {
  const a = Cover.check(monitors(), clients({}), "HDMI-A-2")
  assert.equal(Cover.same(a, Cover.check(monitors(), clients({}), "HDMI-A-2")), true)
  assert.equal(Cover.same(a, Cover.check(monitors(), clients({ title: "other" }), "HDMI-A-2")), false)
  assert.equal(Cover.same(a, Cover.initial()), false)
  assert.equal(Cover.same(Cover.initial(), Cover.initial()), true)
  assert.equal(Cover.same(null, a), false)
})

test("the window and workspace events trigger a check, others do not", () => {
  for (const name of ["openwindow", "closewindow", "movewindowv2", "workspacev2", "activewindow", "fullscreen",
    "activespecial", "changefloatingmode"]) assert.equal(Cover.triggers(name), true, name)
  for (const name of ["windowtitle", "submap", "", null, undefined]) assert.equal(Cover.triggers(name), false, String(name))
})
