var M = require("../Model.js")
var fs = require("fs")
var child = require("child_process")

function env() {
  return M.envFromHome(process.env.HOME)
}

function run(bin, args) {
  return child.spawnSync(bin, args || [], { encoding: "utf8" })
}

function activeThemeDir() {
  var cur = run("omarchy", ["theme", "current"])
  var name = String(cur.stdout || "").trim()
  if (!name) return ""
  var dir = run("omarchy", ["theme", "dir", name])
  return String(dir.stdout || "").trim()
}

function applyReload(steps) {
  var i
  for (i = 0; i < (steps || []).length; i++) {
    if (steps[i] === "theme") run("omarchy", ["theme", "refresh"])
    if (steps[i] === "hypr") run("hyprctl", ["reload"])
    if (steps[i] === "plugins") run("omarchy-shell", ["shell", "rescanPlugins"])
  }
}

function readStdinPaths() {
  try {
    var raw = fs.readFileSync(0, "utf8")
    return raw.split(/\n/).map(function (s) { return s.trim() }).filter(Boolean)
  } catch (e) {
    return []
  }
}

function writeRecording(on, error) {
  var e = env()
  var status = M.readStatus(e)
  status.recording = !!on
  if (error) status.error = error
  fs.mkdirSync(e.stateDir, { recursive: true })
  fs.writeFileSync(
    e.stateDir + "/rewind-status.json",
    JSON.stringify(status, null, 2) + "\n"
  )
}

var args = process.argv.slice(2)
var cmd = args[0] || "record"

if (cmd === "restore") {
  var result = M.restorePoint(env(), args[1], { activeThemeDir: activeThemeDir() })
  if (result.ok) applyReload(result.reload)
  process.stdout.write(JSON.stringify(result) + "\n")
  process.exit(result.ok ? 0 : 1)
}

if (cmd === "diff") {
  process.stdout.write(M.diffText(env(), args[1], args[2] || "") + "\n")
  process.exit(0)
}

if (cmd === "status") {
  process.stdout.write(JSON.stringify(M.readStatus(env()), null, 2) + "\n")
  process.exit(0)
}

if (cmd === "recording") {
  writeRecording(args[1] !== "0" && args[1] !== "false", args[2] || "")
  process.exit(0)
}

var paths = cmd === "record" ? args.slice(1) : args
if (paths.length === 0) paths = readStdinPaths()
var rec = M.recordBurst(env(), {
  paths: paths,
  agentRunning: M.agentRunning(),
})
if (rec.recorded) {
  M.pushAndSave(env(), M.configItemFromRecord(rec), M.readBootId())
}
process.stdout.write(JSON.stringify(rec) + "\n")
process.exit(rec.recorded || !rec.error ? 0 : 1)
