"use strict"

// The kind mark's shader is bound by name: a ShaderEffect property becomes the
// uniform or sampler of the same name, and a name on one side only fails
// silently at runtime. And Qt Quick loads the generated .qsb, never the .frag.

const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

const root = path.join(__dirname, "..")
const shaders = path.join(root, "shaders")

test("every shader source has its generated .qsb beside it", () => {
  const frags = fs.readdirSync(shaders).filter((name) => name.endsWith(".frag"))
  assert.ok(frags.length > 0)
  for (const frag of frags) {
    const qsb = path.join(shaders, frag + ".qsb")
    assert.ok(fs.existsSync(qsb), `${frag}.qsb missing: run scripts/build-shaders.sh`)
    assert.ok(fs.statSync(qsb).size > 0, `${frag}.qsb is empty`)
  }
})

test("KindMark's ShaderEffect gives kind-fill.frag exactly the uniforms and samplers it reads", () => {
  const frag = fs.readFileSync(path.join(shaders, "kind-fill.frag"), "utf8")
  const block = frag.match(/uniform buf \{([\s\S]*?)\};/)
  assert.ok(block, "uniform block")
  const uniforms = [...block[1].matchAll(/^\s*\w+\s+(\w+);/gm)].map((m) => m[1]).filter((name) => !name.startsWith("qt_"))
  const samplers = [...frag.matchAll(/uniform sampler2D (\w+);/g)].map((m) => m[1])

  const qml = fs.readFileSync(path.join(root, "components", "KindMark.qml"), "utf8")
  const effect = qml.match(/ShaderEffect \{([\s\S]*?)\n\s{6}\}/)
  assert.ok(effect, "ShaderEffect in KindMark.qml")
  assert.match(effect[1], /fragmentShader: Qt\.resolvedUrl\("\.\.\/shaders\/kind-fill\.frag\.qsb"\)/)
  const properties = [...effect[1].matchAll(/^\s*property \w+ (\w+):/gm)].map((m) => m[1])

  assert.deepEqual([...properties].sort(), [...uniforms, ...samplers].sort())
})
