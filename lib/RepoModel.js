.pragma library

// Where an Agent works: the git repository and branch of its cwd, else a
// short path. Pure; the service runs the allowlisted
// `git -C <cwd> rev-parse --show-toplevel --abbrev-ref HEAD` (CommandPolicy)
// per distinct cwd, caches the answer per cwd and asks again when a cwd first
// appears or its answer is older than REFRESH_MS.
//
// git rather than reading .git/HEAD in place: cwds come from herdr and are
// untrusted, and a file read from QML is unbounded and would block on a FIFO
// or grow without end on a symlink to a device, where git's discovery reads
// HEAD with a bounded read in a separate process. git also covers worktrees,
// `gitdir:` files, submodules and reftable repositories without gjetr
// re-implementing them.
//
// Every value that reaches the screen (repo, branch, path) is cleaned of
// control and bidirectional-override characters and capped.

var REFRESH_MS = 30000
// At most this many git processes start per pass.
var MAX_PER_PASS = 8
var MAX_CWD = 1024
var MAX_REPO = 64
var MAX_BRANCH = 64
// Nerd Font branch mark (the Omarchy shell's font is JetBrainsMono Nerd Font).
var BRANCH_MARK = "\ue0a0"

var CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/
var UNSAFE_RE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]+/g

function str(value) {
  return value === undefined || value === null ? "" : String(value)
}

function own(object, key) {
  return object !== null && typeof object === "object" && Object.prototype.hasOwnProperty.call(object, key)
}

function clean(value, max) {
  var text = str(value).replace(UNSAFE_RE, " ").replace(/\s+/g, " ").trim()
  return text.length > max ? text.slice(0, max - 1) + "\u2026" : text
}

function isCwd(value) {
  return typeof value === "string" && value.charAt(0) === "/" && value.length <= MAX_CWD
    && !CONTROL_RE.test(value) && value.split("/").indexOf("..") < 0
}

function basename(path) {
  var trimmed = str(path).replace(/\/+$/, "")
  if (trimmed === "") return "/"
  return trimmed.slice(trimmed.lastIndexOf("/") + 1)
}

// git's stdout and exit code -> { toplevel, repo, branch, detached }, or null
// outside a repository or for output that is not two lines of the expected
// shape.
function parseRevParse(text, code) {
  if (code !== 0 || typeof text !== "string") return null
  var lines = text.split("\n")
  var toplevel = lines[0] || ""
  var ref = (lines[1] || "").trim()
  if (!isCwd(toplevel) || ref === "") return null
  var detached = ref === "HEAD"
  return { toplevel: toplevel, repo: clean(basename(toplevel), MAX_REPO), branch: detached ? "" : clean(ref, MAX_BRANCH),
    detached: detached }
}

// A path with home as ~ and, below that, only the last two directories.
function shortPath(path, home) {
  var value = clean(path, MAX_CWD)
  if (value === "") return ""
  var base = str(home).replace(/\/+$/, "")
  var prefix = "/"
  var rest = value
  if (base !== "" && (value === base || value.indexOf(base + "/") === 0)) {
    prefix = "~/"
    rest = value.slice(base.length)
  }
  var parts = rest.split("/").filter(function(part) { return part !== "" })
  if (parts.length === 0) return prefix === "~/" ? "~" : "/"
  if (parts.length > 2) return prefix + "\u2026/" + parts.slice(-2).join("/")
  return prefix + parts.join("/")
}

// What a Card shows for the location: "repo <mark> branch" in a repository,
// else the short path.
function label(info, cwd, home) {
  if (info && info.repo) {
    var branch = info.detached ? "detached" : info.branch
    return { repo: info.repo, branch: info.branch, path: "",
      text: branch === "" ? info.repo : info.repo + " " + BRANCH_MARK + " " + branch }
  }
  var path = shortPath(cwd, home)
  return { repo: "", branch: "", path: path, text: path }
}

// A compact row's location line: the Repo, then workspace › tab, either
// alone when the other is empty.
function withLocation(repoText, location) {
  var parts = [str(repoText).trim(), str(location).trim()].filter(function(part) { return part !== "" })
  return parts.join(" \u00b7 ")
}

// Distinct valid cwds of the Agents, in order of first appearance.
function cwdsOf(agents) {
  var list = Array.isArray(agents) ? agents : []
  var out = []
  for (var i = 0; i < list.length; i++) {
    var cwd = list[i] ? list[i].cwd : ""
    if (isCwd(cwd) && out.indexOf(cwd) < 0) out.push(cwd)
  }
  return out
}

// checked: { cwd: ms of the last answer }; inFlight: { cwd: true }.
function dueCwds(agents, checked, inFlight, now, refreshMs, max) {
  var cwds = cwdsOf(agents)
  var limit = typeof max === "number" && max > 0 ? max : MAX_PER_PASS
  var refresh = typeof refreshMs === "number" && refreshMs > 0 ? refreshMs : REFRESH_MS
  var out = []
  for (var i = 0; i < cwds.length && out.length < limit; i++) {
    if (own(inFlight, cwds[i]) && inFlight[cwds[i]]) continue
    if (own(checked, cwds[i]) && now - checked[cwds[i]] < refresh) continue
    out.push(cwds[i])
  }
  return out
}

// A map keyed by cwd without the cwds no Agent uses. The same object when
// nothing is dropped, so bindings on it do not re-evaluate.
function prune(map, agents) {
  var current = map !== null && typeof map === "object" ? map : {}
  var cwds = cwdsOf(agents)
  var keys = Object.keys(current)
  var next = {}
  var changed = false
  for (var i = 0; i < keys.length; i++) {
    if (cwds.indexOf(keys[i]) >= 0) next[keys[i]] = current[keys[i]]
    else changed = true
  }
  return changed ? next : current
}

// Whether two answers for a cwd show the same thing.
function sameInfo(a, b) {
  if (!a || !b) return !a && !b
  return a.toplevel === b.toplevel && a.branch === b.branch && a.detached === b.detached
}

// repos: { cwd: info or null }.
function infoFor(agent, repos) {
  if (!agent || !isCwd(agent.cwd) || !own(repos, agent.cwd)) return null
  return repos[agent.cwd] || null
}

if (typeof module !== "undefined") {
  module.exports = {
    REFRESH_MS: REFRESH_MS,
    MAX_PER_PASS: MAX_PER_PASS,
    MAX_CWD: MAX_CWD,
    MAX_REPO: MAX_REPO,
    MAX_BRANCH: MAX_BRANCH,
    BRANCH_MARK: BRANCH_MARK,
    isCwd: isCwd,
    parseRevParse: parseRevParse,
    shortPath: shortPath,
    label: label,
    withLocation: withLocation,
    dueCwds: dueCwds,
    prune: prune,
    sameInfo: sameInfo,
    infoFor: infoFor
  }
}
