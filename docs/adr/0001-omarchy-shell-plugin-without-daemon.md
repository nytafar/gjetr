# gjetr ships as an omarchy-shell plugin, with no core daemon for now

gjetr runs as a plugin inside omarchy-shell, talking to the herdr socket and reading the cache-ttl state file directly from QML. We considered a standalone Quickshell process and a core daemon (Bun/TypeScript) with thin renderers, which would isolate protocol churn and let the Obsidian plugin or a Stream Deck share one data source. We chose the shell plugin for community adoption: it installs through the Omarchy marketplace, gets the theme and UI kit for free, and matches how the ecosystem already distributes surfaces. The cost is that it shares a process with the bar, and protocol handling lives in QML.

## Consequences

- herdr access, event collapsing and sorting sit behind one seam, in pure `.js` Model and Policy files with no Qt imports, so a daemon can replace the data side later without touching Modules.
- The daemon is suspended, not rejected. Revisit if a second consumer (Obsidian, Stream Deck, remote servers) appears.
