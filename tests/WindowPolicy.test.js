"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")
const loadLib = require("./support/loadLib.cjs")

const Window = loadLib("lib/WindowPolicy.js")

const HOME = "/home/test"
const SOCK = "/home/test/.config/herdr/herdr.sock"

function proc(comm, args) {
  return { pid: 1, ppid: 0, comm, args: args.split(" ") }
}

// Shape of the live machine during T07: foot runs herdr directly, Obsidian's
// renderer runs a pane-control client, ghostty runs a shell with nothing.
const PS = [
  "      1       0 systemd         /usr/lib/systemd/systemd",
  "   1032       1 systemd         /usr/lib/systemd/systemd --user",
  "3245060    1147 foot            foot --working-directory=/home/test -e herdr",
  "3245081 3245060 herdr           herdr",
  "1209822    1032 electron        /usr/lib/electron43/electron obsidian",
  "1209880 1209822 electron        /usr/lib/electron43/electron --type=renderer",
  "1268570 1209880 herdr           /usr/bin/herdr terminal session control w2:pA --takeover --cols 76",
  " 196156    1032 ghostty         /usr/bin/ghostty",
  " 196200  196156 zsh             -zsh",
  " 500000    1032 kitty           kitty",
  " 500001  500000 zsh             -zsh",
  " 500002  500001 herdr           herdr --session work",
  "2310729    1032 herdr           /usr/bin/herdr server"
].join("\n")

function client(address, pid, history, extra) {
  return Object.assign({ address, pid, class: "x", title: "t", workspace: { id: 1, name: "1" }, focusHistoryID: history, mapped: true, hidden: false }, extra || {})
}

test("parseProcesses reads pid, ppid, comm and args, and indexes children", () => {
  const p = Window.parseProcesses(PS)
  assert.equal(p.byPid.p3245081.comm, "herdr")
  assert.equal(p.byPid.p3245081.ppid, 3245060)
  assert.deepEqual(Array.from(p.children.p3245060), [3245081])
  assert.deepEqual(Array.from(p.byPid.p500002.args), ["herdr", "--session", "work"])
})

test("parseProcesses skips junk lines", () => {
  const p = Window.parseProcesses("garbage\n\n  x y z\n 12 1 sh sh -c true\n")
  assert.deepEqual(Object.keys(p.byPid), ["p12"])
  assert.deepEqual(Object.keys(Window.parseProcesses(null).byPid), [])
})

test("clientSocket maps interactive clients to their server socket", () => {
  assert.equal(Window.clientSocket(proc("herdr", "herdr"), HOME), SOCK)
  assert.equal(Window.clientSocket(proc("herdr", "/usr/bin/herdr --session work"), HOME),
    "/home/test/.config/herdr/sessions/work/herdr.sock")
  assert.equal(Window.clientSocket(proc("herdr", "herdr --session=work"), HOME),
    "/home/test/.config/herdr/sessions/work/herdr.sock")
  assert.equal(Window.clientSocket(proc("herdr", "herdr session attach work"), HOME),
    "/home/test/.config/herdr/sessions/work/herdr.sock")
})

test("clientSocket rejects subcommands, remote clients, other programs and unsafe session names", () => {
  for (const args of [
    "herdr terminal session control w2:pA --takeover",
    "herdr server",
    "herdr api snapshot",
    "herdr --remote host",
    "herdr --remote=host",
    "herdr --session",
    "herdr --session ../../etc",
    "herdr session list"
  ]) {
    assert.equal(Window.clientSocket(proc("herdr", args), HOME), "", args)
  }
  assert.equal(Window.clientSocket(proc("foot", "foot -e herdr"), HOME), "")
  assert.equal(Window.clientSocket(null, HOME), "")
})

test("hostsClient walks down from the window's pid", () => {
  const p = Window.parseProcesses(PS)
  assert.equal(Window.hostsClient(p, 3245060, SOCK, HOME), true)
  assert.equal(Window.hostsClient(p, 500000, SOCK, HOME), false, "kitty hosts a different session")
  assert.equal(Window.hostsClient(p, 500000, "/home/test/.config/herdr/sessions/work/herdr.sock", HOME), true)
  assert.equal(Window.hostsClient(p, 1209822, SOCK, HOME), false, "obsidian's pane-control client is not a host")
  assert.equal(Window.hostsClient(p, 196156, SOCK, HOME), false)
})

test("hostsClient survives a cycle and a missing table", () => {
  const p = Window.parseProcesses("10 11 sh sh\n11 10 sh sh\n")
  assert.equal(Window.hostsClient(p, 10, SOCK, HOME), false)
  assert.equal(Window.hostsClient(null, 10, SOCK, HOME), false)
  assert.equal(Window.hostsClient(p, 10, "", HOME), false)
})

test("parseClients keeps valid rows only", () => {
  const rows = Window.parseClients(JSON.stringify([
    client("0x5586edce94c0", 3245060, 3),
    client("0xZZ", 1, 0),
    client("0x1; rm -rf", 1, 0),
    { address: "0xabc", pid: "12" },
    client("0xabc", 7, -1),
    "junk"
  ]))
  assert.equal(rows.length, 2)
  assert.equal(rows[0].address, "0x5586edce94c0")
  assert.equal(rows[1].focusHistoryId, Number.MAX_SAFE_INTEGER)
  assert.deepEqual(Array.from(Window.parseClients("not json")), [])
  assert.deepEqual(Array.from(Window.parseClients("{}")), [])
})

test("selectHost picks the most recently focused window hosting our server", () => {
  const ps = PS + "\n 600000    1032 foot            foot\n 600001  600000 herdr           herdr"
  const clients = JSON.stringify([
    client("0xa1", 1209822, 1),                 // obsidian: not a host
    client("0xb2", 3245060, 4),                 // foot with herdr
    client("0xc3", 600000, 2),                  // second foot with herdr, more recent
    client("0xd4", 500000, 0)                   // kitty, other session
  ])
  const picked = Window.selectHost(clients, ps, SOCK, HOME)
  assert.equal(picked.candidates, 2)
  assert.equal(picked.window.address, "0xc3")
})

test("selectHost ignores unmapped windows and prefers visible over hidden ones", () => {
  const ps = PS + "\n 600000    1032 foot            foot\n 600001  600000 herdr           herdr"
  const clients = JSON.stringify([
    client("0xb2", 3245060, 4),
    client("0xc3", 600000, 1, { hidden: true }),
    client("0xe5", 3245060, 0, { mapped: false })
  ])
  assert.equal(Window.selectHost(clients, ps, SOCK, HOME).window.address, "0xb2")
})

test("selectHost returns no window when nothing hosts the server", () => {
  const picked = Window.selectHost(JSON.stringify([client("0xa1", 196156, 0)]), PS, SOCK, HOME)
  assert.equal(picked.window, null)
  assert.equal(picked.candidates, 0)
})

const WindowCursor = loadLib("lib/WindowPolicy.js")

test("the cursor position parses from hyprctl -j cursorpos", () => {
  assert.deepEqual({ ...WindowCursor.parseCursorPos('{\n    "x": 1712,\n    "y": 860\n}\n') }, { x: 1712, y: 860 })
  assert.deepEqual({ ...WindowCursor.parseCursorPos('{"x": 12.6, "y": -3}') }, { x: 13, y: -3 })
  for (const bad of ["", "nope", '{"x": "1", "y": 2}', '{"x": 1}', "[1, 2]", null, '{"x": 1e12, "y": 0}']) {
    assert.equal(WindowCursor.parseCursorPos(bad), null, String(bad))
  }
})

test("the cursor goes back only after a pointer click that focuses the window", () => {
  assert.equal(WindowCursor.restoresCursor("pointer", "window"), true)
  assert.equal(WindowCursor.restoresCursor("pointer", "herdr"), false)
  assert.equal(WindowCursor.restoresCursor("touch", "window"), false)
  assert.equal(WindowCursor.restoresCursor("", "window"), false)
})
