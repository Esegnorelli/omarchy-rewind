var fs = require("fs")
var path = require("path")
var child = require("child_process")
var M = require("../Model.js")

var home = process.env.HOME
var file = path.join(home, ".config/hypr/bindings.lua")
var raw = ""
try { raw = fs.readFileSync(file, "utf8") } catch (e) {
  process.stdout.write("missing\n")
  process.exit(1)
}
if (M.superZTaken(raw)) {
  process.stdout.write("taken\n")
  process.exit(0)
}
var next = M.mergeBinds(raw)
if (next === raw) {
  process.stdout.write("ok\n")
  process.exit(0)
}
fs.writeFileSync(file, next)
child.spawnSync("hyprctl", ["reload"])
process.stdout.write("written\n")
