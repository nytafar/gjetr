.pragma library
.import "CommandPolicy.js" as CommandPolicy

// Focus behaviour `window`: which Hyprland toplevel hosts a herdr client
// attached to our server, and the command that brings it forward. Pure; the
// QML side runs the allowlisted commands and feeds their output back here.
//
// A window hosts a client when a `herdr` process attached to our socket runs
// somewhere below the window's pid. That covers `foot -e herdr`, a shell
// inside any terminal, and `herdr --session NAME`. Walking the process tree
// from each client window is the approach omaherdr describes
// (github.com/njpatel/omaherdr, Apache-2.0); no omaherdr code is used.
//
// Only interactive attach clients count. A herdr subcommand such as
// `herdr terminal session control <pane>` (obsidian-herdr's embedded pane) or
// `herdr api ...` also talks to the server, but focusing its window would not
// show the pane herdr just focused. `--remote` clients attach to another
// machine's server and never match a local socket.
//
// Ghostty and `foot --server` run every window from one process, so every
// window of that process matches. Choosing the most recently focused one is
// then a guess; omaherdr breaks that tie with herdr's window title.

var MAX_DEPTH = 32
var SESSION_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

function str(value) {
  return value === undefined || value === null ? "" : String(value)
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function isPid(value) {
  return typeof value === "number" && isFinite(value) && Math.floor(value) === value && value > 0
}

// ------------------------------------------------------------------ processes

// `ps -e -o pid=,ppid=,comm=,args=` -> { byPid, children }. comm is the
// executable name (at most 15 characters), which is what identifies herdr,
// rather than a word somewhere in another program's arguments (`foot -e herdr`).
function parseProcesses(text) {
  var byPid = {}
  var children = {}
  var lines = str(text).split("\n")
  for (var i = 0; i < lines.length; i++) {
    var match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s*(.*)$/.exec(lines[i])
    if (!match) continue
    var pid = Number(match[1])
    var ppid = Number(match[2])
    if (!isPid(pid) || byPid["p" + pid]) continue
    byPid["p" + pid] = { pid: pid, ppid: ppid, comm: match[3], args: match[4].trim().split(/\s+/).filter(Boolean) }
    var key = "p" + ppid
    if (!children[key]) children[key] = []
    children[key].push(pid)
  }
  return { byPid: byPid, children: children }
}

function herdrDir(home) {
  return str(home).replace(/\/+$/, "") + "/.config/herdr"
}

// The server socket a process is attached to as an interactive herdr client,
// or "" when it is not one. Mirrors herdr 0.8's socket layout:
// ~/.config/herdr/herdr.sock, ~/.config/herdr/sessions/<name>/herdr.sock.
function clientSocket(proc, home) {
  if (!isObject(proc) || proc.comm !== "herdr") return ""
  var args = Array.isArray(proc.args) ? proc.args.slice(1) : []
  var session = ""
  for (var i = 0; i < args.length; i++) {
    var arg = str(args[i])
    if (arg === "--remote" || arg.indexOf("--remote=") === 0) return ""
    if (arg === "--session") {
      session = str(args[++i])
      if (session === "") return ""
      continue
    }
    if (arg.indexOf("--session=") === 0) {
      session = arg.slice("--session=".length)
      continue
    }
    if (arg.charAt(0) === "-") continue
    // A positional word is a subcommand. Only `session attach <name>` attaches.
    if (arg === "session" && str(args[i + 1]) === "attach" && args[i + 2] !== undefined) {
      session = str(args[i + 2])
      i += 2
      continue
    }
    return ""
  }
  if (session === "") return herdrDir(home) + "/herdr.sock"
  if (!SESSION_RE.test(session)) return ""
  return herdrDir(home) + "/sessions/" + session + "/herdr.sock"
}

// Whether any process below rootPid, or rootPid itself, is a client of socket.
function hostsClient(processes, rootPid, socketPath, home) {
  if (!processes || !isObject(processes.byPid) || !isPid(rootPid) || str(socketPath) === "") return false
  var queue = [{ pid: rootPid, depth: 0 }]
  var seen = {}
  while (queue.length > 0) {
    var item = queue.shift()
    var key = "p" + item.pid
    if (seen[key]) continue
    seen[key] = true
    if (clientSocket(processes.byPid[key], home) === socketPath) return true
    if (item.depth >= MAX_DEPTH) continue
    var kids = processes.children[key] || []
    for (var i = 0; i < kids.length; i++) queue.push({ pid: kids[i], depth: item.depth + 1 })
  }
  return false
}

// ------------------------------------------------------------------ windows

// `hyprctl -j clients` -> the fields selection needs, with invalid rows dropped.
function parseClients(text) {
  var list
  try {
    list = JSON.parse(str(text))
  } catch (error) {
    return []
  }
  if (!Array.isArray(list)) return []
  var out = []
  for (var i = 0; i < list.length; i++) {
    var c = list[i]
    if (!isObject(c) || !CommandPolicy.isAddress(c.address) || !isPid(c.pid)) continue
    var history = typeof c.focusHistoryID === "number" && isFinite(c.focusHistoryID) && c.focusHistoryID >= 0
      ? c.focusHistoryID : Number.MAX_SAFE_INTEGER
    out.push({
      address: c.address,
      pid: c.pid,
      title: str(c.title),
      className: str(c["class"]),
      workspace: isObject(c.workspace) ? str(c.workspace.name) : "",
      focusHistoryId: history,
      mapped: c.mapped !== false,
      hidden: c.hidden === true
    })
  }
  return out
}

// Windows hosting a herdr client of socketPath, in Hyprland's order.
function hostWindows(clients, processes, socketPath, home) {
  var list = Array.isArray(clients) ? clients : []
  var out = []
  for (var i = 0; i < list.length; i++) {
    if (list[i].mapped && hostsClient(processes, list[i].pid, socketPath, home)) out.push(list[i])
  }
  return out
}

// The most recently focused host window, or null. Hidden windows (in a group
// behind another tab) rank after visible ones.
function chooseWindow(windows) {
  var list = Array.isArray(windows) ? windows : []
  var best = null
  for (var i = 0; i < list.length; i++) {
    var w = list[i]
    if (!best || (best.hidden && !w.hidden)
      || (best.hidden === w.hidden && w.focusHistoryId < best.focusHistoryId)) best = w
  }
  return best
}

// One step: process table and client list in, the window to focus out.
function selectHost(clientsText, processText, socketPath, home) {
  var windows = hostWindows(parseClients(clientsText), parseProcesses(processText), socketPath, home)
  return { window: chooseWindow(windows), candidates: windows.length }
}

// `hyprctl -j cursorpos` -> { x, y } in global logical pixels, or null.
function parseCursorPos(text) {
  if (typeof text !== "string" || text.length > 256) return null
  var value
  try {
    value = JSON.parse(text)
  } catch (error) {
    return null
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null
  if (typeof value.x !== "number" || typeof value.y !== "number" || !isFinite(value.x) || !isFinite(value.y)) return null
  var x = Math.round(value.x)
  var y = Math.round(value.y)
  return Math.abs(x) <= 100000 && Math.abs(y) <= 100000 ? { x: x, y: y } : null
}

// Focusing the hosting window moves the pointer there. After a click on a
// pointer Display (a Dock) with Focus behaviour `window`, the pointer goes
// back to where the click was; keyboard focus stays on the window. A touch
// surface never moves it.
function restoresCursor(input, focusMode) {
  return input === "pointer" && focusMode === "window"
}

if (typeof module !== "undefined") {
  module.exports = {
    parseCursorPos: parseCursorPos,
    restoresCursor: restoresCursor,
    MAX_DEPTH: MAX_DEPTH,
    parseProcesses: parseProcesses,
    clientSocket: clientSocket,
    hostsClient: hostsClient,
    parseClients: parseClients,
    hostWindows: hostWindows,
    chooseWindow: chooseWindow,
    selectHost: selectHost
  }
}
