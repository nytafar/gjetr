.pragma library

// Usage: AI agent usage and rate limits per provider, for the Usage Module.
// A Source reads one tool's records; this file turns each into the same
// provider-neutral shape, so the Module never knows where numbers came from
// and a second Source (ai-usagebar) only adds a normaliser here
// (ADR 0002). Pure.
//
// Provider:
//   { id, source, name, tier, ready, statusText, updatedAtMs,
//     limits: [{ label, fraction (0..1), resetsAtMs }],
//     today: { tokens, prompts, sessions, hasPrompts },
//     recentDays: [{ date "YYYY-MM-DD", tokens }],
//     models: [{ id, name, tokens }] }   today's tokens by model, largest first
//
// Records are untrusted: numbers are checked, text is cleaned and capped.

var SHOW_ITEMS = ["limits", "today", "recent_days", "models"]
var DEFAULT_SHOW = ["limits"]
var DEFAULT_REFRESH_SECONDS = 900
var MIN_REFRESH_SECONDS = 60
var MAX_REFRESH_SECONDS = 86400
// Meter levels, by the share of a limit used.
var WARN_AT = 0.75
var CRITICAL_AT = 0.9
var MAX_BYTES = 262144
var MAX_LIMITS = 8
var MAX_MODELS = 16
var MAX_DAYS = 31
var MAX_PROVIDERS = 16

var PROVIDER_ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/
var DATE_RE = /^\d{4}-\d{2}-\d{2}$/
var UNSAFE_RE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]+/g
var WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]

function str(value) {
  return value === undefined || value === null ? "" : String(value)
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function own(object, key) {
  return isObject(object) && Object.prototype.hasOwnProperty.call(object, key)
}

// A list as an array. Lists handed back from QML (a Repeater's modelData, a
// property read through C++) can arrive as array-like sequences, for which
// Array.isArray is false.
function asList(value) {
  if (Array.isArray(value)) return value
  if (value === null || typeof value !== "object" || typeof value.length !== "number") return []
  var length = Math.floor(value.length)
  if (!isFinite(length) || length <= 0) return []
  var out = []
  for (var i = 0; i < Math.min(length, 1000); i++) out.push(value[i])
  return out
}

function isProviderId(value) {
  return typeof value === "string" && PROVIDER_ID_RE.test(value)
}

function cleanText(value, max) {
  var text = typeof value === "string" || typeof value === "number" ? str(value) : ""
  text = text.replace(UNSAFE_RE, " ").replace(/\s+/g, " ").trim()
  return text.length > max ? text.slice(0, max - 1).trim() + "…" : text
}

function count(value) {
  var n = Number(value)
  return typeof value === "number" && isFinite(n) && n > 0 ? Math.round(n) : 0
}

function timeMs(value) {
  if (typeof value !== "string" || value.length > 64) return 0
  var ms = Date.parse(value)
  return isFinite(ms) && ms > 0 ? ms : 0
}

// ------------------------------------------------------------------ Omarchy

// Where omarchy-agent-usage-update writes: $XDG_STATE_HOME or ~/.local/state.
function usageDir(home, xdgStateHome) {
  var state = str(xdgStateHome)
  var base = state.charAt(0) === "/" ? state.replace(/\/+$/, "") : str(home).replace(/\/+$/, "") + "/.local/state"
  return base + "/omarchy/agents/usage"
}

// `find -printf "%f\n"` of the usage directory -> provider ids, sorted. The
// script's own temporary files (".claude.XXXXXX") are not ids.
function parseListing(text) {
  var ids = []
  var lines = str(text).split("\n")
  for (var i = 0; i < lines.length; i++) {
    var name = lines[i].trim()
    if (name.slice(-5) !== ".json") continue
    var id = name.slice(0, -5)
    if (isProviderId(id) && ids.indexOf(id) < 0) ids.push(id)
  }
  return ids.sort().slice(0, MAX_PROVIDERS)
}

// Model ids arrive hyphenated with the version split into segments
// (claude-opus-4-8, gpt-5.6-sol): the numeric run is joined into one version
// and the words around it capitalised. Same idea as Omarchy's agents panel.
function modelName(id) {
  var text = cleanText(id, 64).toLowerCase()
  if (text === "") return "Unknown"
  var parts = text.replace(/^claude-/, "").replace(/-\d{8}$/, "").split(/[-_\s]+/)
  var words = []
  var version = []
  for (var i = 0; i < parts.length; i++) {
    if (parts[i] === "") continue
    if (/^\d+(\.\d+)*$/.test(parts[i])) {
      version.push(parts[i])
      continue
    }
    if (version.length > 0) words.push(version.join("."))
    version = []
    words.push(parts[i] === "gpt" ? "GPT" : parts[i].charAt(0).toUpperCase() + parts[i].slice(1))
  }
  if (version.length > 0) words.push(version.join("."))
  return words.length > 0 ? words.join(" ") : "Unknown"
}

function readLimits(list) {
  var out = []
  var source = Array.isArray(list) ? list : []
  for (var i = 0; i < source.length && out.length < MAX_LIMITS; i++) {
    var entry = source[i]
    if (!isObject(entry) || typeof entry.percent !== "number" || !isFinite(entry.percent) || entry.percent < 0) continue
    out.push({
      label: cleanText(entry.label, 40) || cleanText(entry.title, 40) || "Limit",
      fraction: Math.min(1, entry.percent),
      resetsAtMs: timeMs(entry.resetsAt)
    })
  }
  return out
}

// Omarchy calls the field messageCount, but its collectors write token totals.
function readDays(list) {
  var byDate = {}
  var source = Array.isArray(list) ? list : []
  for (var i = 0; i < source.length; i++) {
    var day = source[i]
    if (!isObject(day) || typeof day.date !== "string" || !DATE_RE.test(day.date)) continue
    byDate[day.date] = count(day.messageCount)
  }
  return Object.keys(byDate).sort().slice(-MAX_DAYS).map(function(date) { return { date: date, tokens: byDate[date] } })
}

function readModels(map) {
  var out = []
  if (!isObject(map)) return out
  var keys = Object.keys(map)
  for (var i = 0; i < keys.length; i++) {
    var tokens = count(map[keys[i]])
    var id = cleanText(keys[i], 64)
    if (tokens > 0 && id !== "") out.push({ id: id, name: modelName(id), tokens: tokens })
  }
  out.sort(function(a, b) { return (b.tokens - a.tokens) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) })
  return out.slice(0, MAX_MODELS)
}

// One record of omarchy-agent-usage-update (schemaVersion 1) -> a provider,
// or null. The file name is the id, as it is for Omarchy's own panel.
function fromOmarchy(record, fileId) {
  if (!isObject(record) || !isProviderId(fileId)) return null
  return {
    id: fileId,
    source: "omarchy",
    name: cleanText(record.name, 40) || fileId,
    tier: cleanText(record.tierLabel, 24),
    ready: record.ready === true,
    statusText: cleanText(record.usageStatusText, 80),
    updatedAtMs: timeMs(record.updatedAt),
    limits: readLimits(record.limits),
    today: {
      tokens: count(record.todayTotalTokens),
      prompts: count(record.todayPrompts),
      sessions: count(record.todaySessions),
      hasPrompts: record.hasPromptStats !== false
    },
    recentDays: readDays(record.recentDays),
    models: readModels(record.todayTokensByModel)
  }
}

// File text -> { provider, error }.
function parseOmarchyRecord(text, fileId) {
  var source = str(text)
  if (source.trim() === "") return { provider: null, error: "empty" }
  if (source.length > MAX_BYTES) return { provider: null, error: "too large (" + source.length + " bytes)" }
  var value
  try {
    value = JSON.parse(source)
  } catch (error) {
    return { provider: null, error: "invalid JSON" }
  }
  var provider = fromOmarchy(value, fileId)
  return provider ? { provider: provider, error: "" } : { provider: null, error: "not a usage record" }
}

// ------------------------------------------------------------------ choosing

// The providers a Module shows, in order. Without a filter: every ready one,
// by id. With one: the named providers in its order, ready or not, and a quiet
// placeholder for a name with no record yet.
function visibleProviders(providers, filter) {
  var map = isObject(providers) ? providers : {}
  var wanted = asList(filter).filter(isProviderId)
  if (wanted.length === 0) {
    return Object.keys(map).filter(function(id) { return own(map, id) && isObject(map[id]) && map[id].ready === true })
      .sort().map(function(id) { return map[id] })
  }
  var out = []
  for (var i = 0; i < wanted.length; i++) {
    if (out.some(function(p) { return p.id === wanted[i] })) continue
    if (own(map, wanted[i]) && isObject(map[wanted[i]])) out.push(map[wanted[i]])
    else out.push(placeholder(wanted[i]))
  }
  return out
}

function placeholder(id) {
  return { id: id, source: "", name: id, tier: "", ready: false, statusText: "no usage data", updatedAtMs: 0, limits: [],
    today: { tokens: 0, prompts: 0, sessions: 0, hasPrompts: false }, recentDays: [], models: [] }
}

// The refresh interval for a Deck: the smallest refresh_seconds any Usage
// Module sets, else the Display's, else the default.
function refreshSeconds(displaySeconds, modules) {
  var list = Array.isArray(modules) ? modules : []
  var best = 0
  for (var i = 0; i < list.length; i++) {
    var value = list[i] ? list[i].refreshSeconds : null
    if (typeof value === "number" && isFinite(value) && value >= MIN_REFRESH_SECONDS && (best === 0 || value < best)) best = value
  }
  if (best > 0) return best
  if (typeof displaySeconds === "number" && isFinite(displaySeconds) && displaySeconds >= MIN_REFRESH_SECONDS) return displaySeconds
  return DEFAULT_REFRESH_SECONDS
}

// ------------------------------------------------------------------ display

function limitLevel(fraction) {
  if (typeof fraction !== "number" || !isFinite(fraction) || fraction < 0) return "unknown"
  if (fraction >= CRITICAL_AT) return "critical"
  if (fraction >= WARN_AT) return "warn"
  return "ok"
}

function formatPercent(fraction) {
  return typeof fraction === "number" && isFinite(fraction) && fraction >= 0 ? Math.round(fraction * 100) + "%" : "–"
}

function oneDecimal(value) {
  return value.toFixed(1).replace(/\.0$/, "")
}

function formatTokens(value) {
  var n = count(value)
  if (n >= 1e9) return oneDecimal(n / 1e9) + "B"
  if (n >= 1e6) return oneDecimal(n / 1e6) + "M"
  if (n >= 1e3) return oneDecimal(n / 1e3) + "K"
  return String(n)
}

function formatDuration(ms) {
  var minutes = Math.floor(Math.max(0, Number(ms) || 0) / 60000)
  if (minutes < 1) return "<1m"
  if (minutes < 60) return minutes + "m"
  var hours = Math.floor(minutes / 60)
  if (hours < 24) return hours + "h" + (minutes % 60 > 0 ? " " + (minutes % 60) + "m" : "")
  var days = Math.floor(hours / 24)
  return days + "d" + (hours % 24 > 0 ? " " + (hours % 24) + "h" : "")
}

function resetLabel(resetsAtMs, nowMs) {
  if (!(resetsAtMs > 0)) return ""
  var left = resetsAtMs - nowMs
  return left <= 0 ? "resets now" : "resets in " + formatDuration(left)
}

function ageLabel(updatedAtMs, nowMs) {
  if (!(updatedAtMs > 0)) return ""
  var age = nowMs - updatedAtMs
  return age < 60000 ? "updated just now" : "updated " + formatDuration(age) + " ago"
}

// A record older than two refreshes (and two minutes of slack) is stale.
function isStale(updatedAtMs, nowMs, refresh) {
  if (!(updatedAtMs > 0)) return true
  var seconds = typeof refresh === "number" && refresh > 0 ? refresh : DEFAULT_REFRESH_SECONDS
  return nowMs - updatedAtMs > (2 * seconds + 120) * 1000
}

// The last `days` days as bars: weekday label and height as a share of the
// busiest day.
function dayBars(recentDays, days) {
  var n = Math.max(1, Math.min(MAX_DAYS, Math.floor(Number(days) || 7)))
  var list = asList(recentDays).filter(function(day) {
    return isObject(day) && DATE_RE.test(str(day.date))
  }).slice(-n)
  var max = 0
  for (var i = 0; i < list.length; i++) max = Math.max(max, count(list[i].tokens))
  return list.map(function(day) {
    var parts = day.date.split("-")
    var weekday = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]))).getUTCDay()
    return { date: day.date, label: WEEKDAYS[weekday] || "", tokens: count(day.tokens), fraction: max > 0 ? count(day.tokens) / max : 0 }
  })
}

if (typeof module !== "undefined") {
  module.exports = {
    SHOW_ITEMS: SHOW_ITEMS,
    DEFAULT_SHOW: DEFAULT_SHOW,
    DEFAULT_REFRESH_SECONDS: DEFAULT_REFRESH_SECONDS,
    MIN_REFRESH_SECONDS: MIN_REFRESH_SECONDS,
    MAX_REFRESH_SECONDS: MAX_REFRESH_SECONDS,
    MAX_PROVIDERS: MAX_PROVIDERS,
    WARN_AT: WARN_AT,
    CRITICAL_AT: CRITICAL_AT,
    isProviderId: isProviderId,
    usageDir: usageDir,
    parseListing: parseListing,
    modelName: modelName,
    fromOmarchy: fromOmarchy,
    parseOmarchyRecord: parseOmarchyRecord,
    visibleProviders: visibleProviders,
    refreshSeconds: refreshSeconds,
    limitLevel: limitLevel,
    formatPercent: formatPercent,
    formatTokens: formatTokens,
    formatDuration: formatDuration,
    resetLabel: resetLabel,
    ageLabel: ageLabel,
    isStale: isStale,
    dayBars: dayBars
  }
}
