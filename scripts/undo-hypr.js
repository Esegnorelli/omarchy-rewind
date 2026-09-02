var net = require("net")
var fs = require("fs")
var child = require("child_process")
var M = require("../Model.js")

var env = M.envFromHome(process.env.HOME)
var bootId = M.readBootId()
var cache = {}
var logFile = (process.env.XDG_STATE_HOME || env.home + "/.local/state") + "/omarchy/undo-hypr.log"

function log(msg) {
  try {
    fs.appendFileSync(logFile, new Date().toISOString() + " " + msg + "\n")
  } catch (e) {}
}

function socketPath() {
  var runtime = process.env.XDG_RUNTIME_DIR || ("/run/user/" + process.getuid())
  var sig = process.env.HYPRLAND_INSTANCE_SIGNATURE
  if (sig) return runtime + "/hypr/" + sig + "/.socket2.sock"
  var dir = runtime + "/hypr"
  var names = []
  try { names = fs.readdirSync(dir) } catch (e) { return "" }
  var i
  for (i = 0; i < names.length; i++) {
    var p = dir + "/" + names[i] + "/.socket2.sock"
    if (fs.existsSync(p)) return p
  }
  return ""
}

function refreshCache() {
  var r = child.spawnSync("hyprctl", ["clients", "-j"], { encoding: "utf8" })
  var clients = []
  try { clients = JSON.parse(r.stdout || "[]") } catch (e) { return }
  var i, c, addr, proc, entry
  for (i = 0; i < clients.length; i++) {
    c = clients[i]
    addr = M.normalizeAddr(c.address)
    proc = c.pid ? M.readProc(c.pid) : { cmdline: [], cwd: "" }
    entry = { client: c, proc: proc }
    cache[addr] = entry
    if (addr.indexOf("0x") === 0) cache[addr.slice(2)] = entry
  }
}

function onClose(address) {
  var hit = cache[address] || cache[M.normalizeAddr(address)]
  if (!hit) {
    log("close miss " + address + " cache=" + Object.keys(cache).length)
    return
  }
  delete cache[address]
  delete cache[M.normalizeAddr(address)]
  var item = M.itemFromClient(hit.client, Date.now(), hit.proc)
  if (M.shouldSkipWindow(item)) {
    log("close skip " + item.class)
    return
  }
  M.pushAndSave(env, item, bootId)
  log("close save " + item.label + " " + item.class)
}

function handleLine(line) {
  var ev = M.parseHyprEvent(line)
  if (!ev) return
  if (ev.name === "openwindow" || ev.name === "activewindow" || ev.name === "activewindowv2") {
    refreshCache()
    return
  }
  if (ev.name === "closewindow") onClose(ev.address)
}

var sock = socketPath()
if (!sock) {
  process.stderr.write("undo-hypr: no hypr socket2\n")
  process.exit(1)
}

refreshCache()
M.writeStackFile(env, M.readStackFile(env, bootId))
log("start sock=" + sock + " cache=" + Object.keys(cache).length)
setInterval(refreshCache, 2000).unref()
var buf = ""
var conn = net.createConnection({ path: sock })
conn.setEncoding("utf8")
conn.on("data", function (chunk) {
  buf += chunk
  var parts = buf.split("\n")
  buf = parts.pop()
  var i
  for (i = 0; i < parts.length; i++) handleLine(parts[i])
})
conn.on("error", function (err) {
  process.stderr.write("undo-hypr: " + err.message + "\n")
  process.exit(1)
})
conn.on("close", function () {
  process.exit(1)
})
