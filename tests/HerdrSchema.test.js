"use strict"

// HerdrModel held to the schema of every supported herdr build, from the
// fixtures in tests/fixtures/herdr-<version>/ (captured with
// `node scripts/gen-herdr-schema.mjs --capture`).

const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { execFileSync } = require("node:child_process")
const loadLib = require("./support/loadLib.cjs")

const H = loadLib("lib/HerdrModel.js")
const Schema = loadLib("lib/HerdrSchema.js")
const Kind = loadLib("lib/KindPolicy.js")

const ROOT = path.join(__dirname, "..")
const VERSIONS = ["0.8.2", "0.9.0"]

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

function fixture(version, file) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "tests", "fixtures", "herdr-" + version, file), "utf8"))
}

function table(version) {
  const entry = Schema.VERSIONS.find(v => v.version === version)
  assert.ok(entry, "generated table has herdr " + version)
  return entry
}

// The event payload fields `reduce` reads, per event.
const EVENT_READS = {
  pane_created: ["pane"],
  pane_updated: ["pane"],
  pane_focused: ["pane_id", "workspace_id"],
  tab_focused: ["tab_id", "workspace_id"],
  workspace_focused: ["workspace_id"],
  pane_closed: ["pane_id"],
  pane_exited: ["pane_id"],
  pane_moved: ["pane", "previous_pane_id", "closed_tab_id", "closed_workspace_id", "created_workspace", "created_tab"],
  pane_agent_detected: ["pane_id", "agent", "released"],
  pane_agent_status_changed: ["pane_id", "agent_status", "agent", "display_agent"],
  tab_created: ["tab"],
  tab_moved: ["tabs"],
  tab_renamed: ["tab_id", "label"],
  tab_closed: ["tab_id"],
  workspace_created: ["workspace"],
  workspace_updated: ["workspace"],
  workspace_metadata_updated: ["workspace"],
  worktree_created: ["workspace"],
  worktree_opened: ["workspace"],
  workspace_moved: ["workspaces"],
  workspace_reordered: ["workspaces"],
  workspace_renamed: ["workspace_id", "label"],
  workspace_closed: ["workspace_id"]
}

// ------------------------------------------------------------------ schema-shaped samples

const REF = /^#\/schemas\/([a-z_]+)\/\$defs\/([A-Za-z0-9_]+)$/

function resolve(schema, node) {
  if (!node || typeof node.$ref !== "string") return node
  const match = REF.exec(node.$ref)
  return schema.schemas[match[1]].$defs[match[2]]
}

// A plausible value for a property schema: the first enum value, the first
// non-null branch or type, a string naming the property.
function sampleValue(schema, node, name) {
  const def = resolve(schema, node)
  if (!def) return null
  if (Array.isArray(def.enum)) return def.enum[0]
  if (def.const !== undefined) return def.const
  const branches = def.anyOf || def.oneOf
  if (Array.isArray(branches)) return sampleValue(schema, branches.find(b => b.type !== "null") || branches[0], name)
  const type = Array.isArray(def.type) ? def.type.find(t => t !== "null") : def.type
  if (type === "string") return name + "-sample"
  if (type === "integer" || type === "number") return 3
  if (type === "boolean") return false
  if (type === "array") return []
  if (type === "object") return {}
  return null
}

// An object with every property the schema gives `defName`, then `values` for
// the keys the schema has. A value for a key the schema lacks is dropped, so a
// field herdr renamed shows up as a missing Agent field.
function sample(schema, defName, values) {
  const def = schema.schemas.success_response.$defs[defName]
  assert.ok(def, defName)
  const out = {}
  for (const [name, node] of Object.entries(def.properties)) out[name] = sampleValue(schema, node, name)
  for (const [name, value] of Object.entries(values)) if (name in def.properties) out[name] = value
  return out
}

// ------------------------------------------------------------------ tests

test("the generated table is current with the fixtures", () => {
  const out = execFileSync(process.execPath, [path.join(ROOT, "scripts", "gen-herdr-schema.mjs"), "--check", "--fixtures-only"],
    { encoding: "utf8" })
  assert.match(out, /up to date/)
})

test("the fixtures are the supported set: herdr 0.8.2 on protocol 20 and 0.9.0 on protocol 22", () => {
  assert.deepEqual(plain(Schema.SUPPORTED), [{ version: "0.8.2", protocol: 20 }, { version: "0.9.0", protocol: 22 }])
  assert.deepEqual(plain(H.SUPPORTED), plain(Schema.SUPPORTED))
  for (const version of VERSIONS) {
    assert.equal(fixture(version, "schema.json").protocol, table(version).protocol)
    assert.equal(fixture(version, "agent-kinds.json").herdr, version)
  }
})

test("HANDLED_EVENTS lists exactly the events reduce has a case for", () => {
  const source = fs.readFileSync(path.join(ROOT, "lib", "HerdrModel.js"), "utf8")
  const body = source.slice(source.indexOf("function reduce("), source.indexOf("function applyEvent("))
  const cases = [...body.matchAll(/case "([a-z_]+)":/g)].map(m => m[1])
  assert.deepEqual([...cases].sort(), [...H.HANDLED_EVENTS].sort())
  assert.deepEqual(Object.keys(EVENT_READS).sort(), [...H.HANDLED_EVENTS].sort())
})

for (const version of VERSIONS) {
  test(`herdr ${version}: every event HerdrModel folds is one herdr sends, with the fields it reads`, () => {
    const t = table(version)
    for (const event of H.HANDLED_EVENTS) {
      assert.ok(t.eventKinds.includes(event), `${event} is an event kind`)
      for (const field of EVENT_READS[event]) assert.ok(t.eventFields[event].includes(field), `${event}.${field}`)
    }
  })

  test(`herdr ${version}: every subscription type gjetr asks for exists`, () => {
    const t = table(version)
    for (const type of H.SUBSCRIPTION_TYPES) assert.ok(t.subscriptionTypes.includes(type), type)
  })

  test(`herdr ${version}: requests gjetr sends carry what herdr requires and nothing it does not know`, () => {
    const t = table(version)
    const lines = {
      "ping": H.pingLine("i"),
      "session.snapshot": H.requestLine("i", "session.snapshot"),
      "events.subscribe": H.subscribeLine("i"),
      "pane.focus": H.focusTargetLine("i", "pane", "w1:p1"),
      "tab.focus": H.focusTargetLine("i", "tab", "w1:t1"),
      "workspace.focus": H.focusTargetLine("i", "workspace", "w1")
    }
    for (const [method, line] of Object.entries(lines)) {
      const request = JSON.parse(line)
      assert.equal(request.method, method)
      assert.ok(t.methods.includes(method), `${method} is a method`)
      const sent = Object.keys(request.params).sort()
      const params = t.requestParams[method]
      for (const name of params.required) assert.ok(sent.includes(name), `${method} sends ${name}`)
      for (const name of sent) assert.ok(params.properties.includes(name), `${method} knows ${name}`)
    }
  })

  test(`herdr ${version}: pong and snapshot replies carry what gjetr reads`, () => {
    const t = table(version)
    for (const field of ["type", "version", "protocol"]) assert.ok(t.resultFields.pong.includes(field), `pong.${field}`)
    assert.ok(t.resultFields.session_snapshot.includes("snapshot"))
    assert.ok(t.resultFields.subscription_started.includes("type"))
    for (const field of ["workspaces", "tabs", "panes", "agents", "focused_pane_id", "focused_tab_id", "focused_workspace_id"])
      assert.ok(t.fields.snapshot.includes(field), `snapshot.${field}`)
  })

  test(`herdr ${version}: a snapshot shaped by the schema becomes an Agent with every field`, () => {
    const schema = fixture(version, "schema.json")
    const uuid = "cf43ca7f-58ec-4ecd-a3ae-8efb244388cc"
    const ids = { pane_id: "w1:p1", tab_id: "w1:t1", workspace_id: "w1" }
    const snapshot = sample(schema, "SessionSnapshot", {
      focused_pane_id: "w1:p1", focused_tab_id: "w1:t1", focused_workspace_id: "w1",
      workspaces: [sample(schema, "WorkspaceInfo", { workspace_id: "w1", label: "hvelv", number: 2, agent_status: "working" })],
      tabs: [sample(schema, "TabInfo", { tab_id: "w1:t1", workspace_id: "w1", label: "api", number: 4, agent_status: "working" })],
      panes: [sample(schema, "PaneInfo", Object.assign({}, ids, {
        agent: "claude", display_agent: "Claude Code", agent_status: "working", label: "pane-label",
        terminal_title_stripped: "Fix bug", cwd: "/srv", foreground_cwd: "/srv/a"
      }))],
      agents: [sample(schema, "AgentInfo", Object.assign({}, ids, {
        agent: "claude", name: "reviewer", state_change_seq: 5,
        agent_session: { source: "herdr:claude", agent: "claude", kind: "id", value: uuid }
      }))]
    })
    const state = H.fromSnapshot(snapshot)
    const [agent] = H.agents(state)
    assert.deepEqual(plain(agent), {
      paneId: "w1:p1", tabId: "w1:t1", workspaceId: "w1", kind: "claude", displayKind: "Claude Code",
      status: "working", title: "Fix bug", name: "reviewer", paneLabel: "pane-label", cwd: "/srv/a",
      stateChangeSeq: 5, sessionId: uuid, focused: true,
      tabLabel: "api", tabNumber: 4, workspaceLabel: "hvelv", workspaceNumber: 2
    })
    const tree = H.tree(state)
    assert.deepEqual([tree.focusedWorkspaceId, tree.workspaces[0].status, tree.workspaces[0].tabs[0].status], ["w1", "working", "working"])
  })

  test(`herdr ${version}: every agent kind and integration target has a label and a mark or letter`, () => {
    const t = table(version)
    assert.deepEqual(t.agentKinds, fixture(version, "agent-kinds.json").kinds)
    for (const kind of t.agentKinds) {
      assert.equal(Kind.canonicalKind(kind), kind, `${kind} is in the kind table`)
    }
    for (const kind of t.agentKinds.concat(t.integrationTargets)) {
      const mark = Kind.kindMark(kind, "", false)
      assert.ok(Kind.canonicalKind(kind) !== "", `${kind} resolves to a kind`)
      assert.ok(mark.label !== "" && (mark.file !== "" || mark.letter !== ""), kind)
    }
  })
}

test("the kind table covers exactly the kinds of the supported builds", () => {
  assert.deepEqual([...Kind.KINDS].sort(), [...Schema.AGENT_KINDS].sort())
})

test("herdr 0.9.0 reports every 0.8.2 kind and adds muse", () => {
  const before = table("0.8.2").agentKinds
  const after = table("0.9.0").agentKinds
  assert.deepEqual(after.filter(kind => !before.includes(kind)), ["muse"])
  assert.deepEqual(before.filter(kind => !after.includes(kind)), [])
})
