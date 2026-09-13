# Kind logos: sources and licences

The SVGs in this directory are the agent kinds' logos, drawn by gjetr's kind
mark. Each is normalised for gjetr: one `fill="currentColor"` on the root, a
square `viewBox`, no gradients, raster images, scripts, styles or external
references (checked by `tests/KindAssets.test.js`). Logos are trademarks of
their owners and are used only to name the agent a Card or row shows; no
endorsement is implied.

| File | Kind | Source | Licence | Changes |
|---|---|---|---|---|
| `pi.svg` | Pi | Simple Icons, `icons/pi.svg` (brand source pi.dev) | CC0 1.0 | Normalised |
| `gemini.svg` | Gemini | Simple Icons, `icons/googlegemini.svg` | CC0 1.0 | Normalised |
| `cursor.svg` | Cursor | Simple Icons, `icons/cursor.svg` | CC0 1.0 | Normalised |
| `cline.svg` | Cline | Simple Icons, `icons/cline.svg` | CC0 1.0 | Normalised |
| `opencode.svg` | OpenCode | Simple Icons, `icons/opencode.svg` | CC0 1.0 | Normalised |
| `copilot.svg` | GitHub Copilot | Simple Icons, `icons/githubcopilot.svg` (after GitHub Primer's `copilot-24`, MIT) | CC0 1.0 | Normalised |
| `kimi.svg` | Kimi | Simple Icons, `icons/kimi.svg` | CC0 1.0 | Normalised |
| `qwen.svg` | Qwen Code | Simple Icons, `icons/qwen.svg` | CC0 1.0 | Normalised |
| `devin.svg` | Devin | Lobe Icons, `src/Devin` | MIT, LobeHub | Normalised |
| `agy.svg` | Antigravity | Lobe Icons, `src/Antigravity` | MIT, LobeHub | Normalised |
| `mastracode.svg` | Mastra Code | Lobe Icons, `src/Mastra` (the Mastra mark) | MIT, LobeHub | Normalised |
| `kiro.svg` | Kiro | Lobe Icons, `src/Kiro` | MIT, LobeHub | Normalised |
| `amp.svg` | Amp | Lobe Icons, `src/Amp` | MIT, LobeHub | Normalised |
| `grok.svg` | Grok | Lobe Icons, `src/Grok` | MIT, LobeHub | Normalised |
| `hermes.svg` | Hermes | Lobe Icons, `src/HermesAgent` (Nous Research's portrait mark) | MIT, LobeHub | Normalised |
| `kilo.svg` | Kilo Code | Lobe Icons, `src/KiloCode` | MIT, LobeHub | Normalised |
| `qodercli.svg` | Qoder | Lobe Icons, `src/Qoder` | MIT, LobeHub | Normalised |
| `omp.svg` | Oh My Pi | oh-my-pi, `assets/icon.svg` | MIT, oh-my-pi authors | Three colours made one, 120x90 padded to a 120x120 `viewBox` |

Not shipped here: Claude's and Codex's marks are read in place from Omarchy
(`$OMARCHY_PATH/shell/plugins/agents/assets/`) in their brand colours. Droid,
Maki and Muse have no clearly licensed logo and draw a letter.

## Simple Icons (CC0 1.0)

https://github.com/simple-icons/simple-icons

Simple Icons dedicates its SVGs to the public domain under CC0 1.0 Universal
(https://creativecommons.org/publicdomain/zero/1.0/). No attribution is
required; it is given here as a courtesy.

## Lobe Icons (MIT)

https://github.com/lobehub/lobe-icons

```text
MIT License

Copyright (c) 2023 LobeHub

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## oh-my-pi (MIT)

https://github.com/can1357/oh-my-pi

```text
MIT License

Copyright (c) 2025 Mario Zechner
Copyright (c) 2025-2026 Can Bölük
Copyright (c) 2026 Stencil Labs, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Omarchy (MIT)

https://github.com/omacom/omarchy

gjetr ships no Omarchy file here; it reads Claude's and Codex's marks from the
installed Omarchy. Omarchy's licence:

```text
Copyright (c) David Heinemeier Hansson

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```
