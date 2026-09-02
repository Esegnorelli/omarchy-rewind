import QtQuick
import Quickshell
import Quickshell.Io

Item {
  id: root

  property var shell: null
  property var manifest: null
  property string omarchyPath: Quickshell.env("OMARCHY_PATH") || ""
  property bool recording: false
  property string lastError: ""
  property var points: []
  property double lastPointTs: 0
  property bool initialized: false

  readonly property string home: Quickshell.env("HOME") || ""
  readonly property string stateHome: Quickshell.env("XDG_STATE_HOME") || (home + "/.local/state")
  readonly property string statusPath: stateHome + "/omarchy/rewind-status.json"
  readonly property string watchPath: Qt.resolvedUrl("scripts/rewind-watch").toString().replace(/^file:\/\//, "")

  function applyStatus(raw) {
    try {
      var s = JSON.parse(raw || "{}")
      root.recording = s.recording !== false
      root.lastError = String(s.error || "")
      root.points = s.points || []
      root.lastPointTs = root.points.length ? Number(root.points[0].ts) || 0 : 0
      root.initialized = true
    } catch (e) {
      root.initialized = true
    }
  }

  FileView {
    path: root.statusPath
    watchChanges: true
    atomicWrites: true
    printErrors: false
    onLoaded: root.applyStatus(text())
    onFileChanged: reload()
    onLoadFailed: {
      root.recording = false
      root.initialized = true
    }
  }

  Process {
    id: watch
    command: ["setpriv", "--pdeathsig", "TERM", "bash", root.watchPath]
    running: true
    onExited: restart.restart()
  }

  Timer {
    id: restart
    interval: 1500
    onTriggered: {
      if (!watch.running)
        watch.running = true
    }
  }
}
