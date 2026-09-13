.pragma library

// Recap: the latest session recap Claude Code wrote for an Agent's session.
// Claude appends it to ~/.claude/projects/<project-dir>/<session-id>.jsonl as
//   {"type":"system","subtype":"away_summary","content":"...","timestamp":"...",...}
// and herdr names the session in the Agent's agent_session (kind "id").
// Pure; the service locates, watches and greps the files through
// lib/CommandPolicy.js. Transcript content is untrusted text: control and
// bidirectional-override characters are removed, whitespace collapsed and
// length capped, and the Card renders it as plain text.

var MODES = ["off", "inline", "expand"]
var DEFAULT_MODE = "off"
var MAX_CHARS = 1200

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

function normalizeMode(mode) {
  return MODES.indexOf(mode) >= 0 ? mode : DEFAULT_MODE
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
    normalizeMode: normalizeMode
  }
}
