.pragma library

// Agent kinds: what herdr reports in `pane.agent` and `agents[].agent`, and how
// a Card or row shows one: a written label, and a mark. The mark is Omarchy's
// SVG in its brand colours where shell/plugins/agents/assets ships one (claude,
// codex), else gjetr's one-colour SVG from assets/kinds/<kind>.svg where the
// kind has a clearly licensed logo, drawn in the theme's colour, else a letter
// drawn in theme colours. A kind is never blank: an unknown one is shown by its
// own name and first letter.
//
// The kinds are herdr's `Agent::as_str` (src/detect/mod.rs), the list `herdr
// agent start --help` offers for `--kind`: 22 in herdr 0.8.2, and muse added in
// 0.9.0. Aliases are the other names herdr's own lookup accepts for a kind
// (`lookup_agent`), plus the integration target `antigravity_cli`, so a kind
// reported through `pane report-agent` by one of them resolves too.
//
// Every kind keeps a letter, drawn when its SVG cannot be read. Letters are
// unique among the kinds drawn as a letter (droid, maki, muse); they follow
// obsidian-herdr's badges where it has one (`src/views/kindIcons.ts`).
// Where each shipped SVG comes from, and its licence, is in
// assets/kinds/LICENSES.md.

var TABLE = {
  pi: { label: "Pi", letter: "π", shipped: true },
  claude: { label: "Claude", letter: "C", omarchy: { dark: "claude.svg", light: "claude.svg" } },
  codex: { label: "Codex", letter: "X", omarchy: { dark: "codex.svg", light: "codex-light.svg" } },
  gemini: { label: "Gemini", letter: "G", shipped: true },
  cursor: { label: "Cursor", letter: "C", shipped: true },
  // V, T, N, Y, S, R, L, E, I: a later letter of the name where its first is
  // taken by a better-known kind (droid, amp, cursor, opencode, muse, kimi, ...).
  devin: { label: "Devin", letter: "V", shipped: true },
  agy: { label: "Antigravity", letter: "T", shipped: true },
  cline: { label: "Cline", letter: "N", shipped: true },
  omp: { label: "Oh My Pi", letter: "Y", shipped: true },
  mastracode: { label: "Mastra Code", letter: "S", shipped: true },
  opencode: { label: "OpenCode", letter: "O", shipped: true },
  copilot: { label: "GitHub Copilot", letter: "P", shipped: true },
  kimi: { label: "Kimi", letter: "K", shipped: true },
  kiro: { label: "Kiro", letter: "R", shipped: true },
  droid: { label: "Droid", letter: "D" },
  amp: { label: "Amp", letter: "A", shipped: true },
  grok: { label: "Grok", letter: "X", shipped: true },
  hermes: { label: "Hermes", letter: "H", shipped: true },
  kilo: { label: "Kilo Code", letter: "L", shipped: true },
  qodercli: { label: "Qoder", letter: "E", shipped: true },
  qwen: { label: "Qwen Code", letter: "Q", shipped: true },
  maki: { label: "Maki", letter: "I" },
  muse: { label: "Muse", letter: "M" }
}

var KINDS = Object.keys(TABLE)

var ALIASES = {
  "claude-code": "claude",
  "cursor-agent": "cursor",
  "devin-cli": "devin", "devin cli": "devin",
  "antigravity": "agy", "antigravity-cli": "agy", "antigravity_cli": "agy",
  "mastra-code": "mastracode", "mastra code": "mastracode",
  "opencode2": "opencode", "open-code": "opencode",
  "github-copilot": "copilot", "ghcs": "copilot",
  "kimi-code": "kimi", "kimi code": "kimi",
  "kiro-cli": "kiro",
  "amp-local": "amp",
  "grok-build": "grok",
  "hermes-agent": "hermes",
  "kilo-code": "kilo", "kilo code": "kilo",
  "qoderclicn": "qodercli", "qoder": "qodercli", "qodercn": "qodercli",
  "qwen-code": "qwen", "qwen code": "qwen",
  "muse-code": "muse", "muse-cli": "muse"
}

// Where Omarchy keeps its agent marks, under OMARCHY_PATH.
var OMARCHY_ASSETS = "/shell/plugins/agents/assets/"

function own(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key)
}

function text(value) {
  return typeof value === "string" ? value.trim() : ""
}

// The table's id for a kind or one of its aliases, else "".
function canonicalKind(kind) {
  var key = text(kind).toLowerCase()
  if (key === "") return ""
  if (own(TABLE, key)) return key
  return own(ALIASES, key) ? ALIASES[key] : ""
}

function kindLabel(kind, displayKind) {
  var id = canonicalKind(kind)
  if (id !== "") return TABLE[id].label
  var raw = text(kind)
  var display = text(displayKind)
  if (display !== "" && display !== raw) return display
  return raw === "" ? "" : raw.charAt(0).toUpperCase() + raw.slice(1)
}

// A kind's SVG: { file, origin, tinted }. origin "omarchy" is Omarchy's asset in
// its own colours, with a light-theme variant; "gjetr" is assets/kinds/<kind>.svg,
// one colour (currentColor), tinted with the theme and the same in any theme;
// "" is none, and the kind draws its letter.
function kindIcon(kind, lightTheme) {
  var id = canonicalKind(kind)
  if (id !== "" && TABLE[id].omarchy) {
    return { file: lightTheme ? TABLE[id].omarchy.light : TABLE[id].omarchy.dark, origin: "omarchy", tinted: false }
  }
  if (id !== "" && TABLE[id].shipped) return { file: id + ".svg", origin: "gjetr", tinted: true }
  return { file: "", origin: "", tinted: false }
}

// The SVG file for a kind, "" when it has none.
function kindIconFile(kind, lightTheme) {
  return kindIcon(kind, lightTheme).file
}

// Whether a kind's SVG is one colour, to be drawn in the theme's.
function kindIconTinted(kind) {
  return kindIcon(kind, false).tinted
}

// The URL to load a kind's SVG from, "" when it has none or its place is not
// known: Omarchy's read in place under `omarchyPath`, gjetr's under
// `assetsUrl` (the plugin's assets/kinds directory as a URL).
function kindIconUrl(kind, lightTheme, omarchyPath, assetsUrl) {
  var icon = kindIcon(kind, lightTheme)
  if (icon.origin === "omarchy") {
    var root = text(omarchyPath).replace(/\/+$/, "")
    return root === "" ? "" : "file://" + root + OMARCHY_ASSETS + icon.file
  }
  if (icon.origin === "gjetr") {
    var base = text(String(assetsUrl === undefined || assetsUrl === null ? "" : assetsUrl)).replace(/\/+$/, "")
    return base === "" ? "" : base + "/" + icon.file
  }
  return ""
}

function kindLetter(kind, displayKind) {
  var id = canonicalKind(kind)
  if (id !== "") return TABLE[id].letter
  var label = kindLabel(kind, displayKind)
  return label === "" ? "?" : label.charAt(0).toUpperCase()
}

function kindMark(kind, displayKind, lightTheme) {
  var id = canonicalKind(kind)
  var icon = kindIcon(kind, lightTheme)
  return {
    kind: id !== "" ? id : text(kind),
    label: kindLabel(kind, displayKind),
    file: icon.file,
    tinted: icon.tinted,
    letter: kindLetter(kind, displayKind)
  }
}

if (typeof module !== "undefined") {
  module.exports = {
    KINDS: KINDS,
    canonicalKind: canonicalKind,
    kindLabel: kindLabel,
    kindIcon: kindIcon,
    kindIconFile: kindIconFile,
    kindIconTinted: kindIconTinted,
    kindIconUrl: kindIconUrl,
    kindLetter: kindLetter,
    kindMark: kindMark
  }
}
