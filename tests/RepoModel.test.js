"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")
const loadLib = require("./support/loadLib.cjs")

const Repo = loadLib("lib/RepoModel.js")

const HOME = "/home/test"

test("a cwd is an absolute path without control characters or parent steps", () => {
  assert.equal(Repo.isCwd("/home/test/code/gjetr"), true)
  assert.equal(Repo.isCwd("/"), true)
  for (const bad of ["", "relative/x", "~/code", "/a/../etc", "/a/..", "/a\nb", "/a\u0000b", "/a\u202eb", null, 12, "/" + "x".repeat(Repo.MAX_CWD)]) {
    assert.equal(Repo.isCwd(bad), false, JSON.stringify(bad))
  }
})

test("rev-parse output: toplevel and branch", () => {
  assert.deepEqual({ ...Repo.parseRevParse("/home/test/code/gjetr\nmain\n", 0) },
    { toplevel: "/home/test/code/gjetr", repo: "gjetr", branch: "main", detached: false })
  assert.deepEqual({ ...Repo.parseRevParse("/home/test/code/wt-density\nfeature/full-card\n", 0) },
    { toplevel: "/home/test/code/wt-density", repo: "wt-density", branch: "feature/full-card", detached: false })
})

test("a detached HEAD has no branch", () => {
  assert.deepEqual({ ...Repo.parseRevParse("/srv/x\nHEAD\n", 0) }, { toplevel: "/srv/x", repo: "x", branch: "", detached: true })
})

test("not a repository, junk and hostile output give no repo", () => {
  assert.equal(Repo.parseRevParse("", 128), null)
  assert.equal(Repo.parseRevParse("/srv/x\nmain\n", 128), null)
  assert.equal(Repo.parseRevParse("", 0), null)
  assert.equal(Repo.parseRevParse("relative\nmain\n", 0), null)
  assert.equal(Repo.parseRevParse("/srv/x\n", 0), null)
  assert.equal(Repo.parseRevParse(null, 0), null)
  assert.equal(Repo.parseRevParse("/srv/re\u202epo\nmain\n", 0), null)
  // A branch name carrying terminal or bidi controls is cleaned and capped.
  const info = Repo.parseRevParse("/srv/repo\nma\u001b[31m\u202ein" + "x".repeat(200) + "\n", 0)
  assert.equal(/[\u0000-\u001f\u202e]/.test(info.repo + info.branch), false)
  assert.ok(info.branch.length <= Repo.MAX_BRANCH)
})

test("shortPath puts home as ~ and keeps the last two directories of a long path", () => {
  assert.equal(Repo.shortPath("/home/test", HOME), "~")
  assert.equal(Repo.shortPath("/home/test/code", HOME), "~/code")
  assert.equal(Repo.shortPath("/home/test/code/nytafar/gjetr", HOME), "~/\u2026/nytafar/gjetr")
  assert.equal(Repo.shortPath("/home/tester/x", HOME), "/\u2026/tester/x")
  assert.equal(Repo.shortPath("/home/tester", HOME), "/home/tester")
  assert.equal(Repo.shortPath("/srv/a/b/c", HOME), "/\u2026/b/c")
  assert.equal(Repo.shortPath("/", HOME), "/")
  assert.equal(Repo.shortPath("", HOME), "")
  assert.equal(Repo.shortPath("/a/b\u001bc", HOME), "/a/b c")
})

test("the location label: repo and branch, else the short path", () => {
  const repo = Repo.parseRevParse("/home/test/code/gjetr\nmain\n", 0)
  assert.deepEqual({ ...Repo.label(repo, "/home/test/code/gjetr/lib", HOME) },
    { repo: "gjetr", branch: "main", path: "", text: "gjetr " + Repo.BRANCH_MARK + " main" })
  const detached = Repo.parseRevParse("/srv/x\nHEAD\n", 0)
  assert.equal(Repo.label(detached, "/srv/x", HOME).text, "x " + Repo.BRANCH_MARK + " detached")
  assert.deepEqual({ ...Repo.label(null, "/home/test/notes/daily", HOME) },
    { repo: "", branch: "", path: "~/notes/daily", text: "~/notes/daily" })
  assert.equal(Repo.label(undefined, "", HOME).text, "")
})

test("due cwds: new ones, stale ones, never those in flight; cwds no longer used are pruned", () => {
  const agents = [{ cwd: "/a" }, { cwd: "/b" }, { cwd: "/a" }, { cwd: "relative" }, { cwd: "" }, null]
  const checked = { "/a": 1000, "/gone": 1000 }
  assert.deepEqual(Array.from(Repo.dueCwds(agents, checked, {}, 1000 + 5000, 30000)), ["/b"])
  assert.deepEqual(Array.from(Repo.dueCwds(agents, checked, {}, 1000 + 30000, 30000)), ["/a", "/b"])
  assert.deepEqual(Array.from(Repo.dueCwds(agents, checked, { "/b": true }, 1000 + 30000, 30000)), ["/a"])
  assert.deepEqual(Array.from(Repo.dueCwds(agents, checked, {}, 1000 + 30000, 30000, 1)), ["/a"])
  const pruned = Repo.prune(checked, agents)
  assert.deepEqual(Object.keys(pruned), ["/a"])
  // Nothing to drop: the same object, so bindings do not re-evaluate.
  assert.equal(Repo.prune(pruned, agents), pruned)
})

test("info for an Agent follows its cwd; answers compare by what they show", () => {
  const main = Repo.parseRevParse("/a\nmain\n", 0)
  const repos = { "/a": main, "/n": null }
  assert.equal(Repo.infoFor({ cwd: "/a" }, repos).repo, "a")
  assert.equal(Repo.infoFor({ cwd: "/n" }, repos), null)
  assert.equal(Repo.infoFor({ cwd: "/b" }, repos), null)
  assert.equal(Repo.infoFor(null, repos), null)
  assert.equal(Repo.sameInfo(main, Repo.parseRevParse("/a\nmain\n", 0)), true)
  assert.equal(Repo.sameInfo(main, Repo.parseRevParse("/a\ndev\n", 0)), false)
  assert.equal(Repo.sameInfo(null, null), true)
  assert.equal(Repo.sameInfo(main, null), false)
})

test("a compact location line joins the Repo and workspace \u203a tab", () => {
  assert.equal(Repo.withLocation("gjetr " + Repo.BRANCH_MARK + " main", "code \u203a 1"), "gjetr " + Repo.BRANCH_MARK + " main \u00b7 code \u203a 1")
  assert.equal(Repo.withLocation("", "code \u203a 1"), "code \u203a 1")
  assert.equal(Repo.withLocation("~/notes", ""), "~/notes")
  assert.equal(Repo.withLocation(null, undefined), "")
})

// step: the Repo pipeline, driven by a script of events.

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

function git(cwd) {
  return ["git", "-C", cwd, "rev-parse", "--show-toplevel", "--abbrev-ref", "HEAD"]
}

test("step: Agents arriving ask git once per distinct cwd", () => {
  const out = Repo.step(Repo.initial(), { type: "agents", agents: [{ cwd: "/a" }, { cwd: "/b" }, { cwd: "/a" }] }, 1000)
  assert.deepEqual(plain(out.commands), [{ id: "repo:/a", argv: git("/a") }, { id: "repo:/b", argv: git("/b") }])
})

test("step: replies in any order publish each cwd's Repo; an answer that shows the same keeps the state", () => {
  const agents = [{ cwd: "/home/test/code/gjetr" }, { cwd: "/home/test/notes" }]
  let out = Repo.step(Repo.initial(), { type: "agents", agents }, 1000)
  out = Repo.step(out.state, { type: "reply", id: "repo:/home/test/notes", text: "", code: 128 }, 1200)
  assert.deepEqual(plain(out.state.repos), { "/home/test/notes": null })
  assert.deepEqual(plain(out.commands), [])
  out = Repo.step(out.state, { type: "reply", id: "repo:/home/test/code/gjetr", text: "/home/test/code/gjetr\nmain\n", code: 0 }, 1300)
  assert.equal(out.state.repos["/home/test/code/gjetr"].branch, "main")
  assert.deepEqual(plain(out.state.inFlight), {})
  const repos = out.state.repos

  // 30 s on, both are asked again; the same answers change nothing a binding reads.
  out = Repo.step(out.state, { type: "tick" }, 31300)
  assert.deepEqual(plain(out.commands.map(c => c.id)), ["repo:/home/test/code/gjetr", "repo:/home/test/notes"])
  out = Repo.step(out.state, { type: "reply", id: "repo:/home/test/code/gjetr", text: "/home/test/code/gjetr\nmain\n", code: 0 }, 31400)
  out = Repo.step(out.state, { type: "reply", id: "repo:/home/test/notes", text: "", code: 128 }, 31500)
  assert.equal(out.state.repos, repos)
  // A reply nobody is waiting for is dropped.
  const settled = out.state
  assert.equal(Repo.step(settled, { type: "reply", id: "repo:/home/test/notes", text: "/home/test/notes\nx\n", code: 0 }, 31600).state, settled)
})

test("step: an Agent leaving drops its cwd's Repo; Agents unchanged keep everything", () => {
  let out = Repo.step(Repo.initial(), { type: "agents", agents: [{ cwd: "/a" }, { cwd: "/b" }] }, 1000)
  out = Repo.step(out.state, { type: "reply", id: "repo:/a", text: "/a\nmain\n", code: 0 }, 1100)
  out = Repo.step(out.state, { type: "reply", id: "repo:/b", text: "/b\ndev\n", code: 0 }, 1100)
  const both = out.state
  // The same Agents again (herdr republishing, or Offline keeping the last ones).
  out = Repo.step(both, { type: "agents", agents: [{ cwd: "/a" }, { cwd: "/b" }] }, 2000)
  assert.equal(out.state.repos, both.repos)
  assert.deepEqual(plain(out.commands), [])
  out = Repo.step(out.state, { type: "agents", agents: [{ cwd: "/a" }] }, 3000)
  assert.deepEqual(Object.keys(out.state.repos), ["/a"])
  assert.deepEqual(Object.keys(out.state.checked), ["/a"])
})
