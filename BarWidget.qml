import QtQuick
import qs.Commons
import qs.Ui

BarWidget {
  id: root
  moduleName: "esegnorelli.rewind"

  readonly property var rewindService: bar && bar.shell ? bar.shell.serviceFor(moduleName) : null
  readonly property bool recording: rewindService ? rewindService.recording === true : false
  readonly property double lastPointTs: rewindService ? Number(rewindService.lastPointTs) || 0 : 0
  property bool pulsing: false

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  onLastPointTsChanged: {
    if (lastPointTs > 0) {
      root.pulsing = true
      pulseTimer.restart()
    }
  }

  Timer {
    id: pulseTimer
    interval: 10000
    onTriggered: root.pulsing = false
  }

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: "\uf2ea"
    slotSize: Style.bar.statusSlot
    fontSize: Style.font.caption
    active: root.pulsing
    opacity: root.recording ? 1 : 0.45
    tooltipText: root.recording ? "Rewind config" : "Rewind (not recording)"
    onPressed: {
      if (!root.bar) return
      root.bar.run("omarchy-shell shell toggle esegnorelli.rewind")
    }
  }
}
