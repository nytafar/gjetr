.pragma library

// Agent name: the label a Card shows, taken from the most specific source
// available. Order: herdr's agent name (`agents[].name`, set when the agent was
// started or renamed by name), pane label, terminal title, renamed tab label,
// workspace label, cwd basename, then the kind and finally the pane id so a
// Card is never blank.

// Titles an agent sets for itself before it has anything specific to say.
// They name the program, not the work, so they fall through to broader
// sources. Compared case-insensitively, together with the Agent's own kind.
var GENERIC_TITLES = ["claude code", "claude", "codex", "opencode", "gemini", "pi"]

function text(value) {
  return value === undefined || value === null ? "" : String(value).trim()
}

function isGenericTitle(title, agent) {
  var lower = title.toLowerCase()
  if (GENERIC_TITLES.indexOf(lower) >= 0) return true
  return lower === text(agent.kind).toLowerCase() || lower === text(agent.displayKind).toLowerCase()
}

// herdr labels a new tab with its 1-based position, which is not the tab's
// `number` (an id counter: live tab w4:tA has label "2" and number 10). A bare
// integer label is therefore treated as the default, whichever it matches.
function isRenamedTab(label, number) {
  var value = text(label)
  if (value === "") return false
  if (value === String(number)) return false
  return !/^[0-9]+$/.test(value)
}

function basename(path) {
  var value = text(path)
  if (value === "") return ""
  var trimmed = value.replace(/\/+$/, "")
  if (trimmed === "") return "/"
  var slash = trimmed.lastIndexOf("/")
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed
}

function agentName(agent) {
  if (!agent || typeof agent !== "object") return ""
  // The user named this Agent in herdr; that beats anything inferred.
  var name = text(agent.name)
  if (name !== "") return name
  var paneLabel = text(agent.paneLabel)
  if (paneLabel !== "") return paneLabel
  var title = text(agent.title)
  if (title !== "" && !isGenericTitle(title, agent)) return title
  if (isRenamedTab(agent.tabLabel, agent.tabNumber)) return text(agent.tabLabel)
  var workspace = text(agent.workspaceLabel)
  if (workspace !== "") return workspace
  var dir = basename(agent.cwd)
  if (dir !== "") return dir
  return text(agent.displayKind) || text(agent.kind) || text(agent.paneId)
}

// The workspace › tab Field. Labels as herdr shows them, numbers when a label
// is missing.
function location(agent) {
  if (!agent || typeof agent !== "object") return ""
  var workspace = text(agent.workspaceLabel) || text(agent.workspaceNumber)
  var tab = text(agent.tabLabel) || text(agent.tabNumber)
  if (workspace === "" && tab === "") return ""
  if (tab === "") return workspace
  if (workspace === "") return tab
  return workspace + " › " + tab
}

if (typeof module !== "undefined") {
  module.exports = {
    GENERIC_TITLES: GENERIC_TITLES,
    isRenamedTab: isRenamedTab,
    basename: basename,
    agentName: agentName,
    location: location
  }
}
