.pragma library
.import "ConfigModel.js" as ConfigModel

// Presets: the Config gjetr ships in presets/, a gjetr.toml per preset and, in
// presets/layouts/, the Layouts their Decks name. A preset names its outputs
// by placeholder, "touchscreen" for a surface and "monitor" for a Dock, which
// are filled in for this machine when gjetr shows a preset without a Config or
// installs one into it. Installing writes only gjetr.toml and
// layouts/<name>.toml under the Config dir, backing up what it replaces as
// <file>.bak.<epoch seconds>, as `omarchy refresh config` does.

var PRESETS = [
  { name: "panel", description: "a touchscreen: the Agent List beside usage" },
  { name: "sidebar", description: "a Dock on the left of your main monitor: Agents over usage pinned at the bottom" },
  { name: "panel-sidebar", description: "both: the panel on your touchscreen and the sidebar Dock on your main monitor" },
  { name: "minimal", description: "one Agent List on a touchscreen, every key explained" }
]

var PLACEHOLDERS = ["touchscreen", "monitor"]
var OUTPUT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
// A Display name line holding a placeholder, keeping what surrounds the value.
var NAME_LINE_RE = /^(\s*name\s*=\s*)"(touchscreen|monitor)"(.*)$/
var INSTALL_RE = /^(gjetr\.toml|layouts\/[A-Za-z0-9][A-Za-z0-9_-]{0,31}\.toml)(\.bak\.[0-9]{1,12})?$/

function isPreset(name) {
  if (typeof name !== "string") return false
  for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].name === name) return true
  return false
}

// A preset's text with each placeholder Display name replaced by its output.
// `outputs`: { touchscreen, monitor }; an empty or invalid output leaves the
// placeholder and is listed in `missing`, in the order the text names them.
// -> { text, missing }
function render(text, outputs) {
  if (typeof text !== "string") return { text: "", missing: [] }
  var values = outputs !== null && typeof outputs === "object" ? outputs : {}
  var missing = []
  var lines = text.split("\n")
  for (var i = 0; i < lines.length; i++) {
    var match = NAME_LINE_RE.exec(lines[i])
    if (!match) continue
    var value = Object.prototype.hasOwnProperty.call(values, match[2]) ? values[match[2]] : ""
    if (typeof value === "string" && OUTPUT_RE.test(value)) lines[i] = match[1] + "\"" + value + "\"" + match[3]
    else if (missing.indexOf(match[2]) < 0) missing.push(match[2])
  }
  return { text: lines.join("\n"), missing: missing }
}

function splitLines(text) {
  var value = typeof text === "string" ? text : ""
  if (value === "") return []
  return value.replace(/\n$/, "").split("\n")
}

// Lines added and removed between two texts, from their longest common
// subsequence of lines.
function lineDiff(before, after) {
  var a = splitLines(before)
  var b = splitLines(after)
  var previous = new Array(b.length + 1)
  var current = new Array(b.length + 1)
  for (var j = 0; j <= b.length; j++) previous[j] = 0
  for (var i = 1; i <= a.length; i++) {
    current[0] = 0
    for (var k = 1; k <= b.length; k++) {
      current[k] = a[i - 1] === b[k - 1] ? previous[k - 1] + 1 : Math.max(previous[k], current[k - 1])
    }
    var swap = previous
    previous = current
    current = swap
  }
  var common = previous[b.length]
  return { added: b.length - common, removed: a.length - common }
}

// The files a preset installs: gjetr.toml, then each Layout its Decks name that
// `layoutTexts` has, all under `configDir`. Nothing for a directory that is not
// an absolute path free of parent steps.
// -> [{ relative, path, text }]
function installFiles(configDir, mainText, layoutTexts) {
  if (!ConfigModel.isConfigDir(configDir)) return []
  var base = String(configDir).replace(/\/+$/, "")
  var texts = layoutTexts !== null && typeof layoutTexts === "object" ? layoutTexts : {}
  var out = [{ relative: "gjetr.toml", path: base + "/gjetr.toml", text: String(mainText) }]
  var names = ConfigModel.deckLayoutNames(ConfigModel.readMain(mainText, "/").config)
  for (var i = 0; i < names.length; i++) {
    if (!Object.prototype.hasOwnProperty.call(texts, names[i]) || typeof texts[names[i]] !== "string") continue
    var relative = "layouts/" + names[i] + ".toml"
    out.push({ relative: relative, path: base + "/" + relative, text: texts[names[i]] })
  }
  return out
}

// Whether installing may write `path`: gjetr.toml or layouts/<Layout name>.toml
// directly under `configDir`, or a backup of one.
function isInstallPath(configDir, path) {
  if (!ConfigModel.isConfigDir(configDir) || typeof path !== "string") return false
  var base = String(configDir).replace(/\/+$/, "")
  if (path.indexOf(base + "/") !== 0) return false
  return INSTALL_RE.test(path.slice(base.length + 1))
}

// What installing one file does, given the text there now (null or "" when
// there is none) and the preset's text. An identical file is left alone; a
// different one is backed up as <file>.bak.<epoch>.
// -> { relative, action: "created" | "unchanged" | "replaced", backup, added, removed, line }
function fileOutcome(relative, before, after, epochSeconds) {
  var name = String(relative)
  var text = typeof after === "string" ? after : ""
  if (typeof before !== "string" || before === "") {
    var count = splitLines(text).length
    return { relative: name, action: "created", backup: "", added: count, removed: 0,
      line: name + ": created (" + count + (count === 1 ? " line)" : " lines)") }
  }
  if (before === text) return { relative: name, action: "unchanged", backup: "", added: 0, removed: 0, line: name + ": unchanged" }
  var epoch = Math.floor(Number(epochSeconds))
  var backup = name + ".bak." + (isFinite(epoch) && epoch >= 0 ? epoch : 0)
  var diff = lineDiff(before, text)
  return { relative: name, action: "replaced", backup: backup, added: diff.added, removed: diff.removed,
    line: name + ": replaced (+" + diff.added + " -" + diff.removed + "), yours kept as " + backup }
}

var MISSING_TEXT = {
  touchscreen: { display: "surface", text: "no touchscreen bound to an output of its own was found" },
  monitor: { display: "Dock", text: "no monitor was found" }
}

// What installing a preset did, one line per file, then each output name the
// user still has to set.
function installSummary(presetName, configDir, outcomes, missing) {
  var lines = ["installed preset " + String(presetName) + " into " + String(configDir).replace(/\/+$/, "")]
  var list = Array.isArray(outcomes) ? outcomes : []
  for (var i = 0; i < list.length; i++) if (list[i] && typeof list[i].line === "string") lines.push("  " + list[i].line)
  var gaps = Array.isArray(missing) ? missing : []
  for (var j = 0; j < gaps.length; j++) {
    if (!Object.prototype.hasOwnProperty.call(MISSING_TEXT, gaps[j])) continue
    lines.push("set the " + MISSING_TEXT[gaps[j]].display + "'s name in gjetr.toml yourself: " + MISSING_TEXT[gaps[j]].text)
  }
  return lines.join("\n")
}

// The presets, one per line with its description in a column, marking the one
// gjetr detects for this machine.
function listText(detected) {
  var width = 0
  for (var i = 0; i < PRESETS.length; i++) width = Math.max(width, PRESETS[i].name.length)
  return PRESETS.map(function(preset) {
    var pad = ""
    while (preset.name.length + pad.length < width + 2) pad += " "
    return preset.name + pad + preset.description + (preset.name === detected ? " (detected)" : "")
  }).join("\n")
}

if (typeof module !== "undefined") {
  module.exports = {
    PRESETS: PRESETS,
    PLACEHOLDERS: PLACEHOLDERS,
    isPreset: isPreset,
    render: render,
    lineDiff: lineDiff,
    installFiles: installFiles,
    isInstallPath: isInstallPath,
    fileOutcome: fileOutcome,
    installSummary: installSummary,
    listText: listText
  }
}
