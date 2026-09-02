var child = require("child_process")
var M = require("../Model.js")

var env = M.envFromHome(process.env.HOME)
var bootId = M.readBootId()
var ROOT = require("path").join(__dirname, "..")

function run(bin, args) {
  return child.spawnSync(bin, args || [], { encoding: "utf8" })
}

function notify(title, body) {
  var msg = body ? title + " — " + body : title
  run("omarchy", ["osd", "-m", msg, "-d", "1800"])
  var args = ["-u", "normal", "-g", "󰕍", title]
  if (body) args.push(body)
  run("omarchy-notification-send", args)
}

function gtkLaunch(cls) {
  var names = [cls, cls + ".desktop"]
  var last = String(cls || "").split(".").pop()
  if (last && last !== cls) names.push(last, last + ".desktop")
  var i, r
  for (i = 0; i < names.length; i++) {
    r = run("gtk-launch", [names[i]])
    if (r.status === 0) return true
  }
  return false
}

var index = process.argv[2]
var popped
if (index != null && index !== "") {
  popped = M.removeAtAndSave(env, Number(index), bootId)
} else {
  popped = M.popAndSave(env, bootId)
}

if (!popped.item) {
  notify("Nothing to undo.")
  process.stdout.write(JSON.stringify({ ok: false, empty: true }) + "\n")
  process.exit(0)
}

var item = popped.item
if (item.kind === "config") {
  var rec = run(ROOT + "/scripts/rewind-record", ["restore", item.commitId])
  process.stdout.write(rec.stdout || "")
  if (rec.status !== 0) {
    notify("Undo failed", item.label || "config")
    process.exit(1)
  }
  process.exit(0)
}

var spec = M.hyprExecSpec(item)
var hasCmd = item.cmdline && item.cmdline.length
var r
if (hasCmd) {
  r = run("hyprctl", ["dispatch", M.hyprDispatchArg(spec)])
  if (r.status === 0) {
    process.stdout.write(JSON.stringify({ ok: true, kind: "window", label: item.label }) + "\n")
    process.exit(0)
  }
}
if (gtkLaunch(item.class)) {
  process.stdout.write(JSON.stringify({ ok: true, kind: "window", label: item.label, via: "gtk-launch" }) + "\n")
  process.exit(0)
}
notify("Can't reopen " + (item.class || "window"))
process.stdout.write(JSON.stringify({ ok: false, error: "Can't reopen " + item.class }) + "\n")
process.exit(1)
