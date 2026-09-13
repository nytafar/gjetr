// Loads a QML-flavoured lib/*.js file under node. QML JavaScript files start
// with `.pragma library`, which node cannot parse, so strip that line and run
// the rest with a CommonJS `module`. Stripping the pragma is the same approach
// as OmaDeck's tests (github.com/TheAirick/OmaDeck, MIT, Copyright (c) 2026
// Erik Holum).
//
// The code runs in this realm through a function wrapper rather than a fresh
// vm context, so arrays and objects it returns share node's prototypes and
// compare cleanly under node:assert/strict.
"use strict"

const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")

const repoRoot = path.join(__dirname, "..", "..")

module.exports = function loadLib(relativePath) {
  const file = path.join(repoRoot, relativePath)
  const source = fs.readFileSync(file, "utf8").replace(/^\.pragma library[ \t]*$/m, "")
  const module = { exports: {} }
  const wrapped = vm.runInThisContext("(function (module, exports) {" + source + "\n})", { filename: file })
  wrapped(module, module.exports)
  return module.exports
}
