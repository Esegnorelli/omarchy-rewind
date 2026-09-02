import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import qs.Commons
import qs.Ui
import "Model.js" as Model

Item {
  id: root

  property string omarchyPath: Quickshell.env("OMARCHY_PATH") || ""
  property var shell: null
  property var manifest: null
  property bool opened: false
  property var points: []
  property bool recording: true
  property string headerNote: ""
  property string filterText: ""
  property int selectedIndex: 0
  property int fileIndex: 0
  property string diffText: ""
  property bool confirmOpen: false
  property bool restoring: false
  property string restoreError: ""
  property var swatches: []

  readonly property string home: Quickshell.env("HOME") || ""
  readonly property string stateHome: Quickshell.env("XDG_STATE_HOME") || (home + "/.local/state")
  readonly property string statusPath: stateHome + "/omarchy/rewind-status.json"
  readonly property string recordPath: Qt.resolvedUrl("scripts/rewind-record").toString().replace(/^file:\/\//, "")

  property color background: Color.menu.background
  property color foreground: Color.menu.text
  property color border: Color.menu.border
  property var borderSpec: Border.surfaceSpec("menu", "border", border, Math.max(1, Style.space(2)))
  property color scrim: Color.menu.scrim
  property color selectedBackground: Color.menu.selectedBackground
  property color selectedText: Color.menu.selectedText
  property color accent: Color.accent
  property color dim: Qt.rgba(foreground.r, foreground.g, foreground.b, 0.56)
  readonly property int cornerRadius: Style.cornerRadius
  property string fontFamily: Style.font.menuFamily
  property int contentMargin: Style.spacing.panelPadding
  readonly property int cardWidth: Math.min(Style.space(1180), panel.width - Style.gapsOut * 2)
  readonly property int cardHeight: Math.min(Style.space(720), panel.height - Style.gapsOut * 2)
  readonly property int sidebarWidth: Math.min(Style.space(360), cardWidth * 0.34)
  readonly property int rowHeight: Math.max(Style.space(56), Style.font.body + Style.font.caption + Style.spacing.rowPaddingX * 2)

  readonly property var visiblePoints: Model.filterPoints(root.points, root.filterText)
  readonly property var selectedPoint: {
    if (selectedIndex < 0 || selectedIndex >= visiblePoints.length) return null
    return visiblePoints[selectedIndex]
  }
  readonly property var selectedFiles: selectedPoint && selectedPoint.files ? selectedPoint.files : []
  readonly property string selectedFile: {
    if (fileIndex < 0 || fileIndex >= selectedFiles.length) return ""
    return selectedFiles[fileIndex]
  }

  function open(payloadJson) {
    root.opened = true
    root.filterText = ""
    root.selectedIndex = 0
    root.fileIndex = 0
    root.confirmOpen = false
    root.restoreError = ""
    root.diffText = ""
    statusFile.reload()
    Qt.callLater(function () { keyCatcher.forceActiveFocus() })
  }

  function close() {
    root.confirmOpen = false
    root.opened = false
  }

  function applyStatus(raw) {
    try {
      var s = JSON.parse(raw || "{}")
      root.points = s.points || []
      root.recording = s.recording !== false
      root.headerNote = root.recording ? "" : "Not recording"
      if (root.selectedIndex >= root.visiblePoints.length)
        root.selectedIndex = Math.max(0, root.visiblePoints.length - 1)
      root.refreshDetail()
    } catch (e) {}
  }

  function setFilter(next) {
    root.filterText = next
    root.selectedIndex = 0
    root.fileIndex = 0
    root.refreshDetail()
  }

  function movePoint(delta) {
    if (visiblePoints.length === 0) return
    var n = visiblePoints.length
    root.selectedIndex = (root.selectedIndex + delta + n) % n
    root.fileIndex = 0
    root.refreshDetail()
  }

  function moveFile(delta) {
    if (selectedFiles.length === 0) return
    var n = selectedFiles.length
    root.fileIndex = (root.fileIndex + delta + n) % n
    root.refreshDetail()
  }

  function refreshDetail() {
    root.swatches = []
    root.diffText = ""
    if (!selectedPoint || !selectedFile) return
    if (String(selectedFile).indexOf("colors.toml") >= 0)
      root.swatches = []
    if (!diffProc.running) {
      diffProc.command = [root.recordPath, "diff", selectedPoint.id, selectedFile]
      diffProc.running = true
    }
  }

  function requestRestore() {
    if (!selectedPoint || root.restoring) return
    root.confirmOpen = true
  }

  function runRestore() {
    if (!selectedPoint || restoreProc.running) return
    root.restoring = true
    root.restoreError = ""
    restoreProc.command = [root.recordPath, "restore", selectedPoint.id]
    restoreProc.running = true
  }

  FileView {
    id: statusFile
    path: root.statusPath
    watchChanges: true
    atomicWrites: true
    printErrors: false
    onLoaded: root.applyStatus(text())
    onFileChanged: reload()
    onLoadFailed: root.points = []
  }

  Process {
    id: diffProc
    command: []
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        root.diffText = text
        if (root.selectedFile && String(root.selectedFile).indexOf("colors.toml") >= 0)
          root.swatches = Model.parseColorSwatches(text)
      }
    }
  }

  Process {
    id: restoreProc
    command: []
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        root.restoring = false
        root.confirmOpen = false
        try {
          var r = JSON.parse(text || "{}")
          if (r.ok === false) root.restoreError = r.error || "Restore failed"
          else root.restoreError = ""
        } catch (e) {
          root.restoreError = text || "Restore failed"
        }
        statusFile.reload()
      }
    }
    onExited: function (code) {
      root.restoring = false
      if (code !== 0 && !root.restoreError)
        root.restoreError = "Restore failed"
    }
  }

  PanelWindow {
    id: panel
    visible: root.opened
    anchors { top: true; bottom: true; left: true; right: true }
    color: "transparent"
    WlrLayershell.namespace: "omarchy-rewind"
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.Exclusive
    exclusionMode: ExclusionMode.Ignore

    Rectangle {
      anchors.fill: parent
      color: root.scrim
    }

    MouseArea {
      anchors.fill: parent
      onClicked: root.close()
    }

    BorderSurface {
      id: card
      width: root.cardWidth
      height: root.cardHeight
      radius: root.cornerRadius
      anchors.centerIn: parent
      color: root.background
      borderSpec: root.borderSpec
      padding: root.contentMargin

      MouseArea { anchors.fill: parent; onClicked: {} }

      Item {
        id: keyCatcher
        anchors.fill: parent
        z: root.confirmOpen ? 20 : 0
        focus: true

        Keys.priority: Keys.BeforeItem
        Keys.onPressed: function (event) {
          if (root.confirmOpen) {
            if (confirmBox.handleKey(event)) event.accepted = true
            return
          }
          if (event.key === Qt.Key_Escape) {
            if (root.filterText) root.setFilter("")
            else root.close()
            event.accepted = true
          } else if (event.key === Qt.Key_J || event.key === Qt.Key_Down) {
            root.movePoint(1)
            event.accepted = true
          } else if (event.key === Qt.Key_K || event.key === Qt.Key_Up) {
            root.movePoint(-1)
            event.accepted = true
          } else if (event.key === Qt.Key_Right) {
            root.moveFile(1)
            event.accepted = true
          } else if (event.key === Qt.Key_Left) {
            root.moveFile(-1)
            event.accepted = true
          } else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
            root.requestRestore()
            event.accepted = true
          } else if (event.key === Qt.Key_Slash) {
            root.setFilter("")
            event.accepted = true
          } else if (Util.editsFilter(event, root.filterText)) {
            root.setFilter(Util.editedFilter(event, root.filterText))
            event.accepted = true
          } else if (event.text && event.text.length === 1 && event.text.charCodeAt(0) >= 32 && event.text.charCodeAt(0) !== 127) {
            root.setFilter(root.filterText + event.text)
            event.accepted = true
          }
        }

        ConfirmDialog {
          id: confirmBox
          anchors.fill: parent
          opened: root.confirmOpen
          z: 10
          message: root.selectedPoint
            ? Model.confirmCopy({
                count: (root.selectedPoint.files || []).length,
                hhmm: Model.formatHhmm(root.selectedPoint.ts),
                label: root.selectedPoint.label
              })
            : ""
          confirmText: "Restore"
          background: root.background
          foreground: root.foreground
          scrim: root.scrim
          selectedBackground: root.selectedBackground
          selectedText: root.selectedText
          fontFamily: root.fontFamily
          cornerRadius: root.cornerRadius
          onCanceled: root.confirmOpen = false
          onConfirmed: root.runRestore()
        }
      }

      Column {
        anchors.fill: parent
        anchors.topMargin: card.contentTopInset
        anchors.rightMargin: card.contentRightInset
        anchors.bottomMargin: card.contentBottomInset
        anchors.leftMargin: card.contentLeftInset
        spacing: Style.spacing.md

        Rectangle {
          width: parent.width
          height: Math.max(Style.space(40), Style.font.heading + 8)
          color: "transparent"

          Text {
            anchors.left: parent.left
            anchors.verticalCenter: parent.verticalCenter
            text: root.filterText ? root.filterText : (root.headerNote || "Rewind")
            color: root.foreground
            opacity: root.filterText || root.headerNote ? 1 : 0.9
            font.family: root.fontFamily
            font.pixelSize: Style.font.heading
          }

          Text {
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            text: root.restoreError || (root.restoring ? "Restoring…" : "j/k  Enter  Esc")
            color: root.restoreError ? Color.urgent : root.dim
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
          }
        }

        Item {
          width: parent.width
          height: parent.height - Math.max(Style.space(40), Style.font.heading + 8) - Style.spacing.md

          Row {
            anchors.fill: parent
            spacing: Style.spacing.md

            ListView {
              id: timeline
              width: root.sidebarWidth
              height: parent.height
              clip: true
              model: root.visiblePoints
              spacing: Style.space(4)
              boundsBehavior: Flickable.StopAtBounds
              currentIndex: root.selectedIndex

              delegate: Rectangle {
                required property int index
                required property var modelData
                width: ListView.view.width
                height: root.rowHeight
                radius: root.cornerRadius
                color: index === root.selectedIndex ? root.selectedBackground : "transparent"

                MouseArea {
                  anchors.fill: parent
                  onClicked: {
                    root.selectedIndex = index
                    root.fileIndex = 0
                    root.refreshDetail()
                  }
                }

                Column {
                  anchors.fill: parent
                  anchors.margins: Style.space(10)
                  spacing: 2

                  Row {
                    spacing: Style.space(8)
                    Text {
                      text: Model.formatHhmm(modelData.ts)
                      color: index === root.selectedIndex ? root.selectedText : root.foreground
                      font.family: root.fontFamily
                      font.pixelSize: Style.font.body
                    }
                    Text {
                      text: modelData.label
                      color: index === root.selectedIndex ? root.selectedText : root.accent
                      font.family: root.fontFamily
                      font.pixelSize: Style.font.caption
                    }
                  }
                  Text {
                    width: parent.width
                    text: modelData.summary
                    color: index === root.selectedIndex ? root.selectedText : root.dim
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.caption
                    elide: Text.ElideRight
                  }
                }
              }

              Text {
                visible: timeline.count === 0
                anchors.centerIn: parent
                text: "Nothing recorded yet."
                color: root.dim
                font.family: root.fontFamily
                font.pixelSize: Style.font.body
              }
            }

            Rectangle {
              width: 1
              height: parent.height
              color: root.border
              opacity: 0.4
            }

            Column {
              width: parent.width - root.sidebarWidth - Style.spacing.md - 1
              height: parent.height
              spacing: Style.spacing.sm

              Flow {
                width: parent.width
                spacing: Style.space(6)
                Repeater {
                  model: root.selectedFiles
                  Rectangle {
                    required property int index
                    required property var modelData
                    height: Style.space(28)
                    width: fileLabel.implicitWidth + Style.space(16)
                    radius: root.cornerRadius
                    color: index === root.fileIndex ? root.selectedBackground : "transparent"
                    border.width: 1
                    border.color: root.border
                    Text {
                      id: fileLabel
                      anchors.centerIn: parent
                      text: String(modelData).split("/").pop()
                      color: index === root.fileIndex ? root.selectedText : root.foreground
                      font.family: root.fontFamily
                      font.pixelSize: Style.font.caption
                    }
                    MouseArea {
                      anchors.fill: parent
                      onClicked: {
                        root.fileIndex = index
                        root.refreshDetail()
                      }
                    }
                  }
                }
              }

              Row {
                visible: root.swatches.length > 0
                spacing: Style.space(6)
                Repeater {
                  model: root.swatches
                  Rectangle {
                    required property var modelData
                    width: Style.space(22)
                    height: Style.space(22)
                    radius: 4
                    color: modelData
                    border.width: 1
                    border.color: root.border
                  }
                }
              }

              Rectangle {
                width: parent.width
                height: parent.height - (root.selectedFiles.length ? Style.space(36) : 0) - (root.swatches.length ? Style.space(28) : 0) - Style.space(44) - Style.spacing.sm * 3
                radius: root.cornerRadius
                color: Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.04)
                clip: true

                Flickable {
                  anchors.fill: parent
                  anchors.margins: Style.space(12)
                  contentWidth: diffLabel.implicitWidth
                  contentHeight: diffLabel.implicitHeight
                  clip: true
                  Text {
                    id: diffLabel
                    text: root.diffText || (root.selectedPoint ? "No diff." : "")
                    color: root.foreground
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.caption
                    wrapMode: Text.NoWrap
                  }
                }
              }

              Rectangle {
                width: parent.width
                height: Style.space(40)
                radius: root.cornerRadius
                color: root.selectedPoint ? root.accent : "transparent"
                opacity: root.selectedPoint ? 1 : 0.3
                Text {
                  anchors.centerIn: parent
                  text: "Restore this"
                  color: root.selectedPoint ? root.background : root.dim
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.body
                }
                MouseArea {
                  anchors.fill: parent
                  enabled: !!root.selectedPoint && !root.restoring
                  onClicked: root.requestRestore()
                }
              }
            }
          }
        }
      }
    }
  }
}
