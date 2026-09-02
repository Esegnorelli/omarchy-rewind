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
  readonly property int stackCount: undoService && undoService.items ? undoService.items.length : 0

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: "\uf0e2"
    slotSize: Style.bar.statusSlot
    fontSize: Style.font.caption
    active: stackCount > 0
    opacity: root.recording ? 1 : 0.45
    tooltipText: root.bindTaken
      ? "SUPER+Z is taken"
      : (topLabel !== "" ? ("Undo " + topLabel) : "Undo — close a window, then Super+Z")
    onPressed: {
      if (!root.bar) return
      root.bar.run("omarchy-shell esegnorelli.undo undo")
    }
  }
}
