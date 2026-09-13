.pragma library

// Agent kinds: what herdr reports in `pane.agent` and `agents[].agent`, and how
// a Card or row shows one: a written label, Omarchy's SVG mark where
// shell/plugins/agents/assets ships one, else a letter drawn in theme colours.
// A kind is never blank: an unknown one is shown by its own name and first
// letter.
//
// The kinds are herdr's `Agent::as_str` (src/detect/mod.rs), the list `herdr
// agent start --help` offers for `--kind`: 22 in herdr 0.8.2, and muse added in
// 0.9.0. Aliases are the other names herdr's own lookup accepts for a kind
// (`lookup_agent`), plus the integration target `antigravity_cli`, so a kind
// reported through `pane report-agent` by one of them resolves too.
//
// Letters are unique among the kinds drawn as a letter; they follow
// obsidian-herdr's badges where it has one (`src/views/kindIcons.ts`). claude
// and codex draw Omarchy's marks and fall back to C and X only if those files
// cannot be read.

var TABLE = {
  pi: { label: "Pi", letter: "π" },
  claude: { label: "Claude", letter: "C", mark: { dark: "claude.svg", light: "claude.svg" } },
  codex: { label: "Codex", letter: "X", mark: { dark: "codex.svg", light: "codex-light.svg" } },
  gemini: { label: "Gemini", letter: "G" },
  cursor: { label: "Cursor", letter: "C" },
  // V, T, N, Y, S, R, L, E, I: a later letter of the name where its first is
  // taken by a better-known kind (droid, amp, cursor, opencode, muse, kimi, ...).
  devin: { label: "Devin", letter: "V" },
  agy: { label: "Antigravity", letter: "T" },
  cline: { label: "Cline", letter: "N" },
  omp: { label: "Oh My Pi", letter: "Y" },
  mastracode: { label: "Mastra Code", letter: "S" },
  opencode: { label: "OpenCode", letter: "O" },
  copilot: { label: "GitHub Copilot", letter: "P" },
  kimi: { label: "Kimi", letter: "K" },
  kiro: { label: "Kiro", letter: "R" },
  droid: { label: "Droid", letter: "D" },
  amp: { label: "Amp", letter: "A" },
  grok: { label: "Grok", letter: "X" },
  hermes: { label: "Hermes", letter: "H" },
  kilo: { label: "Kilo Code", letter: "L" },
  qodercli: { label: "Qoder", letter: "E" },
  qwen: { label: "Qwen Code", letter: "Q" },
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

// Omarchy's asset file for a kind, "" when it has none.
function kindIconFile(kind, lightTheme) {
  var id = canonicalKind(kind)
  if (id === "" || !TABLE[id].mark) return ""
  return lightTheme ? TABLE[id].mark.light : TABLE[id].mark.dark
}

function kindLetter(kind, displayKind) {
  var id = canonicalKind(kind)
  if (id !== "") return TABLE[id].letter
  var label = kindLabel(kind, displayKind)
  return label === "" ? "?" : label.charAt(0).toUpperCase()
}

function kindMark(kind, displayKind, lightTheme) {
  var id = canonicalKind(kind)
  return {
    kind: id !== "" ? id : text(kind),
    label: kindLabel(kind, displayKind),
    file: kindIconFile(kind, lightTheme),
    letter: kindLetter(kind, displayKind)
  }
}

if (typeof module !== "undefined") {
  module.exports = {
    KINDS: KINDS,
    canonicalKind: canonicalKind,
    kindLabel: kindLabel,
    kindIconFile: kindIconFile,
    kindLetter: kindLetter,
    kindMark: kindMark
  }
}
