"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")
const loadLib = require("./support/loadLib.cjs")

const H = loadLib("lib/HerdrModel.js")

// Reply lines as herdr 0.8.2 sends them (captured from the live socket).
const PONG_0_8_2 = '{"id":"gjetr:1:ping","result":{"type":"pong","version":"0.8.2","protocol":20,"capabilities":{"live_handoff":true,"detached_server_daemon":true}}}'
const UNKNOWN_METHOD = '{"id":"","error":{"code":"invalid_request","message":"invalid request: unknown variant `bogus.method`, expected one of `ping`, `server.stop`, `session.snapshot`"}}'
const UNKNOWN_SUBSCRIPTION = '{"id":"","error":{"code":"invalid_request","message":"invalid request: unknown variant `bogus.thing`, expected one of `workspace.created`, `workspace.updated`"}}'

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

test("the supported set is herdr 0.8.2 (protocol 20) and 0.9.0 (protocol 22)", () => {
  assert.deepEqual(plain(H.SUPPORTED), [{ version: "0.8.2", protocol: 20 }, { version: "0.9.0", protocol: 22 }])
})

test("pingLine asks for a pong", () => {
  const line = H.pingLine("gjetr:1:ping")
  assert.ok(line.endsWith("\n"))
  assert.deepEqual(JSON.parse(line), { id: "gjetr:1:ping", method: "ping", params: {} })
})

test("a pong gives the server's version and protocol", () => {
  assert.deepEqual(plain(H.pongFromReply(H.parseReplyLine(PONG_0_8_2))), { version: "0.8.2", protocol: 20 })
})

test("a reply that is not a usable pong gives null", () => {
  assert.equal(H.pongFromReply(H.parseReplyLine(UNKNOWN_METHOD)), null)
  assert.equal(H.pongFromReply(H.parseReplyLine('{"id":"x","result":{"type":"snapshot"}}')), null)
  assert.equal(H.pongFromReply(H.parseReplyLine('{"id":"x","result":{"type":"pong","version":"0.8.2","protocol":"20"}}')), null)
  assert.equal(H.pongFromReply(H.parseReplyLine('{"id":"x","result":{"type":"pong","version":"0.8.2","protocol":-1}}')), null)
  assert.equal(H.pongFromReply(H.parseReplyLine("not json")), null)
  assert.equal(H.pongFromReply(null), null)
})

test("a pong without a version string still gives its protocol", () => {
  assert.deepEqual(plain(H.pongFromReply(H.parseReplyLine('{"id":"x","result":{"type":"pong","protocol":22}}'))),
    { version: "", protocol: 22 })
})

test("protocols 20 and 22 are supported; any other is a mismatch, never a failure", () => {
  assert.deepEqual(plain(H.protocolStatus({ version: "0.8.2", protocol: 20 })),
    { version: "0.8.2", protocol: 20, supported: true, mismatch: null })
  assert.deepEqual(plain(H.protocolStatus({ version: "0.9.0", protocol: 22 })),
    { version: "0.9.0", protocol: 22, supported: true, mismatch: null })
  // The protocol decides: a patch release speaking protocol 22 is fine.
  assert.equal(H.protocolStatus({ version: "0.9.1", protocol: 22 }).mismatch, null)
  assert.deepEqual(plain(H.protocolStatus({ version: "0.10.0", protocol: 23 })), {
    version: "0.10.0", protocol: 23, supported: false,
    mismatch: { version: "0.10.0", protocol: 23, supported: [{ version: "0.8.2", protocol: 20 }, { version: "0.9.0", protocol: 22 }] }
  })
  assert.equal(H.protocolStatus({ version: "0.8.0", protocol: 19 }).supported, false)
})

test("before a pong the protocol is unknown, which is not a mismatch", () => {
  assert.deepEqual(plain(H.protocolStatus(null)), { version: "", protocol: null, supported: false, mismatch: null })
})

test("the mismatch cue is quiet and names the server", () => {
  assert.equal(H.mismatchCue(H.protocolStatus({ version: "0.10.0", protocol: 23 }).mismatch), "untested herdr 0.10.0 (protocol 23)")
  assert.equal(H.mismatchCue({ version: "", protocol: 23 }), "untested herdr (protocol 23)")
  assert.equal(H.mismatchCue(null), "")
})

test("an unknown variant reply names the feature herdr does not have", () => {
  assert.equal(H.unsupportedVariant(H.parseReplyLine(UNKNOWN_METHOD).error), "bogus.method")
  const item = H.classifyStreamLine(UNKNOWN_SUBSCRIPTION)
  assert.equal(item.kind, "error")
  assert.equal(H.unsupportedVariant(item.error), "bogus.thing")
})

test("any other error is not an unsupported feature", () => {
  assert.equal(H.unsupportedVariant({ code: "not_found", message: "unknown variant `x`" }), "")
  assert.equal(H.unsupportedVariant({ code: "invalid_request", message: "missing field `pane_id`" }), "")
  assert.equal(H.unsupportedVariant({ code: "invalid_request", message: "unknown variant" }), "")
  assert.equal(H.unsupportedVariant(null), "")
})

test("subscribeLine subscribes to the given types, else the default set", () => {
  const types = request => JSON.parse(request).params.subscriptions.map(s => s.type)
  assert.deepEqual(types(H.subscribeLine("s")), Array.from(H.SUBSCRIPTION_TYPES))
  assert.deepEqual(types(H.subscribeLine("s", ["pane.updated", "tab.focused"])), ["pane.updated", "tab.focused"])
})

test("withoutType drops one subscription type and keeps the rest in order", () => {
  assert.deepEqual(Array.from(H.withoutType(["a", "b", "c"], "b")), ["a", "c"])
  assert.deepEqual(Array.from(H.withoutType(["a", "c"], "x")), ["a", "c"])
  assert.deepEqual(Array.from(H.withoutType(null, "x")), [])
})
