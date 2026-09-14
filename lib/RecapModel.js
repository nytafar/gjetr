.pragma library
.import "CommandPolicy.js" as CommandPolicy

// Recap: the latest session recap Claude Code wrote for an Agent's session.
// Claude appends it to ~/.claude/projects/<project-dir>/<session-id>.jsonl as
//   {"type":"system","subtype":"away_summary","content":"...","timestamp":"...",...}
// and herdr names the session in the Agent's agent_session (kind "id").
// Pure. `step` is the whole pipeline (ADR 0003): it locates, watches and greps
// the files through lib/CommandPolicy.js, and PipelineDriver.qml runs the
// commands it returns and feeds the replies back. Transcript content is untrusted text: control and
// bidirectional-override characters are removed, whitespace collapsed and
// length capped, and the Card renders it as plain text.
//
// With recap = "expand", a Recap opens either inside its Card (recap_open =
// "card") or over the list ("overlay"). Which Cards are open is session state
// the service holds per Module key and pane id; it is never written anywhere.

var MODES = ["off", "inline", "expand"]
var DEFAULT_MODE = "off"
var MAX_CHARS = 1200
var OPEN_MODES = ["card", "overlay"]
var DEFAULT_OPEN = "card"

var SESSION_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
var CONTROL_RE = /[\u0000-\u001f\u007f]/
var UNSAFE_RE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]+/g

function str(value) {
  return value === undefined || value === null ? "" : String(value)
}

function isSessionId(value) {
  return typeof value === "string" && SESSION_RE.test(value)
}

function projectsDir(home) {
  return str(home).replace(/\/+$/, "") + "/.claude/projects"
}

// Whether `path` is <projectsDir>/<one directory>/<sessionId>.jsonl.
function isTranscriptPath(path, dir, sessionId) {
  var value = str(path)
  var prefix = str(dir) + "/"
  if (!isSessionId(sessionId) || value.indexOf(prefix) !== 0) return false
  var rest = value.slice(prefix.length)
  var slash = rest.indexOf("/")
  if (slash <= 0) return false
  var project = rest.slice(0, slash)
  if (project === "." || project === ".." || CONTROL_RE.test(project)) return false
  return rest.slice(slash + 1) === sessionId + ".jsonl"
}

// `find` output -> the transcript path for the session, or "".
function parseLocate(text, dir, sessionId) {
  var lines = str(text).split("\n")
  for (var i = 0; i < lines.length; i++) {
    if (isTranscriptPath(lines[i], dir, sessionId)) return lines[i]
  }
  return ""
}

// `stat -c "%Y %s %n"` output -> { path: "mtime size" } for known paths.
function parseStat(text, paths) {
  var wanted = {}
  var list = Array.isArray(paths) ? paths : []
  for (var i = 0; i < list.length; i++) wanted[list[i]] = true
  var out = {}
  var lines = str(text).split("\n")
  for (var j = 0; j < lines.length; j++) {
    var match = /^(\d+) (\d+) (.+)$/.exec(lines[j])
    if (match && Object.prototype.hasOwnProperty.call(wanted, match[3])) out[match[3]] = match[1] + " " + match[2]
  }
  return out
}

function clean(text) {
  var value = str(text).replace(UNSAFE_RE, " ").replace(/\s+/g, " ").trim()
  return value.length > MAX_CHARS ? value.slice(0, MAX_CHARS - 1).trim() + "\u2026" : value
}

// grep output (away_summary lines of one transcript) -> the latest Recap, or
// null. Lines that do not parse, belong to another session, or carry no text
// are skipped, so a partial or hostile line never replaces a good Recap.
function latestRecap(text, sessionId) {
  var lines = str(text).split("\n")
  for (var i = lines.length - 1; i >= 0; i--) {
    var line = lines[i].trim()
    if (line === "") continue
    var value
    try {
      value = JSON.parse(line)
    } catch (error) {
      continue
    }
    if (!value || typeof value !== "object" || value.type !== "system" || value.subtype !== "away_summary") continue
    if (sessionId !== undefined && value.sessionId !== undefined && value.sessionId !== sessionId) continue
    var body = clean(value.content)
    if (body === "") continue
    return { text: body, timestamp: typeof value.timestamp === "string" ? value.timestamp.slice(0, 40) : "" }
  }
  return null
}

// ------------------------------------------------------------------ pipeline
//
// state: { dir: the projects dir, paths: { session: transcript },
//   located: { session: ms of the last find }, stamps: { transcript: "mtime
//   size" }, recaps: { session: Recap }, polling: a stat in flight,
//   sessions: the Claude sessions of the last Agents }
// events: { type: "agents", agents }, { type: "tick" },
//   { type: "reply", id, text, code } with ids "locate:<session>", "stat" and
//   "grep:<session>"
// -> { state, commands: [{ id, argv }] }. Nothing changed: the same state. A
// map that did not change keeps its reference, so `state.recaps` bindings
// re-evaluate only when a Recap does.

// A session without a transcript is looked for again after this long.
var RELOCATE_MS = 60000
// At most this many transcripts go into one stat.
var MAX_STAT = 64

function initial(home) {
  return { dir: projectsDir(home), paths: {}, located: {}, stamps: {}, recaps: {}, polling: false, sessions: [] }
}

// The distinct session ids of Claude Agents, in order.
function sessionsOf(agents) {
  var list = Array.isArray(agents) ? agents : []
  var out = []
  for (var i = 0; i < list.length; i++) {
    var id = list[i] ? list[i].sessionId : ""
    if (list[i] && list[i].kind === "claude" && isSessionId(id) && out.indexOf(id) < 0) out.push(id)
  }
  return out
}

function sameList(a, b) {
  if (a.length !== b.length) return false
  for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function withFields(state, fields) {
  var next = {}
  for (var key in state) next[key] = state[key]
  for (var name in fields) next[name] = fields[name]
  return next
}

function copyWith(map, key, value) {
  var next = {}
  var keys = Object.keys(map)
  for (var i = 0; i < keys.length; i++) put(next, keys[i], map[keys[i]])
  put(next, key, value)
  return next
}

// One poll: find the transcripts not located (at most every RELOCATE_MS each)
// and stat the located ones, one stat at a time.
function pass(state, now) {
  if (state.polling) return { state: state, commands: [] }
  var located = state.located
  var commands = []
  var paths = []
  for (var i = 0; i < state.sessions.length; i++) {
    var id = state.sessions[i]
    var path = own(state.paths, id) ? state.paths[id] : ""
    if (path !== "") {
      paths.push(path)
    } else if (!own(located, id) || now - located[id] > RELOCATE_MS) {
      located = copyWith(located, id, now)
      commands.push({ id: "locate:" + id, argv: CommandPolicy.locateTranscript(state.dir, id) })
    }
  }
  if (paths.length > 0) commands.push({ id: "stat", argv: CommandPolicy.statTranscripts(paths.slice(0, MAX_STAT)) })
  if (commands.length === 0) return { state: state, commands: [] }
  return { state: withFields(state, { located: located, polling: paths.length > 0 }), commands: commands }
}

function step(state, event, now) {
  var current = state !== null && typeof state === "object" ? state : initial("")
  var type = event && typeof event === "object" ? event.type : ""
  if (type === "agents") {
    var sessions = sessionsOf(event.agents)
    if (sameList(sessions, current.sessions)) return { state: current, commands: [] }
    return pass(withFields(current, { sessions: sessions }), now)
  }
  if (type === "tick") return pass(current, now)
  if (type === "reply") return answer(current, event, now)
  return { state: current, commands: [] }
}

// A find, stat or grep answer.
function answer(state, event, now) {
  var same = { state: state, commands: [] }
  var id = typeof event.id === "string" ? event.id : ""
  if (id.indexOf("locate:") === 0) {
    // A transcript found is statted at once rather than at the next tick.
    var located = id.slice(7)
    var path = parseLocate(event.text, state.dir, located)
    if (path === "" || (own(state.paths, located) && state.paths[located] === path)) return same
    return pass(withFields(state, { paths: copyWith(state.paths, located, path) }), now)
  }
  if (id === "stat") {
    if (!state.polling) return same
    var known = []
    var sessionOf = {}
    var sessions = Object.keys(state.paths)
    for (var i = 0; i < sessions.length; i++) {
      known.push(state.paths[sessions[i]])
      put(sessionOf, state.paths[sessions[i]], sessions[i])
    }
    var read = parseStat(event.text, known)
    var stamps = state.stamps
    var commands = []
    var changed = Object.keys(read)
    for (var j = 0; j < changed.length; j++) {
      var file = changed[j]
      if (own(stamps, file) && stamps[file] === read[file]) continue
      stamps = copyWith(stamps, file, read[file])
      commands.push({ id: "grep:" + sessionOf[file], argv: CommandPolicy.grepRecaps(file) })
    }
    return { state: withFields(state, { polling: false, stamps: stamps }), commands: commands }
  }
  if (id.indexOf("grep:") === 0) {
    // grep exits 1 when the transcript has no recap yet.
    if (event.code !== 0 && event.code !== 1) return same
    var session = id.slice(5)
    var recap = latestRecap(event.text, session)
    var current = own(state.recaps, session) ? state.recaps[session] : null
    if (!recap || (current && current.text === recap.text)) return same
    return { state: withFields(state, { recaps: copyWith(state.recaps, session, recap) }), commands: [] }
  }
  return same
}

function normalizeMode(mode) {
  return MODES.indexOf(mode) >= 0 ? mode : DEFAULT_MODE
}

function normalizeOpen(mode) {
  return OPEN_MODES.indexOf(mode) >= 0 ? mode : DEFAULT_OPEN
}

function own(object, key) {
  return object !== null && typeof object === "object" && Object.prototype.hasOwnProperty.call(object, key)
}

// Own, enumerable property even for names like __proto__.
function put(object, key, value) {
  Object.defineProperty(object, key, { value: value, enumerable: true, writable: true, configurable: true })
}

function isKey(value) {
  return typeof value === "string" && value !== ""
}

// { "<module key>": { "<pane id>": true } }
function emptyOpen() {
  return {}
}

function isOpen(open, moduleKey, paneId) {
  return own(open, moduleKey) && own(open[moduleKey], paneId) && open[moduleKey][paneId] === true
}

// A new state with the pane flipped; the same state for junk keys.
function toggleOpen(open, moduleKey, paneId) {
  var current = open !== null && typeof open === "object" ? open : {}
  if (!isKey(moduleKey) || !isKey(paneId)) return current
  var next = {}
  var modules = Object.keys(current)
  for (var i = 0; i < modules.length; i++) {
    if (modules[i] !== moduleKey) put(next, modules[i], current[modules[i]])
  }
  var panes = {}
  var was = isOpen(current, moduleKey, paneId)
  var list = own(current, moduleKey) ? Object.keys(current[moduleKey]) : []
  for (var j = 0; j < list.length; j++) {
    if (list[j] !== paneId && current[moduleKey][list[j]] === true) put(panes, list[j], true)
  }
  if (!was) put(panes, paneId, true)
  if (Object.keys(panes).length > 0) put(next, moduleKey, panes)
  return next
}

// Drops panes that are no longer Agents. Returns the same state when nothing
// is dropped, so bindings on it do not re-evaluate on every update.
function pruneOpen(open, paneIds) {
  var current = open !== null && typeof open === "object" ? open : {}
  var alive = {}
  var ids = Array.isArray(paneIds) ? paneIds : []
  for (var i = 0; i < ids.length; i++) if (isKey(ids[i])) put(alive, ids[i], true)
  var changed = false
  var next = {}
  var modules = Object.keys(current)
  for (var m = 0; m < modules.length; m++) {
    var panes = {}
    var list = Object.keys(current[modules[m]] || {})
    for (var p = 0; p < list.length; p++) {
      if (own(alive, list[p]) && current[modules[m]][list[p]] === true) put(panes, list[p], true)
      else changed = true
    }
    if (Object.keys(panes).length > 0) put(next, modules[m], panes)
    else changed = true
  }
  return changed ? next : current
}

function openPanes(open, moduleKey) {
  if (!own(open, moduleKey)) return []
  var out = []
  var list = Object.keys(open[moduleKey])
  for (var i = 0; i < list.length; i++) if (open[moduleKey][list[i]] === true) out.push(list[i])
  return out.sort()
}

if (typeof module !== "undefined") {
  module.exports = {
    MODES: MODES,
    DEFAULT_MODE: DEFAULT_MODE,
    MAX_CHARS: MAX_CHARS,
    isSessionId: isSessionId,
    projectsDir: projectsDir,
    isTranscriptPath: isTranscriptPath,
    parseLocate: parseLocate,
    parseStat: parseStat,
    clean: clean,
    latestRecap: latestRecap,
    normalizeMode: normalizeMode,
    OPEN_MODES: OPEN_MODES,
    DEFAULT_OPEN: DEFAULT_OPEN,
    normalizeOpen: normalizeOpen,
    emptyOpen: emptyOpen,
    isOpen: isOpen,
    toggleOpen: toggleOpen,
    pruneOpen: pruneOpen,
    openPanes: openPanes,
    RELOCATE_MS: RELOCATE_MS,
    MAX_STAT: MAX_STAT,
    initial: initial,
    sessionsOf: sessionsOf,
    step: step
  }
}
