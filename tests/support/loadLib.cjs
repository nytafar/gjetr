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

// `.import "other.js" as Name` lines are resolved relative to the file and
// passed in as a parameter called Name, which is what QML binds.
const IMPORT = /^\.import[ \t]+"([^"]+)"[ \t]+as[ \t]+([A-Za-z_$][\w$]*)[ \t]*;?[ \t]*$/gm

module.exports = function loadLib(relativePath) {
  const file = path.join(repoRoot, relativePath)
  const names = []
  const values = []
  const source = fs.readFileSync(file, "utf8")
    .replace(/^\.pragma library[ \t]*$/m, "")
    .replace(IMPORT, (line, target, name) => {
      names.push(name)
      values.push(loadLib(path.relative(repoRoot, path.join(path.dirname(file), target))))
      return ""
    })
  const module = { exports: {} }
  const params = ["module", "exports"].concat(names).join(", ")
  const wrapped = vm.runInThisContext("(function (" + params + ") {" + source + "\n})", { filename: file })
  wrapped.apply(null, [module, module.exports].concat(values))
  return module.exports
}
