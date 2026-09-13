"use strict"

// The kind marks gjetr ships in assets/kinds/. They are drawn by Qt's SVG
// renderer inside the shell, so each file must be a plain one-colour shape:
// only a small set of shape elements and attributes, one fill of currentColor
// on the root, a square viewBox, nothing that runs, loads or embeds anything.

const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const loadLib = require("./support/loadLib.cjs")

const Kind = loadLib("lib/KindPolicy.js")

const DIR = path.join(__dirname, "..", "assets", "kinds")
const SVG_NS = "http://www.w3.org/2000/svg"
const MAX_BYTES = 32 * 1024

const ELEMENTS = new Set(["svg", "title", "g", "path", "rect", "circle", "ellipse", "polygon"])
const ATTRIBUTES = new Set(["xmlns", "viewBox", "fill", "fill-rule", "clip-rule", "d", "x", "y", "width", "height",
  "rx", "ry", "cx", "cy", "r", "points", "transform"])
const BANNED = ["<!", "<?", "&", "url(", "href", "data:", "script", "style", "base64"]
const TAG = /<(\/?)([A-Za-z][\w:-]*)((?:\s+[A-Za-z][\w:-]*="[^"<>]*")*)\s*(\/?)>/g
const ATTRIBUTE = /([A-Za-z][\w:-]*)="([^"<>]*)"/g

const svgFiles = () => fs.readdirSync(DIR).filter(name => name.endsWith(".svg")).sort()

// What is wrong with an SVG's source, as messages; [] when it is safe to draw.
function problems(source) {
  const out = []
  if (Buffer.byteLength(source) > MAX_BYTES) out.push(`larger than ${MAX_BYTES} bytes`)
  for (const banned of BANNED) {
    if (source.toLowerCase().includes(banned)) out.push(`contains ${banned}`)
  }
  // A title's text is the only text allowed.
  const body = source.replace(/<title>[^<>&]*<\/title>/g, "<title/>")
  const tags = [...body.matchAll(TAG)]
  const rest = body.replace(TAG, "").trim()
  if (rest !== "") out.push(`text outside tags: ${rest.slice(0, 40)}`)
  if (tags.length === 0 || tags[0][2] !== "svg" || tags[0][1] !== "") out.push("does not start with <svg>")
  const open = []
  let fills = 0
  for (const [, closing, element, attributes, selfClosing] of tags) {
    if (!ELEMENTS.has(element)) out.push(`element <${element}>`)
    if (closing) {
      if (open.pop() !== element) out.push(`unbalanced </${element}>`)
      continue
    }
    if (!selfClosing) open.push(element)
    for (const [, attribute, value] of attributes.matchAll(ATTRIBUTE)) {
      if (!ATTRIBUTES.has(attribute)) out.push(`attribute ${attribute} on <${element}>`)
      if (attribute === "xmlns" && value !== SVG_NS) out.push(`xmlns ${value}`)
      if (attribute === "fill") {
        fills++
        if (value !== "currentColor") out.push(`fill ${value}`)
        if (element !== "svg") out.push(`fill on <${element}>`)
      }
    }
    if (element === "svg") {
      const box = /\sviewBox="([^"]*)"/.exec(attributes)
      const parts = box ? box[1].trim().split(/[\s,]+/).map(Number) : []
      if (parts.length !== 4 || parts.some(n => !isFinite(n)) || parts[2] <= 0 || parts[2] !== parts[3]) {
        out.push(`viewBox is not square: ${box ? box[1] : "none"}`)
      }
    }
  }
  if (open.length > 0) out.push(`unclosed <${open.join(">, <")}>`)
  if (fills !== 1) out.push(`${fills} fill attributes, expected fill="currentColor" on <svg> only`)
  return out
}

test("every shipped kind mark is a safe one-colour SVG", () => {
  const files = svgFiles()
  assert.ok(files.length > 0, "assets/kinds has marks")
  for (const name of files) assert.deepEqual(problems(fs.readFileSync(path.join(DIR, name), "utf8")), [], name)
})

test("the scan catches what must not ship", () => {
  const head = '<svg fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">'
  const caught = {
    script: head + "<script>x()</script></svg>",
    image: head + '<image href="a.png"/></svg>',
    external: '<svg fill="url(https://x/y)" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>',
    colour: '<svg fill="#D97757" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>',
    "second fill": head + '<path fill="#fff" d="M0 0"/></svg>',
    "no fill": '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>',
    handler: '<svg fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" onload="x()"><path d="M0 0"/></svg>',
    "not square": '<svg fill="currentColor" viewBox="0 0 120 90" xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>',
    entity: '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]>' + head + "<title>&x;</title></svg>",
    gradient: head + '<linearGradient id="g"/><path d="M0 0"/></svg>',
    unclosed: head + "<g><path d=\"M0 0\"/></svg>"
  }
  for (const [name, source] of Object.entries(caught)) assert.ok(problems(source).length > 0, `${name} is caught`)
  assert.deepEqual(problems(head.replace(">", ' fill-rule="evenodd">') +
    '<title>Ok</title><path d="M0 0h24v24H0z"></path><circle cx="1" cy="1" r="1"/></svg>'), [])
})

test("assets/kinds holds exactly one mark per kind the table ships, named by kind", () => {
  const shipped = Kind.KINDS.filter(kind => Kind.kindIcon(kind, false).origin === "gjetr")
  assert.deepEqual(svgFiles(), shipped.map(kind => kind + ".svg").sort())
  for (const kind of shipped) {
    assert.equal(Kind.kindIconFile(kind, false), kind + ".svg", kind)
    assert.equal(Kind.kindIconFile(kind, true), kind + ".svg", `${kind} needs no light variant`)
    assert.equal(Kind.kindIconTinted(kind), true, kind)
  }
})
