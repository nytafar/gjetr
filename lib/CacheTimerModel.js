.pragma library

// Cache timers: the cache-ttl herdr plugin's state file -> a Cache timer with
// a level and a display label per Agent. Pure; the QML side watches the files
// and runs the display clock.
//
// Source of truth is the plugin (nytafar/herdr-cache-ttl 0.3.2, src/state.rs,
// src/config.rs, src/herdr.rs):
// - ~/.local/state/herdr/plugins/cache-ttl/timers.json, written atomically:
//   { "<pane_id>": { "last_turn": <unix seconds>, "ttl_seconds": <int> } }
// - remaining = ttl_seconds - (now - last_turn)
// - levels: critical when remaining <= crit_at, warn when <= warn_at, else ok
// - ~/.config/herdr/plugins/config/cache-ttl/config.json overlays positive
//   integer ttl_seconds, warn_at and crit_at (defaults 3600, 600, 300); a
//   mistyped field makes serde drop the whole overlay
// - only the `claude` kind is tracked
//
// Display format follows the PRD rather than the plugin's own label: whole
// minutes while ok, m:ss in warn and critical, `cold` once expired. The plugin
// switches to m:ss at its seconds_threshold (300) and shows `0m` when expired.

var DEFAULT_SETTINGS = { ttlSeconds: 3600, warnAt: 600, critAt: 300 }

// Agent kinds that have a prompt cache, as tracked by the plugin.
var CACHE_KINDS = ["claude"]

var LEVELS = ["ok", "warn", "critical", "cold"]

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function isInteger(value) {
  return typeof value === "number" && isFinite(value) && Math.floor(value) === value
}

function own(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key)
}

function parseJson(text) {
  if (text === undefined || text === null || String(text).trim() === "") return { value: null, error: "empty" }
  try {
    return { value: JSON.parse(String(text)), error: "" }
  } catch (error) {
    return { value: null, error: "invalid JSON: " + error.message }
  }
}

function copySettings(source) {
  return { ttlSeconds: source.ttlSeconds, warnAt: source.warnAt, critAt: source.critAt }
}

function parseSettings(text) {
  var settings = copySettings(DEFAULT_SETTINGS)
  var parsed = parseJson(text)
  if (!isObject(parsed.value)) return settings
  var fields = { ttl_seconds: "ttlSeconds", warn_at: "warnAt", crit_at: "critAt" }
  var picked = {}
  for (var key in fields) {
    if (!own(parsed.value, key) || parsed.value[key] === null) continue
    if (!isInteger(parsed.value[key])) return settings
    picked[fields[key]] = parsed.value[key]
  }
  for (var name in picked) if (picked[name] > 0) settings[name] = picked[name]
  return settings
}

function validSettings(settings) {
  return isObject(settings) && isInteger(settings.warnAt) && isInteger(settings.critAt) ? settings : DEFAULT_SETTINGS
}

// Malformed entries are skipped one by one, so a single bad record never hides
// every Cache timer.
function parseTimers(text) {
  var timers = {}
  var parsed = parseJson(text)
  if (parsed.error !== "") return { timers: timers, error: parsed.error }
  if (!isObject(parsed.value)) return { timers: timers, error: "timers file is not an object" }
  for (var paneId in parsed.value) {
    if (!own(parsed.value, paneId) || paneId === "" || paneId === "__proto__") continue
    var entry = parsed.value[paneId]
    if (!isObject(entry) || !isInteger(entry.last_turn) || !isInteger(entry.ttl_seconds) || entry.ttl_seconds <= 0) continue
    timers[paneId] = { lastTurn: entry.last_turn, ttlSeconds: entry.ttl_seconds }
  }
  return { timers: timers, error: "" }
}

function hasPromptCache(kind) {
  return CACHE_KINDS.indexOf(String(kind === undefined || kind === null ? "" : kind)) >= 0
}

function nowSeconds(milliseconds) {
  return Math.floor(Number(milliseconds) / 1000)
}

function remainingSeconds(timer, now) {
  return Math.min(timer.ttlSeconds, timer.ttlSeconds - (now - timer.lastTurn))
}

function level(remaining, settings) {
  var s = validSettings(settings)
  if (remaining <= 0) return "cold"
  if (remaining <= s.critAt) return "critical"
  if (remaining <= s.warnAt) return "warn"
  return "ok"
}

function pad2(value) {
  return value < 10 ? "0" + value : String(value)
}

function formatRemaining(remaining, levelName) {
  if (levelName === "cold" || remaining <= 0) return "cold"
  if (levelName === "ok") return Math.floor(remaining / 60) + "m"
  return Math.floor(remaining / 60) + ":" + pad2(remaining % 60)
}

function timerFor(agent, timers) {
  if (!isObject(agent) || !isObject(timers) || !hasPromptCache(agent.kind)) return null
  var paneId = String(agent.paneId || "")
  return paneId !== "" && own(timers, paneId) ? timers[paneId] : null
}

// The Cache timer Field for one Agent, or null when it has none.
function cacheTimer(agent, timers, now, settings) {
  var timer = timerFor(agent, timers)
  if (!timer) return null
  var remaining = remainingSeconds(timer, now)
  var name = level(remaining, settings)
  return { remaining: remaining, level: name, label: formatRemaining(remaining, name) }
}

// paneId -> remaining seconds, for the cache Sort mode.
function remainingByPane(agents, timers, now) {
  var out = {}
  var list = Array.isArray(agents) ? agents : []
  for (var i = 0; i < list.length; i++) {
    var timer = timerFor(list[i], timers)
    if (timer) out[list[i].paneId] = remainingSeconds(timer, now)
  }
  return out
}

// Whether any shown Cache timer is still counting, i.e. the display clock
// needs to tick.
function hasLiveTimer(agents, timers, now) {
  var remaining = remainingByPane(agents, timers, now)
  for (var paneId in remaining) if (remaining[paneId] > 0) return true
  return false
}

if (typeof module !== "undefined") {
  module.exports = {
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    CACHE_KINDS: CACHE_KINDS,
    LEVELS: LEVELS,
    parseSettings: parseSettings,
    parseTimers: parseTimers,
    hasPromptCache: hasPromptCache,
    nowSeconds: nowSeconds,
    remainingSeconds: remainingSeconds,
    level: level,
    formatRemaining: formatRemaining,
    cacheTimer: cacheTimer,
    remainingByPane: remainingByPane,
    hasLiveTimer: hasLiveTimer
  }
}
