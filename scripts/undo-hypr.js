var net = require("net")
var fs = require("fs")
var child = require("child_process")
var M = require("../Model.js")

var env = M.envFromHome(process.env.HOME)
var bootId = M.readBootId()
var cache = {}

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
  var i, c, addr, proc
  for (i = 0; i < clients.length; i++) {
    c = clients[i]
    addr = M.normalizeAddr(c.address)
    proc = c.pid ? M.readProc(c.pid) : { cmdline: [], cwd: "" }
    cache[addr] = { client: c, proc: proc }
  }
}

function onClose(address) {
  var hit = cache[address]
  if (!hit) {
    refreshCache()
    hit = cache[address]
  }
  if (!hit) return
  delete cache[address]
  var item = M.itemFromClient(hit.client, Date.now(), hit.proc)
  if (M.shouldSkipWindow(item)) return
  M.pushAndSave(env, item, bootId)
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
var buf = ""
var conn = net.createConnection(sock)
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
