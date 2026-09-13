.pragma library

// Every process gjetr starts, as an allowlist of exact argv shapes. Builders
// return [] for a value outside its allowlist, and the QML runner refuses any
// argv that `allowed` does not accept, so Config or herdr data can never add
// an argument, a shell word or a Lua expression. Commands never pass through
// a shell.

var PROCESSES = ["ps", "-e", "-o", "pid=,ppid=,comm=,args="]
var CLIENTS = ["hyprctl", "-j", "clients"]

var ADDRESS_RE = /^0x[0-9a-f]{1,16}$/

function isAddress(value) {
  return typeof value === "string" && ADDRESS_RE.test(value)
}

function same(a, b) {
  if (!Array.isArray(a) || a.length !== b.length) return false
  for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

// Focus a window by address. Hyprland switches to the window's workspace
// (and its monitor) as part of focusing it.
function focusWindow(address) {
  if (!isAddress(address)) return []
  return ["hyprctl", "dispatch", "hl.dsp.focus({ window = \"address:" + address + "\" })"]
}

var FOCUS_RE = /^hl\.dsp\.focus\(\{ window = "address:0x[0-9a-f]{1,16}" \}\)$/

function allowed(argv) {
  if (!Array.isArray(argv) || argv.length === 0) return false
  for (var i = 0; i < argv.length; i++) if (typeof argv[i] !== "string") return false
  if (same(argv, PROCESSES) || same(argv, CLIENTS)) return true
  if (argv.length === 3 && argv[0] === "hyprctl" && argv[1] === "dispatch" && FOCUS_RE.test(argv[2])) return true
  return false
}

if (typeof module !== "undefined") {
  module.exports = {
    PROCESSES: PROCESSES,
    CLIENTS: CLIENTS,
    isAddress: isAddress,
    focusWindow: focusWindow,
    allowed: allowed
  }
}
