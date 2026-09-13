# gjetr

A herdr dashboard that takes over the role of herdr's sidebar from outside herdr,
shown on a secondary touchscreen or in a tile.

## Language

**Display**:
A place the dashboard is shown: a physical output or a tile.
_Avoid_: screen, monitor

**Module**:
One self-contained view with its own settings, such as the Agent List, Workspace List or Usage.
_Avoid_: widget, panel

**Layout**:
An arrangement of Modules on a Display, declaring the orientation it is built for. Selecting it rotates the Display to that orientation when the Display allows it; physically turning the panel is up to the user.
_Avoid_: screen, mode, setup

**Deck**:
The ordered set of Layouts a Display tabs through.
_Avoid_: modes

**Agent**:
A herdr pane in which herdr has detected an agent.
_Avoid_: session, terminal

**Card**:
The representation of one Agent in the Agent List.
_Avoid_: entry, row

**Field**:
One piece of data shown on a Card, such as status, kind, name, location or cache timer. Which Fields appear is chosen by a named preset.

**Agent name**:
The label a Card shows for an Agent, taken from the most specific source available and falling back to broader ones.

**Cache timer**:
The time left before an Agent's prompt cache expires, with an ok, warn or critical level. Only meaningful for agent kinds that have a prompt cache.
_Avoid_: TTL (when talking about the displayed value)

**Sort mode**:
The ordering of the Agent List: `spaces` (grouped by workspace), `priority` (attention first) or `cache` (most urgent Cache timer first).

**Attention**:
The state of an Agent that has become `blocked` or `done` and has not been focused since. Shown prominently (pulsing) on its Card, and as a badge on the tab of any Layout that contains it. gjetr never sends notifications; herdr owns those.

**Offline**:
The state when herdr cannot be reached. Last known Cards stay visible, greyed out, rather than showing an empty list.

**Agent List**:
The Module listing every Agent across workspaces as Cards, in a Sort mode.

**Workspace List**:
The Module for navigating herdr's hierarchy of workspace, tab and pane, including panes that hold no Agent.

**Focus**:
Making an Agent the active pane in herdr, and optionally bringing its hosting terminal window forward.

**Config**:
The user-authored files that define Decks, Layouts and Module settings. Never written by gjetr.

**Override**:
A choice made on the Display at runtime, such as Sort mode or Focus behaviour, that takes precedence over Config until reset.

**Client mode**:
Using the Display itself to work in a herdr pane, when the main desk is unavailable. Deferred.

## Relationships

- A **Display** has one **Deck**; a **Deck** holds one or more **Layouts**
- A **Layout** places one or more **Modules**
- A **Module** reads from exactly one herdr server; multiple servers mean duplicate Modules
- An **Agent List** shows one **Card** per **Agent**; each **Card** shows the **Fields** its Config selects
- An **Override** shadows a **Config** value; it never edits it
- Panes without an **Agent** are reachable only through the **Workspace List**
