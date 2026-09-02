import QtQuick
import qs.Commons
import qs.Ui

BarWidget {
  id: root
  moduleName: "esegnorelli.undo"

  readonly property var undoService: bar && bar.shell ? bar.shell.serviceFor(moduleName) : null
  readonly property string topLabel: undoService ? String(undoService.topLabel || "") : ""
  readonly property bool recording: undoService ? undoService.recording === true : false
  readonly property bool bindTaken: undoService ? undoService.bindTaken === true : false
  readonly property string shortLabel: {
    var s = topLabel
    if (s.length > 18) s = s.slice(0, 17) + "…"
    return s
  }

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: shortLabel !== "" ? ("\uf0e2 " + shortLabel) : "\uf0e2"
    active: shortLabel !== ""
    opacity: root.recording ? 1 : 0.45
    tooltipText: root.bindTaken
      ? "SUPER+Z is taken"
      : (shortLabel !== "" ? ("Undo " + topLabel) : "Nothing to undo")
    onPressed: function (mouseButton) {
      if (!root.bar) return
      if (mouseButton === Qt.MiddleButton) return
      if (mouseButton === Qt.RightButton) {
        root.bar.run("omarchy-shell shell toggle esegnorelli.undo")
        return
      }
      root.bar.run("omarchy-shell esegnorelli.undo undo")
    }
  }
}
