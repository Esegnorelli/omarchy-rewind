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
  property var items: []
  property string filterText: ""
  property int selectedIndex: 0
  property int fileIndex: 0
  property string diffText: ""
  property bool confirmOpen: false
  property string restoreError: ""
  property var swatches: []

  readonly property string home: Quickshell.env("HOME") || ""
  readonly property string stateHome: Quickshell.env("XDG_STATE_HOME") || (home + "/.local/state")
  readonly property string stackPath: stateHome + "/omarchy/undo-stack.json"
  readonly property string undoPath: Qt.resolvedUrl("scripts/undo-now").toString().replace(/^file:\/\//, "")
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
  readonly property int cardWidth: Math.min(Style.space(1100), panel.width - Style.gapsOut * 2)
  readonly property int cardHeight: Math.min(Style.space(680), panel.height - Style.gapsOut * 2)
  readonly property int sidebarWidth: Math.min(Style.space(360), cardWidth * 0.36)
  readonly property int rowHeight: Math.max(Style.space(56), Style.font.body + Style.font.caption + Style.spacing.rowPaddingX * 2)

  readonly property var visibleItems: Model.filterPoints(root.items, root.filterText)
  readonly property var selectedItem: {
    if (selectedIndex < 0 || selectedIndex >= visibleItems.length) return null
    return visibleItems[selectedIndex]
  }
  readonly property bool selectedIsConfig: selectedItem && selectedItem.kind === "config"
  readonly property var selectedFiles: selectedIsConfig && selectedItem.files ? selectedItem.files : []
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
    stackFile.reload()
    Qt.callLater(function () { keyCatcher.forceActiveFocus() })
  }

  function close() {
    root.confirmOpen = false
    root.opened = false
  }

  function applyStack(raw) {
    try {
      var s = JSON.parse(raw || "{}")
      root.items = s.items || []
      if (root.selectedIndex >= root.visibleItems.length)
        root.selectedIndex = Math.max(0, root.visibleItems.length - 1)
      root.refreshDetail()
    } catch (e) {
      root.items = []
    }
  }

  function setFilter(next) {
    root.filterText = next
    root.selectedIndex = 0
    root.fileIndex = 0
    root.refreshDetail()
  }

  function movePoint(delta) {
    if (visibleItems.length === 0) return
    var n = visibleItems.length
    root.selectedIndex = (root.selectedIndex + delta + n) % n
    root.fileIndex = 0
    root.refreshDetail()
  }

  function realIndex() {
    if (!selectedItem) return -1
    var i
    for (i = 0; i < root.items.length; i++) {
      if (root.items[i] === selectedItem) return i
      if (root.items[i].ts === selectedItem.ts && root.items[i].label === selectedItem.label)
        return i
    }
    return root.selectedIndex
  }

  function refreshDetail() {
    root.swatches = []
    root.diffText = ""
    if (!selectedIsConfig || !selectedFile || !selectedItem.commitId) return
    if (!diffProc.running) {
      diffProc.command = [root.recordPath, "diff", selectedItem.commitId, selectedFile]
      diffProc.running = true
    }
  }

  function runRestore() {
    var idx = realIndex()
    if (idx < 0 || undoProc.running) return
    undoProc.command = [root.undoPath, String(idx)]
    undoProc.running = true
  }

  FileView {
    id: stackFile
    path: root.stackPath
    watchChanges: true
    atomicWrites: true
    printErrors: false
    onLoaded: root.applyStack(text())
    onFileChanged: reload()
    onLoadFailed: root.items = []
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
    id: undoProc
    command: []
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        root.confirmOpen = false
        try {
          var r = JSON.parse(text || "{}")
          if (r.ok === false && !r.empty) root.restoreError = r.error || "Undo failed"
          else root.restoreError = ""
        } catch (e) {
          root.restoreError = ""
        }
        stackFile.reload()
      }
    }
  }

  PanelWindow {
    id: panel
    visible: root.opened
    anchors { top: true; bottom: true; left: true; right: true }
    color: "transparent"
    WlrLayershell.namespace: "omarchy-undo"
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.Exclusive
    exclusionMode: ExclusionMode.Ignore

    Rectangle { anchors.fill: parent; color: root.scrim }
    MouseArea { anchors.fill: parent; onClicked: root.close() }

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
          } else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
            if (root.selectedItem) root.confirmOpen = true
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
          message: root.selectedItem ? ("Restore " + root.selectedItem.label + "?") : ""
          confirmText: "Undo"
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
            text: root.filterText ? root.filterText : "Undo"
            color: root.foreground
            font.family: root.fontFamily
            font.pixelSize: Style.font.heading
          }
          Text {
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            text: root.restoreError || "j/k  Enter  Esc"
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
              model: root.visibleItems
              spacing: Style.space(4)
              boundsBehavior: Flickable.StopAtBounds
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
                      text: modelData.kind === "config" ? "config" : "window"
                      color: index === root.selectedIndex ? root.selectedText : root.accent
                      font.family: root.fontFamily
                      font.pixelSize: Style.font.caption
                    }
                    Text {
                      text: Model.formatHhmm(modelData.ts)
                      color: index === root.selectedIndex ? root.selectedText : root.dim
                      font.family: root.fontFamily
                      font.pixelSize: Style.font.caption
                    }
                  }
                  Text {
                    width: parent.width
                    text: modelData.label
                    color: index === root.selectedIndex ? root.selectedText : root.foreground
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.body
                    elide: Text.ElideRight
                  }
                }
              }
              Text {
                visible: timeline.count === 0
                anchors.centerIn: parent
                text: "Nothing to undo."
                color: root.dim
                font.family: root.fontFamily
                font.pixelSize: Style.font.body
              }
            }

            Rectangle { width: 1; height: parent.height; color: root.border; opacity: 0.4 }

            Column {
              width: parent.width - root.sidebarWidth - Style.spacing.md - 1
              height: parent.height
              spacing: Style.spacing.sm

              Text {
                width: parent.width
                visible: !!root.selectedItem && !root.selectedIsConfig
                text: root.selectedItem
                  ? (root.selectedItem.class + (root.selectedItem.cwd ? ("\n" + root.selectedItem.cwd) : ""))
                  : ""
                color: root.dim
                font.family: root.fontFamily
                font.pixelSize: Style.font.caption
                wrapMode: Text.Wrap
              }

              Flow {
                width: parent.width
                visible: root.selectedIsConfig
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
                visible: root.selectedIsConfig
                height: parent.height - Style.space(120)
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
                    text: root.diffText || ""
                    color: root.foreground
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.caption
                    wrapMode: Text.NoWrap
                  }
                }
              }

              Item { width: 1; height: 1; visible: !root.selectedIsConfig }

              Rectangle {
                width: parent.width
                height: Style.space(40)
                radius: root.cornerRadius
                color: root.selectedItem ? root.accent : "transparent"
                opacity: root.selectedItem ? 1 : 0.3
                Text {
                  anchors.centerIn: parent
                  text: "Restore this"
                  color: root.selectedItem ? root.background : root.dim
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.body
                }
                MouseArea {
                  anchors.fill: parent
                  enabled: !!root.selectedItem
                  onClicked: root.confirmOpen = true
                }
              }
            }
          }
        }
      }
    }
  }
}
