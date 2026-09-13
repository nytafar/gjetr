"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")
const loadLib = require("./support/loadLib.cjs")

const Usage = loadLib("lib/UsageModel.js")

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

// Trimmed from real files written by omarchy-agent-usage-update.
const claude = {
  activeDays: 6, authHelpText: "Run `claude auth login` to restore authoritative usage.", hasLocalStats: true, id: "claude",
  limits: [
    { label: "Session (5-hour)", percent: 0.73, resetsAt: "2026-09-13T12:40:00.897588+00:00" },
    { label: "Weekly (7-day)", percent: 0.17, resetsAt: "2026-09-19T13:00:00.897613+00:00" },
    { label: "Fable Weekly", percent: 0.18, resetsAt: "2026-09-19T13:00:00.897856+00:00", title: "Fable Weekly" }
  ],
  modelUsage: { "claude-opus-5": { inputTokens: 23370, outputTokens: 1581602 } },
  name: "Claude Code", ready: true,
  recentDays: [
    { date: "2026-09-07", messageCount: 0 }, { date: "2026-09-08", messageCount: 74318654 },
    { date: "2026-09-09", messageCount: 129528264 }, { date: "2026-09-10", messageCount: 177574209 },
    { date: "2026-09-11", messageCount: 235748530 }, { date: "2026-09-12", messageCount: 30792202 },
    { date: "2026-09-13", messageCount: 94198345 }
  ],
  schemaVersion: 1, tierLabel: "Max 5x", todayPrompts: 892, todaySessions: 7,
  todayTokensByModel: { "claude-fable-5-1": 2710025, "claude-opus-5": 86635880, "claude-sonnet-5": 4852440 },
  todayTotalTokens: 94198345, totalPrompts: 6380, totalSessions: 72, updatedAt: "2026-09-13T12:21:14.978048+00:00", usageStatusText: ""
}

const fireworks = {
  schemaVersion: 1, id: "fireworks", name: "Fireworks", updatedAt: "2026-09-13T12:21:14.190762+00:00", ready: false,
  hasLocalStats: false, scope: "account", hasPromptStats: false, tierLabel: "Prepaid", usageStatusText: "Fireworks unavailable",
  limits: [], todayPrompts: 0, todaySessions: 0, todayTotalTokens: 0, todayTokensByModel: {}, recentDays: []
}

const NOW = Date.parse("2026-09-13T12:21:14Z")

test("an Omarchy record becomes a provider-neutral provider", () => {
  const p = plain(Usage.fromOmarchy(claude, "claude"))
  assert.equal(p.id, "claude")
  assert.equal(p.source, "omarchy")
  assert.equal(p.name, "Claude Code")
  assert.equal(p.tier, "Max 5x")
  assert.equal(p.ready, true)
  assert.equal(p.updatedAtMs, Date.parse("2026-09-13T12:21:14.978Z"))
  assert.deepEqual(p.limits.map(l => [l.label, l.fraction]), [["Session (5-hour)", 0.73], ["Weekly (7-day)", 0.17], ["Fable Weekly", 0.18]])
  assert.equal(p.limits[0].resetsAtMs, Date.parse("2026-09-13T12:40:00.897Z"))
  assert.deepEqual(p.today, { tokens: 94198345, prompts: 892, sessions: 7, hasPrompts: true })
  assert.equal(p.recentDays.length, 7)
  assert.deepEqual(p.recentDays[6], { date: "2026-09-13", tokens: 94198345 })
  assert.deepEqual(p.models.map(m => [m.name, m.tokens]), [["Opus 5", 86635880], ["Sonnet 5", 4852440], ["Fable 5.1", 2710025]])
  assert.equal("cost30d" in p, false)
})

test("a provider that is not ready keeps its quiet status text", () => {
  const p = Usage.fromOmarchy(fireworks, "fireworks")
  assert.equal(p.ready, false)
  assert.equal(p.statusText, "Fireworks unavailable")
  assert.equal(p.today.hasPrompts, false)
  assert.deepEqual(plain(p.limits), [])
})

test("records are untrusted: junk numbers, text and entries are dropped or cleaned", () => {
  const p = plain(Usage.fromOmarchy({
    name: "Evil\u202e\nName" + "x".repeat(100), ready: "yes", todayTotalTokens: "9", todayPrompts: -3, todaySessions: NaN,
    limits: [null, { label: "ok", percent: 3 }, { label: "neg", percent: -1 }, { label: "str", percent: "0.5" }],
    recentDays: [{ date: "13/09", messageCount: 5 }, { date: "2026-09-12", messageCount: 5 }],
    todayTokensByModel: { "claude-opus-5": 10, "": 5, "bad": "x" }, updatedAt: "yesterday"
  }, "claude"))
  assert.equal(p.name.includes("\u202e") || p.name.includes("\n"), false)
  assert.ok(p.name.length <= 40)
  assert.equal(p.ready, false)
  assert.deepEqual(p.today, { tokens: 0, prompts: 0, sessions: 0, hasPrompts: true })
  assert.deepEqual(p.limits, [{ label: "ok", fraction: 1, resetsAtMs: 0 }])
  assert.deepEqual(p.recentDays, [{ date: "2026-09-12", tokens: 5 }])
  assert.deepEqual(p.models, [{ id: "claude-opus-5", name: "Opus 5", tokens: 10 }])
  assert.equal(p.updatedAtMs, 0)
  assert.equal(Usage.fromOmarchy(claude, "../etc"), null)
  assert.equal(Usage.fromOmarchy([], "claude"), null)
})

test("parseOmarchyRecord reports empty, oversized and invalid files", () => {
  assert.equal(Usage.parseOmarchyRecord(JSON.stringify(claude), "claude").provider.id, "claude")
  assert.equal(Usage.parseOmarchyRecord("", "claude").error, "empty")
  assert.equal(Usage.parseOmarchyRecord("{", "claude").error, "invalid JSON")
  assert.equal(Usage.parseOmarchyRecord("[1]", "claude").error, "not a usage record")
  assert.match(Usage.parseOmarchyRecord(" ".repeat(300000) + "{}", "claude").error, /too large/)
})

test("the usage directory and its listing", () => {
  assert.equal(Usage.usageDir("/home/x", ""), "/home/x/.local/state/omarchy/agents/usage")
  assert.equal(Usage.usageDir("/home/x/", "/var/state/"), "/var/state/omarchy/agents/usage")
  assert.equal(Usage.usageDir("/home/x", "relative"), "/home/x/.local/state/omarchy/agents/usage")
  assert.deepEqual(Array.from(Usage.parseListing("codex.json\n.claude.Ab12Cd\nclaude.json\nnotes.txt\nBad Name.json\nclaude.json\n")),
    ["claude", "codex"])
})

test("model names join the version run and capitalise the words", () => {
  assert.equal(Usage.modelName("claude-opus-5"), "Opus 5")
  assert.equal(Usage.modelName("claude-opus-4-8"), "Opus 4.8")
  assert.equal(Usage.modelName("claude-haiku-4-5-20251001"), "Haiku 4.5")
  assert.equal(Usage.modelName("gpt-6-astra"), "GPT 6 Astra")
  assert.equal(Usage.modelName("gpt-5.6-sol"), "GPT 5.6 Sol")
  assert.equal(Usage.modelName(""), "Unknown")
})

test("visibleProviders shows ready providers by default and a filter in its own order", () => {
  const providers = {
    codex: Usage.fromOmarchy(Object.assign({}, claude, { name: "Codex" }), "codex"),
    claude: Usage.fromOmarchy(claude, "claude"),
    fireworks: Usage.fromOmarchy(fireworks, "fireworks")
  }
  assert.deepEqual(Usage.visibleProviders(providers, []).map(p => p.id), ["claude", "codex"])
  const filtered = plain(Usage.visibleProviders(providers, ["fireworks", "claude", "gemini", "claude", "BAD"]))
  assert.deepEqual(filtered.map(p => [p.id, p.ready, p.statusText]),
    [["fireworks", false, "Fireworks unavailable"], ["claude", true, ""], ["gemini", false, "no usage data"]])
  assert.deepEqual(plain(Usage.visibleProviders(null, null)), [])
})

test("refresh interval: smallest Module value, else the Display's, else 900", () => {
  assert.equal(Usage.refreshSeconds(null, []), 900)
  assert.equal(Usage.refreshSeconds(300, [{ refreshSeconds: null }]), 300)
  assert.equal(Usage.refreshSeconds(300, [{ refreshSeconds: 1200 }, { refreshSeconds: 600 }, {}]), 600)
  assert.equal(Usage.refreshSeconds(30, [{ refreshSeconds: 10 }]), 900)
})

test("meters warn at 75% and turn critical at 90%", () => {
  assert.equal(Usage.limitLevel(0.2), "ok")
  assert.equal(Usage.limitLevel(0.75), "warn")
  assert.equal(Usage.limitLevel(0.899), "warn")
  assert.equal(Usage.limitLevel(0.9), "critical")
  assert.equal(Usage.limitLevel(1), "critical")
  assert.equal(Usage.limitLevel(-1), "unknown")
  assert.equal(Usage.formatPercent(0.734), "73%")
  assert.equal(Usage.formatPercent(-1), "–")
})

test("tokens, durations, resets and ages read short", () => {
  assert.equal(Usage.formatTokens(94198345), "94.2M")
  assert.equal(Usage.formatTokens(396838), "396.8K")
  assert.equal(Usage.formatTokens(2000000), "2M")
  assert.equal(Usage.formatTokens(1234567890), "1.2B")
  assert.equal(Usage.formatTokens(812), "812")
  assert.equal(Usage.formatTokens("x"), "0")
  assert.equal(Usage.formatDuration(30 * 1000), "<1m")
  assert.equal(Usage.formatDuration(45 * 60000), "45m")
  assert.equal(Usage.formatDuration(139 * 60000), "2h 19m")
  assert.equal(Usage.formatDuration(120 * 60000), "2h")
  assert.equal(Usage.formatDuration((4 * 24 + 3) * 3600000), "4d 3h")
  assert.equal(Usage.resetLabel(NOW + 139 * 60000, NOW), "resets in 2h 19m")
  assert.equal(Usage.resetLabel(NOW - 1000, NOW), "resets now")
  assert.equal(Usage.resetLabel(0, NOW), "")
  assert.equal(Usage.ageLabel(NOW - 5 * 60000, NOW), "updated 5m ago")
  assert.equal(Usage.ageLabel(NOW - 10000, NOW), "updated just now")
  assert.equal(Usage.ageLabel(0, NOW), "")
})

test("a record older than two refreshes is stale", () => {
  assert.equal(Usage.isStale(NOW - 1800 * 1000, NOW, 900), false)
  assert.equal(Usage.isStale(NOW - 2100 * 1000, NOW, 900), true)
  assert.equal(Usage.isStale(0, NOW, 900), true)
})

test("day bars scale to the busiest day and carry weekday labels", () => {
  const bars = plain(Usage.dayBars(Usage.fromOmarchy(claude, "claude").recentDays, 7))
  assert.equal(bars.length, 7)
  const weekday = d => ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"][new Date(d + "T00:00:00Z").getUTCDay()]
  assert.deepEqual(bars.map(b => b.label), bars.map(b => weekday(b.date)))
  assert.equal(bars[4].fraction, 1)
  assert.equal(bars[0].fraction, 0)
  assert.deepEqual(plain(Usage.dayBars([{ date: "2026-09-13", tokens: 0 }], 7)).map(b => b.fraction), [0])
  assert.equal(Usage.dayBars(null, 7).length, 0)
})

test("lists that arrive as array-likes (QML sequences through a Repeater's modelData) still read", () => {
  const days = { length: 2, 0: { date: "2026-09-12", tokens: 50 }, 1: { date: "2026-09-13", tokens: 100 } }
  assert.deepEqual(plain(Usage.dayBars(days, 7)).map(b => [b.date, b.fraction]), [["2026-09-12", 0.5], ["2026-09-13", 1]])
  const providers = { claude: Usage.fromOmarchy(claude, "claude") }
  assert.deepEqual(Usage.visibleProviders(providers, { length: 1, 0: "claude" }).map(p => p.id), ["claude"])
  assert.equal(Usage.dayBars({ length: -1 }, 7).length, 0)
  assert.equal(Usage.dayBars("2026-09-13", 7).length, 0)
})

test("refresh across Decks: the smallest of the Decks that show a Usage Module", () => {
  assert.equal(Usage.deckRefreshSeconds([]), 900)
  assert.equal(Usage.deckRefreshSeconds([{ displaySeconds: 300, modules: [] }]), 900)
  assert.equal(Usage.deckRefreshSeconds([
    { displaySeconds: 300, modules: [{ refreshSeconds: null }] },
    { displaySeconds: null, modules: [{ refreshSeconds: 1200 }] },
    { displaySeconds: 60, modules: [] },
    null
  ]), 300)
  assert.equal(Usage.deckRefreshSeconds(null), 900)
})
