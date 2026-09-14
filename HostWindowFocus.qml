import QtQuick
import "lib/CommandPolicy.js" as CommandPolicy
import "lib/WindowPolicy.js" as WindowPolicy
import "lib/LatestPolicy.js" as LatestPolicy

// Focus behaviour `window`: after herdr focused a pane, brings the terminal
// window hosting a herdr client of our server forward, and after a click from
// a pointer Display puts the pointer back where it was. A newer request
// supersedes an older one (LatestPolicy). Selection is lib/WindowPolicy.js;
// every command is allowlisted in lib/CommandPolicy.js.
QtObject {
  id: root

  // The service's CommandRunner.
  property var commands: null
  property string socketPath: ""
  property string home: ""

  // The last attempt: { requests, window, workspace, candidates, error, cursor }.
  readonly property var result: current
  property var current: ({ requests: 0, window: "", workspace: "", candidates: 0, error: "", cursor: "" })

  property var cursorGuard: ({ sequence: 0 })
  property var focusGuard: ({ sequence: 0 })
  // Whether the focus in flight puts the pointer back, and where it was.
  property bool cursorWanted: false
  property var cursor: null

  function log(message) {
    console.info("[gjetr] window focus: " + message)
  }

  // When a tap or click comes: read where the pointer is now if this focus
  // puts it back (WindowPolicy.restoresCursor), so focus() can.
  function prepare(restoreCursor) {
    var started = LatestPolicy.start(cursorGuard)
    cursorGuard = started.guard
    var token = started.token
    cursorWanted = !!restoreCursor
    cursor = null
    if (!cursorWanted) return
    commands.run(CommandPolicy.CURSOR_POS, function(text, code) {
      if (!LatestPolicy.accepts(root.cursorGuard, token)) return
      root.cursor = code === 0 ? WindowPolicy.parseCursorPos(text) : null
    })
  }

  // After herdr focused a pane: find the most recently focused Hyprland window
  // hosting a herdr client of our server, and focus it, which also switches
  // to its workspace.
  function focus() {
    var started = LatestPolicy.start(focusGuard)
    focusGuard = started.guard
    var token = started.token
    var parts = { clients: null, processes: null }
    var socket = socketPath
    var restoreCursor = cursorWanted

    function report(fields) {
      var next = { requests: root.current.requests, window: "", workspace: "", candidates: 0, error: "", cursor: "" }
      for (var key in fields) next[key] = fields[key]
      root.current = next
      if (next.error !== "") root.log(next.error)
    }

    function select() {
      if (!LatestPolicy.accepts(root.focusGuard, token) || parts.clients === null || parts.processes === null) return
      var picked = WindowPolicy.selectHost(parts.clients, parts.processes, socket, root.home)
      if (!picked.window) {
        report({ error: "no window hosts a herdr client of " + socket })
        return
      }
      var chosen = picked.window
      root.commands.run(CommandPolicy.focusWindow(chosen.address), function(text, code) {
        if (!LatestPolicy.accepts(root.focusGuard, token)) return
        var ok = code === 0 && String(text).trim() === "ok"
        var fields = { window: chosen.address, workspace: chosen.workspace, candidates: picked.candidates,
          error: ok ? "" : "dispatch failed (" + code + "): " + String(text).trim().slice(0, 120) }
        if (!ok || !restoreCursor) {
          report(fields)
          return
        }
        // Focusing moved the pointer to the window; put it back on the Dock.
        var at = root.cursor
        var argv = at ? CommandPolicy.moveCursor(at.x, at.y) : []
        if (argv.length === 0) {
          fields.cursor = "position unknown"
          report(fields)
          root.log("cursor not restored, position unknown")
          return
        }
        root.commands.run(argv, function(result, exitCode) {
          if (!LatestPolicy.accepts(root.focusGuard, token)) return
          var moved = exitCode === 0 && String(result).trim() === "ok"
          fields.cursor = moved ? "restored " + at.x + "," + at.y : "move failed (" + exitCode + ")"
          report(fields)
          if (!moved) root.log("cursor " + fields.cursor)
        })
      })
    }

    current = { requests: current.requests + 1, window: "", workspace: "", candidates: 0, error: "", cursor: "" }
    commands.run(CommandPolicy.CLIENTS, function(text, code) {
      parts.clients = code === 0 ? text : "[]"
      select()
    })
    commands.run(CommandPolicy.PROCESSES, function(text, code) {
      parts.processes = code === 0 ? text : ""
      select()
    })
  }
}
