import QtQuick
import Quickshell.Io
import "lib/CommandPolicy.js" as CommandPolicy

// Starts the processes gjetr needs, and nothing else. Every argv must pass
// lib/CommandPolicy.js; a refused one is logged and never started. Commands
// run without a shell, one Process object per call, and report
// (stdout, exitCode) once both the output and the exit have arrived.
QtObject {
  id: root

  property int started: 0
  property int refused: 0
  property string lastError: ""

  function log(message) {
    console.info("[gjetr] command " + message)
  }

  function run(argv, done) {
    if (!CommandPolicy.allowed(argv)) {
      refused++
      lastError = "refused " + JSON.stringify(argv)
      log(lastError)
      if (done) done("", -1)
      return false
    }
    var proc = processComponent.createObject(root, { command: argv, done: done || null })
    if (!proc) {
      lastError = "could not create a process"
      if (done) done("", -1)
      return false
    }
    started++
    proc.running = true
    return true
  }

  property Component processComponent: Component {
    Process {
      id: proc

      property var done: null
      property bool outputDone: false
      property bool exitDone: false
      property string output: ""
      property int code: -1

      function finish() {
        if (!outputDone || !exitDone) return
        var callback = done
        done = null
        if (code !== 0) root.lastError = command[0] + " exited " + code
        if (callback) callback(output, code)
        Qt.callLater(function() { proc.destroy() })
      }

      stdout: StdioCollector {
        waitForEnd: true
        onStreamFinished: {
          proc.output = text
          proc.outputDone = true
          proc.finish()
        }
      }

      onExited: function(exitCode, exitStatus) {
        proc.code = exitCode
        proc.exitDone = true
        proc.finish()
      }
    }
  }
}
