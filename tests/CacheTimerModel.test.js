"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")
const loadLib = require("./support/loadLib.cjs")

const Cache = loadLib("lib/CacheTimerModel.js")

const defaults = Cache.DEFAULT_SETTINGS

test("defaults match the cache-ttl plugin", () => {
  assert.equal(defaults.ttlSeconds, 3600)
  assert.equal(defaults.warnAt, 600)
  assert.equal(defaults.critAt, 300)
})

test("parseSettings reads positive integer overrides like the plugin", () => {
  const s = Cache.parseSettings('{"warn_at": 900, "crit_at": 120, "ttl_seconds": 300, "tick_interval": 5}')
  assert.equal(s.warnAt, 900)
  assert.equal(s.critAt, 120)
  assert.equal(s.ttlSeconds, 300)
})

test("parseSettings ignores zero and negative values per field", () => {
  const s = Cache.parseSettings('{"warn_at": 0, "crit_at": -5, "ttl_seconds": 1200}')
  assert.equal(s.warnAt, 600)
  assert.equal(s.critAt, 300)
  assert.equal(s.ttlSeconds, 1200)
})

test("parseSettings falls back to all defaults when the overlay is malformed", () => {
  // serde rejects the whole overlay on a mistyped field; so do we.
  for (const text of ['{"warn_at": "900"}', '{"crit_at": 1.5}', "[1]", "not json", "", null, undefined]) {
    assert.deepEqual({ ...Cache.parseSettings(text) }, { ...defaults }, String(text))
  }
})

test("parseTimers reads the plugin state file", () => {
  const parsed = Cache.parseTimers('{"w1:p8":{"last_turn":1789207243,"ttl_seconds":3600},"wA:p2":{"last_turn":1789296098,"ttl_seconds":300}}')
  assert.equal(parsed.error, "")
  assert.deepEqual({ ...parsed.timers["w1:p8"] }, { lastTurn: 1789207243, ttlSeconds: 3600 })
  assert.deepEqual({ ...parsed.timers["wA:p2"] }, { lastTurn: 1789296098, ttlSeconds: 300 })
})

test("parseTimers skips malformed entries and unsafe keys", () => {
  const parsed = Cache.parseTimers(JSON.stringify({
    good: { last_turn: 10, ttl_seconds: 60 },
    noTtl: { last_turn: 10 },
    zeroTtl: { last_turn: 10, ttl_seconds: 0 },
    stringTurn: { last_turn: "10", ttl_seconds: 60 },
    fraction: { last_turn: 10.5, ttl_seconds: 60 },
    notObject: 5,
    "": { last_turn: 10, ttl_seconds: 60 }
  }).replace('"good"', '"__proto__":{"last_turn":1,"ttl_seconds":1},"good"'))
  assert.deepEqual(Object.keys(parsed.timers), ["good"])
  assert.equal(({}).last_turn, undefined)
  assert.equal(Object.getPrototypeOf(parsed.timers), Object.prototype)
})

test("parseTimers reports unreadable files and yields no timers", () => {
  for (const text of ["{", "[]", "42", "", null]) {
    const parsed = Cache.parseTimers(text)
    assert.deepEqual(Object.keys(parsed.timers), [], String(text))
    assert.notEqual(parsed.error, "", String(text))
  }
})

test("only kinds with a prompt cache get a Cache timer", () => {
  assert.equal(Cache.hasPromptCache("claude"), true)
  assert.equal(Cache.hasPromptCache("codex"), false)
  assert.equal(Cache.hasPromptCache(""), false)
  assert.equal(Cache.hasPromptCache(undefined), false)
})

test("remainingSeconds counts down from the last turn and never exceeds the ttl", () => {
  const timer = { lastTurn: 1000, ttlSeconds: 3600 }
  assert.equal(Cache.remainingSeconds(timer, 1000), 3600)
  assert.equal(Cache.remainingSeconds(timer, 1600), 3000)
  assert.equal(Cache.remainingSeconds(timer, 4600), 0)
  assert.equal(Cache.remainingSeconds(timer, 5000), -400)
  // A clock behind the plugin's must not show more than a full ttl.
  assert.equal(Cache.remainingSeconds(timer, 500), 3600)
})

test("level uses the plugin's inclusive thresholds and cold at expiry", () => {
  assert.equal(Cache.level(601, defaults), "ok")
  assert.equal(Cache.level(600, defaults), "warn")
  assert.equal(Cache.level(301, defaults), "warn")
  assert.equal(Cache.level(300, defaults), "critical")
  assert.equal(Cache.level(1, defaults), "critical")
  assert.equal(Cache.level(0, defaults), "cold")
  assert.equal(Cache.level(-30, defaults), "cold")
})

test("level honours custom thresholds", () => {
  const s = { ttlSeconds: 3600, warnAt: 900, critAt: 120 }
  assert.equal(Cache.level(901, s), "ok")
  assert.equal(Cache.level(900, s), "warn")
  assert.equal(Cache.level(120, s), "critical")
})

test("format: whole minutes while ok, m:ss in warn and critical, cold when expired", () => {
  assert.equal(Cache.formatRemaining(42 * 60 + 59, "ok"), "42m")
  assert.equal(Cache.formatRemaining(3600, "ok"), "60m")
  assert.equal(Cache.formatRemaining(600, "warn"), "10:00")
  assert.equal(Cache.formatRemaining(9 * 60 + 5, "warn"), "9:05")
  assert.equal(Cache.formatRemaining(59, "critical"), "0:59")
  assert.equal(Cache.formatRemaining(0, "cold"), "cold")
  assert.equal(Cache.formatRemaining(-100, "cold"), "cold")
})

test("cacheTimer combines kind, timer and clock for one Agent", () => {
  const timers = { "w1:p1": { lastTurn: 1000, ttlSeconds: 3600 } }
  const claude = { paneId: "w1:p1", kind: "claude" }
  assert.deepEqual({ ...Cache.cacheTimer(claude, timers, 1000 + 3600 - 2520, defaults) }, { remaining: 2520, level: "ok", label: "42m" })
  assert.deepEqual({ ...Cache.cacheTimer(claude, timers, 1000 + 3600 - 299, defaults) }, { remaining: 299, level: "critical", label: "4:59" })
  assert.deepEqual({ ...Cache.cacheTimer(claude, timers, 9000, defaults) }, { remaining: -4400, level: "cold", label: "cold" })
})

test("cacheTimer is null without a prompt cache or a timer", () => {
  const timers = { "w1:p1": { lastTurn: 1000, ttlSeconds: 3600 } }
  assert.equal(Cache.cacheTimer({ paneId: "w1:p1", kind: "codex" }, timers, 1200, defaults), null)
  assert.equal(Cache.cacheTimer({ paneId: "w1:p2", kind: "claude" }, timers, 1200, defaults), null)
  assert.equal(Cache.cacheTimer(null, timers, 1200, defaults), null)
  assert.equal(Cache.cacheTimer({ paneId: "w1:p1", kind: "claude" }, null, 1200, defaults), null)
})

test("cacheTimer falls back to default settings", () => {
  const timers = { "w1:p1": { lastTurn: 1000, ttlSeconds: 3600 } }
  assert.equal(Cache.cacheTimer({ paneId: "w1:p1", kind: "claude" }, timers, 1000 + 3000, undefined).level, "warn")
})

test("remainingByPane maps every Agent with a Cache timer", () => {
  const timers = { a: { lastTurn: 100, ttlSeconds: 60 }, b: { lastTurn: 100, ttlSeconds: 60 }, gone: { lastTurn: 100, ttlSeconds: 60 } }
  const agents = [{ paneId: "a", kind: "claude" }, { paneId: "b", kind: "codex" }, { paneId: "c", kind: "claude" }]
  assert.deepEqual({ ...Cache.remainingByPane(agents, timers, 130) }, { a: 30 })
})

test("hasLiveTimer tells the display clock whether a countdown is visible", () => {
  const timers = { a: { lastTurn: 100, ttlSeconds: 60 } }
  assert.equal(Cache.hasLiveTimer([{ paneId: "a", kind: "claude" }], timers, 130), true)
  assert.equal(Cache.hasLiveTimer([{ paneId: "a", kind: "claude" }], timers, 200), false)
  assert.equal(Cache.hasLiveTimer([{ paneId: "a", kind: "codex" }], timers, 130), false)
  assert.equal(Cache.hasLiveTimer([], timers, 130), false)
})

test("nowSeconds converts a millisecond clock", () => {
  assert.equal(Cache.nowSeconds(1789296098999), 1789296098)
})
