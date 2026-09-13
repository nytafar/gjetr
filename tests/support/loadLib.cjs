// Loads a QML-flavoured lib/*.js file under node. QML JavaScript files start
// with `.pragma library`, which node cannot parse, so strip that line and run
// the rest in a fresh context that provides a CommonJS `module`.
// Same approach as OmaDeck's tests (github.com/TheAirick/OmaDeck, MIT,
// Copyright (c) 2026 Erik Holum).
"use strict"

const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")

const repoRoot = path.join(__dirname, "..", "..")

module.exports = function loadLib(relativePath) {
  const file = path.join(repoRoot, relativePath)
  const source = fs.readFileSync(file, "utf8").replace(/^\.pragma library[ \t]*$/m, "")
  const module = { exports: {} }
  vm.runInNewContext(source, { module: module, exports: module.exports }, { filename: file })
  return module.exports
}
