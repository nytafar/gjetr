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

// Seconds between refreshes with Usage Modules on several Displays: each
// Deck's own interval (its Modules', else its Display's), the smallest winning.
// A Deck without a Usage Module does not count.
// decks: [{ displaySeconds, modules }] with each Deck's Usage Modules.
function deckRefreshSeconds(decks) {
  var list = Array.isArray(decks) ? decks : []
  var best = 0
  for (var i = 0; i < list.length; i++) {
    var deck = list[i]
    if (!deck || !Array.isArray(deck.modules) || deck.modules.length === 0) continue
    var value = refreshSeconds(deck.displaySeconds, deck.modules)
    if (best === 0 || value < best) best = value
  }
  return best > 0 ? best : DEFAULT_REFRESH_SECONDS
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

// ------------------------------------------------------------------ compact

// For a small space: one line per limit with a short code instead of the
// label, the percent as a bare number, the time to reset as "3h", and the
// share of the limit's window already gone, so a meter can mark where usage
// would be at an even pace.

var MINUTE_MS = 60000
var HOUR_MS = 3600000
var DAY_MS = 86400000
var WINDOW_RE = /(\d{1,3})\s*-?\s*(minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|wks?|w)\b/i
var WINDOW_RE_ALL = /(\d{1,3})\s*-?\s*(minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|wks?|w)\b/gi
var WINDOW_WORDS = { hourly: [1, "h"], daily: [1, "d"], weekly: [7, "d"], monthly: [30, "d"] }
// Words that describe the window rather than what the limit covers.
var GENERIC_WORDS = ["session", "hourly", "daily", "weekly", "monthly", "window", "limit", "limits", "usage", "rate",
  "total", "overall", "burst", "rolling", "per", "the", "a"]
var MAX_CODE = 4

// Label -> { count, unit ("m", "h", "d") } or null.
function limitWindow(label) {
  var text = cleanText(label, 40)
  var match = WINDOW_RE.exec(text)
  if (match) {
    var n = Number(match[1])
    var unit = match[2].charAt(0).toLowerCase()
    if (n <= 0) return null
    if (unit === "w") return { count: n * 7, unit: "d" }
    return { count: n, unit: unit }
  }
  var words = text.toLowerCase().split(/[^a-z]+/)
  for (var i = 0; i < words.length; i++) {
    if (own(WINDOW_WORDS, words[i])) return { count: WINDOW_WORDS[words[i]][0], unit: WINDOW_WORDS[words[i]][1] }
  }
  return null
}

// "Session (5-hour)" -> "5h", "Weekly (7-day)" -> "7d", "Fable Weekly" ->
// "F7d" (the initial of what the limit covers, then its window). A label
// without a window keeps its first three letters.
function limitCode(label) {
  var text = cleanText(label, 40)
  if (text === "") return "?"
  var window = limitWindow(text)
  if (!window) {
    var letters = text.replace(/[^A-Za-z0-9]/g, "")
    return letters === "" ? "?" : letters.charAt(0).toUpperCase() + letters.slice(1, 3)
  }
  var code = window.count + window.unit
  var words = text.replace(/\([^)]*\)/g, " ").replace(WINDOW_RE_ALL, " ").split(/[^A-Za-z]+/)
  for (var i = 0; i < words.length; i++) {
    if (words[i] === "" || GENERIC_WORDS.indexOf(words[i].toLowerCase()) >= 0) continue
    var scoped = words[i].charAt(0).toUpperCase() + code
    return scoped.length <= MAX_CODE ? scoped : code.slice(0, MAX_CODE)
  }
  return code.slice(0, MAX_CODE)
}

// The length of a limit's window from its label, or 0 when it names none.
function windowMs(label) {
  var window = limitWindow(label)
  if (!window) return 0
  return window.count * (window.unit === "m" ? MINUTE_MS : window.unit === "h" ? HOUR_MS : DAY_MS)
}

// The share of a window already gone (0..1), or -1 when it is not known.
function elapsedFraction(resetsAtMs, lengthMs, nowMs) {
  if (!(resetsAtMs > 0) || !(lengthMs > 0)) return -1
  return Math.max(0, Math.min(1, 1 - (resetsAtMs - nowMs) / lengthMs))
}

// "ahead" when usage runs clearly ahead of the time gone in its window.
var PACE_SLACK = 0.1

function pace(fraction, elapsed) {
  if (typeof elapsed !== "number" || elapsed < 0 || typeof fraction !== "number" || !isFinite(fraction)) return ""
  return fraction > elapsed + PACE_SLACK ? "ahead" : ""
}

function percentNumber(fraction) {
  return typeof fraction === "number" && isFinite(fraction) && fraction >= 0 ? String(Math.round(fraction * 100)) : "–"
}

// The largest whole unit: "<1m", "42m", "3h", "5d".
function shortDuration(ms) {
  var minutes = Math.floor(Math.max(0, Number(ms) || 0) / MINUTE_MS)
  if (minutes < 1) return "<1m"
  if (minutes < 60) return minutes + "m"
  var hours = Math.floor(minutes / 60)
  return hours < 24 ? hours + "h" : Math.floor(hours / 24) + "d"
}

function resetShort(resetsAtMs, nowMs) {
  if (!(resetsAtMs > 0)) return ""
  var left = resetsAtMs - nowMs
  return left <= 0 ? "now" : shortDuration(left)
}

// Two letters for a provider without a mark of its own: "Cl", "Co".
function providerMark(provider) {
  if (!isObject(provider)) return "?"
  var letters = (cleanText(provider.name, 40) || cleanText(provider.id, 32)).replace(/[^A-Za-z0-9]/g, "")
  return letters === "" ? "?" : letters.charAt(0).toUpperCase() + letters.slice(1, 2).toLowerCase()
}

// The shown providers as compact lines, in order: one "limit" line per limit,
// or one quiet "status" line for a provider that is not ready or reports no
// limits. `first` marks a provider's first line.
function compactLimits(providers, nowMs, refresh) {
  var out = []
  var list = asList(providers)
  for (var i = 0; i < list.length; i++) {
    var provider = list[i]
    if (!isObject(provider) || !isProviderId(provider.id)) continue
    var mark = providerMark(provider)
    var stale = provider.ready === true && isStale(provider.updatedAtMs, nowMs, refresh)
    var limits = provider.ready === true ? asList(provider.limits) : []
    if (limits.length === 0) {
      out.push({ key: provider.id + "#status", providerId: provider.id, mark: mark, kind: "status", first: true, code: "",
        label: "", fraction: -1, percent: "", level: "unknown", elapsed: -1, pace: "", reset: "", resetsAtMs: 0, stale: stale,
        text: provider.ready === true ? "no limits reported" : (cleanText(provider.statusText, 80) || "not ready") })
      continue
    }
    for (var j = 0; j < limits.length; j++) {
      var limit = limits[j]
      if (!isObject(limit)) continue
      var elapsed = elapsedFraction(limit.resetsAtMs, windowMs(limit.label), nowMs)
      out.push({ key: provider.id + "#" + j, providerId: provider.id, mark: mark, kind: "limit", first: j === 0,
        code: limitCode(limit.label), label: cleanText(limit.label, 40), fraction: limit.fraction,
        percent: percentNumber(limit.fraction), level: limitLevel(limit.fraction), elapsed: elapsed,
        pace: pace(limit.fraction, elapsed), reset: resetShort(limit.resetsAtMs, nowMs),
        resetsAtMs: limit.resetsAtMs > 0 ? limit.resetsAtMs : 0, stale: stale, text: "" })
    }
  }
  return out
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
    deckRefreshSeconds: deckRefreshSeconds,
    limitLevel: limitLevel,
    formatPercent: formatPercent,
    formatTokens: formatTokens,
    formatDuration: formatDuration,
    resetLabel: resetLabel,
    ageLabel: ageLabel,
    isStale: isStale,
    limitCode: limitCode,
    windowMs: windowMs,
    elapsedFraction: elapsedFraction,
    pace: pace,
    percentNumber: percentNumber,
    shortDuration: shortDuration,
    resetShort: resetShort,
    providerMark: providerMark,
    compactLimits: compactLimits,
    dayBars: dayBars
  }
}
