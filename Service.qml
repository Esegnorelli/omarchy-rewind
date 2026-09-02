import QtQuick
import Quickshell
import Quickshell.Io

Item {
  id: root

  property var shell: null
  property var manifest: null
  property string omarchyPath: Quickshell.env("OMARCHY_PATH") || ""
  property bool recording: false
  property bool bindTaken: false
  property var items: []
  property bool initialized: false

  readonly property string home: Quickshell.env("HOME") || ""
  readonly property string stateHome: Quickshell.env("XDG_STATE_HOME") || (home + "/.local/state")
  readonly property string stackPath: stateHome + "/omarchy/undo-stack.json"
  readonly property string hyprPath: Qt.resolvedUrl("scripts/undo-hypr").toString().replace(/^file:\/\//, "")
  readonly property string watchPath: Qt.resolvedUrl("scripts/rewind-watch").toString().replace(/^file:\/\//, "")
  readonly property string undoPath: Qt.resolvedUrl("scripts/undo-now").toString().replace(/^file:\/\//, "")
  readonly property string bindsPath: Qt.resolvedUrl("scripts/install-binds").toString().replace(/^file:\/\//, "")
  readonly property string topLabel: items.length ? String(items[0].label || "") : ""
  readonly property string topKind: items.length ? String(items[0].kind || "") : ""

  function applyStack(raw) {
    try {
      var s = JSON.parse(raw || "{}")
      root.items = s.items || []
      root.recording = true
      root.initialized = true
    } catch (e) {
      root.items = []
      root.initialized = true
    }
  }

  function undoTop() {
    if (undoProc.running) return
    undoProc.command = [root.undoPath]
    undoProc.running = true
  }

  function undoIndex(index) {
    if (undoProc.running) return
    undoProc.command = [root.undoPath, String(index)]
    undoProc.running = true
  }

  FileView {
    path: root.stackPath
    watchChanges: true
    atomicWrites: true
    printErrors: false
    onLoaded: root.applyStack(text())
    onFileChanged: reload()
    onLoadFailed: {
      root.items = []
      root.initialized = true
    }
  }

  Process {
    id: hyprWatch
    command: ["setpriv", "--pdeathsig", "TERM", "bash", root.hyprPath]
    running: true
    onExited: hyprRestart.restart()
  }

  Process {
    id: configWatch
    command: ["setpriv", "--pdeathsig", "TERM", "bash", root.watchPath]
    running: true
    onExited: configRestart.restart()
  }

  Timer {
    id: hyprRestart
    interval: 1500
    onTriggered: { if (!hyprWatch.running) hyprWatch.running = true }
  }

  Timer {
    id: configRestart
    interval: 1500
    onTriggered: { if (!configWatch.running) configWatch.running = true }
  }

  Process {
    id: undoProc
    command: []
  }

  Process {
    id: bindsProc
    command: ["bash", root.bindsPath]
    running: true
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        var out = String(text || "").trim()
        root.bindTaken = out === "taken"
      }
    }
  }

  IpcHandler {
    target: "esegnorelli.undo"

    function undo(): string {
      root.undoTop()
      return "ok"
    }
  }
}
