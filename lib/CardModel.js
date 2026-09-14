.pragma library
.import "CardPolicy.js" as CardPolicy
.import "StatusPolicy.js" as StatusPolicy
.import "IndicatorPolicy.js" as IndicatorPolicy
.import "NamePolicy.js" as NamePolicy
.import "RepoModel.js" as RepoModel
.import "CacheTimerModel.js" as CacheTimerModel
.import "AttentionModel.js" as AttentionModel
.import "RecapModel.js" as RecapModel

// A Card's Fields, resolved once from its Agent, its Module's settings and the
// service's maps. Cards, rows and full Cards draw this object and derive
// nothing; the state IPC's cards are its summary, so the two cannot drift.
// Tones are theme token names, never colours (the Tone singleton resolves them).

function setting(moduleState, key, fallback) {
  return moduleState && moduleState[key] !== undefined && moduleState[key] !== null ? moduleState[key] : fallback
}

// The Recap text of an Agent's session, or "".
function recapText(agent, recaps) {
  if (!agent || !recaps || !Object.prototype.hasOwnProperty.call(recaps, agent.sessionId)) return ""
  var entry = recaps[agent.sessionId]
  return entry && typeof entry.text === "string" ? entry.text : ""
}

// One rule for every Density. `open`: the Module opens Recaps in the Card and
// this one is open. `expandable`: recap = "expand" with a Recap. `inline`:
// recap = "inline" with a Recap. Shown in the Card while open, when expandable,
// or inline outside comfortable Density (a comfortable Card's inline Recap is
// already all it shows).
function recapFor(agent, mode, openMode, text, openMap, moduleKey, densityName) {
  var has = text !== ""
  var open = !!agent && (mode === "expand" || mode === "inline") && openMode === "card"
    && RecapModel.isOpen(openMap, moduleKey, agent.paneId)
  var expandable = mode === "expand" && has
  var inline = mode === "inline" && has
  return { mode: mode, text: text, open: open, expandable: expandable, inline: inline,
    shown: open && (expandable || (inline && densityName !== "comfortable")) }
}

function build(agent, moduleState, facts, now) {
  if (!agent) return EMPTY
  var f = facts || {}
  var preset = CardPolicy.normalizePreset(setting(moduleState, "preset", CardPolicy.DEFAULT_PRESET))
  var fields = CardPolicy.fieldsFor(preset)
  var indicatorMode = setting(moduleState, "indicator", IndicatorPolicy.DEFAULT_MODE)
  var workingEffect = setting(moduleState, "workingEffect", IndicatorPolicy.DEFAULT_WORKING_EFFECT)
  var densityName = f.densityName || "comfortable"
  var attention = AttentionModel.attentionOf(f.attention, agent.paneId)
  var cache = CacheTimerModel.cacheTimer(agent, f.cacheTimers, now, f.cacheSettings)
  var level = cache ? cache.level : ""
  var inFocusedWorkspace = !!f.focusedWorkspaceId && agent.workspaceId === f.focusedWorkspaceId
  var status = StatusPolicy.indicator(agent.status)
  return {
    paneId: agent.paneId,
    name: NamePolicy.agentName(agent),
    kind: agent.kind,
    kindLabel: CardPolicy.kindLabel(agent.kind, agent.displayKind),
    kindGlyph: CardPolicy.kindGlyph(agent.kind, agent.displayKind),
    kindIconFile: CardPolicy.kindIconFile(agent.kind, !!f.lightBackground),
    kindIconTinted: CardPolicy.kindIconTinted(agent.kind),
    // herdr's own word, as the state IPC has always reported it.
    status: agent.status,
    indicator: status,
    indicatorMode: indicatorMode,
    showGlyph: fields.status && IndicatorPolicy.showsGlyph(indicatorMode, fields.kind),
    showStatusWord: StatusPolicy.showsLabel(preset),
    mark: IndicatorPolicy.markFor(agent.status, attention, workingEffect),
    marksState: IndicatorPolicy.marksState(indicatorMode),
    attention: attention,
    attentionTone: attention === "blocked" ? "urgent" : "accent",
    inFocusedWorkspace: inFocusedWorkspace,
    // The faint tint: highlight_workspace on and the Agent in the Focused workspace.
    highlighted: inFocusedWorkspace && setting(moduleState, "highlightWorkspace", true) === true,
    focused: !!agent.focused,
    preset: preset,
    fields: fields,
    location: NamePolicy.location(agent),
    repo: RepoModel.label(RepoModel.infoFor(agent, f.repos), agent.cwd, f.home),
    cache: cache,
    // A full Card's live Cache timer reads in the foreground.
    cacheTone: densityName === "full" && level === "ok" ? "foreground" : CardPolicy.cacheTone(level),
    cacheBarTone: CardPolicy.cacheBarTone(level),
    recap: recapFor(agent, setting(moduleState, "recap", RecapModel.DEFAULT_MODE),
      setting(moduleState, "recapOpen", RecapModel.DEFAULT_OPEN), recapText(agent, f.recaps), f.recapOpen,
      f.moduleKey, densityName)
  }
}

// What a Card draws for no Agent: nothing, in the default preset.
var EMPTY = {
  paneId: "", name: "", kind: "", kindLabel: "", kindGlyph: "", kindIconFile: "", kindIconTinted: false,
  status: "unknown", indicator: StatusPolicy.indicator("unknown"), indicatorMode: IndicatorPolicy.DEFAULT_MODE,
  showGlyph: false, showStatusWord: false, mark: IndicatorPolicy.markFor("unknown", "", ""), marksState: false,
  attention: "", attentionTone: "accent", inFocusedWorkspace: false, highlighted: false, focused: false,
  preset: CardPolicy.DEFAULT_PRESET, fields: CardPolicy.fieldsFor(CardPolicy.DEFAULT_PRESET), location: "",
  repo: { repo: "", branch: "", path: "", text: "" }, cache: null, cacheTone: "muted", cacheBarTone: "muted",
  recap: { mode: RecapModel.DEFAULT_MODE, text: "", open: false, expandable: false, inline: false, shown: false }
}

// The state IPC's record of a Card.
function summary(card) {
  return {
    paneId: card.paneId,
    status: card.status,
    attention: card.attention,
    recap: card.recap.text !== "",
    inFocusedWorkspace: card.inFocusedWorkspace,
    name: card.name,
    kind: card.kind,
    kindLabel: card.kindLabel,
    kindMark: card.kindIconFile || card.kindGlyph,
    location: card.location,
    repo: card.repo.text,
    cache: card.cache ? card.cache.label + " " + card.cache.level : ""
  }
}

if (typeof module !== "undefined") {
  module.exports = {
    EMPTY: EMPTY,
    build: build,
    summary: summary,
    recapText: recapText
  }
}
