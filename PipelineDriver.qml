import QtQuick

// Drives one pipeline (ADR 0003): a pure machine in lib/ whose
// step(state, event, now) returns { state, commands: [{ id, argv }] }. This
// feeds it the Agents and a tick every intervalMs while active, runs every
// command it returns through the CommandRunner and feeds each reply back as
// { type: "reply", id, text, code }. Callers push other events with feed().
// It holds the machine's state and decides nothing.
QtObject {
  id: root

  // { initial(), step(state, event, now) }
  property var machine: null
  // The service's CommandRunner.
  property var commands: null
  property var agents: []
  // Whether Agents and ticks reach the machine.
  property bool active: false
  property int intervalMs: 5000

  // The machine's state, as its step last returned it.
  readonly property var state: current !== null ? current : initialState
  readonly property var initialState: machine ? machine.initial() : null
  property var current: null

  function feed(event) {
    if (!machine) return
    var from = current !== null ? current : initialState
    var out = machine.step(from, event, Date.now())
    if (out.state !== from) current = out.state
    for (var i = 0; i < out.commands.length; i++) run(out.commands[i])
  }

  function run(command) {
    var id = command.id
    if (!commands) {
      feed({ type: "reply", id: id, text: "", code: -1 })
      return
    }
    commands.run(command.argv, function(text, code) {
      root.feed({ type: "reply", id: id, text: text, code: code })
    })
  }

  onAgentsChanged: if (active) feed({ type: "agents", agents: agents })
  onActiveChanged: if (active) feed({ type: "agents", agents: agents })

  property Timer ticker: Timer {
    interval: root.intervalMs
    repeat: true
    triggeredOnStart: true
    running: root.active && !!root.machine
    onTriggered: root.feed({ type: "tick" })
  }
}
