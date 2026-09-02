var M = require("./Model.js")
var fs = require("fs")
var os = require("os")
var path = require("path")
var fails = 0

function assert(name, cond) {
  if (cond) {
    console.log("ok  " + name)
    return
  }
  fails += 1
  console.log("FAIL  " + name)
}

function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "rewind-"))
}

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
}

var t0 = 1_700_000_000_000
var gap = M.BURST_GAP_MS

var bursts = M.coalesceEvents([
  { path: "/a", ts: t0 },
  { path: "/b", ts: t0 + 1000 },
  { path: "/c", ts: t0 + 2000 },
  { path: "/d", ts: t0 + 2000 + gap },
  { path: "/e", ts: t0 + 2000 + gap + 13000 },
], gap)
assert("coalesce same burst under 12s", bursts.length === 3)
assert("coalesce first burst files", bursts[0].paths.join(",") === "/a,/b,/c")
assert("coalesce 12s gap is new burst", bursts[1].paths.join(",") === "/d")
assert("coalesce later burst", bursts[2].paths.join(",") === "/e")

var home = "/home/x"
assert("allow hypr lua", M.isAllowedPath(home + "/.config/hypr/bindings.lua", home, { size: 10, symlink: false }))
assert("allow shell.json", M.isAllowedPath(home + "/.config/omarchy/shell.json", home, { size: 10, symlink: false }))
assert("allow theme toml", M.isAllowedPath(home + "/.config/omarchy/themes/foo/colors.toml", home, { size: 10, symlink: false }))
assert("allow plugin qml", M.isAllowedPath(home + "/.config/omarchy/plugins/a/BarWidget.qml", home, { size: 10, symlink: false }))
assert("reject other config", !M.isAllowedPath(home + "/.config/nvim/init.lua", home, { size: 10, symlink: false }))
assert("reject omarchy branding", !M.isAllowedPath(home + "/.config/omarchy/branding/x.png", home, { size: 10, symlink: false }))
assert("reject plugin png", !M.isAllowedPath(home + "/.config/omarchy/plugins/a/capy.png", home, { size: 10, symlink: false }))
assert("reject secret env", !M.isAllowedPath(home + "/.config/hypr/.env", home, { size: 10, symlink: false }))
assert("reject id_rsa", !M.isAllowedPath(home + "/.config/omarchy/hooks/id_rsa", home, { size: 10, symlink: false }))
assert("reject git", !M.isAllowedPath(home + "/.config/omarchy/plugins/a/.git/config", home, { size: 10, symlink: false }))
assert("reject huge", !M.isAllowedPath(home + "/.config/hypr/big.lua", home, { size: 256 * 1024 + 1, symlink: false }))
assert("reject escaped symlink", !M.isAllowedPath(home + "/.config/hypr/out", home, { size: 10, symlink: true, realpath: "/etc/passwd" }))
assert("allow symlink inside", M.isAllowedPath(home + "/.config/hypr/link.lua", home, { size: 10, symlink: true, realpath: home + "/.config/hypr/bindings.lua" }))

assert("store path hypr", M.toStorePath(home + "/.config/hypr/a.lua", home) === "hypr/a.lua")
assert("store path omarchy", M.toStorePath(home + "/.config/omarchy/shell.json", home) === "omarchy/shell.json")
assert("config path roundtrip", M.toConfigPath("hypr/a.lua", home) === home + "/.config/hypr/a.lua")

assert("label theme from files", M.classifyLabel({ files: ["omarchy/themes/x/colors.toml"], tag: "", agentRunning: true }) === "theme")
assert("label theme from hook", M.classifyLabel({ files: ["hypr/looknfeel.lua"], tag: "theme-set", agentRunning: false }) === "theme")
assert("label plugin only plugins", M.classifyLabel({ files: ["omarchy/plugins/a/BarWidget.qml"], tag: "", agentRunning: true }) === "plugin")
assert("label agent", M.classifyLabel({ files: ["hypr/bindings.lua"], tag: "", agentRunning: true }) === "agent")
assert("label you", M.classifyLabel({ files: ["hypr/bindings.lua"], tag: "", agentRunning: false }) === "you")
assert("theme beats plugin", M.classifyLabel({ files: ["omarchy/themes/x/colors.toml", "omarchy/plugins/a/A.qml"], tag: "", agentRunning: true }) === "theme")

assert("summary three names", M.summaryLine("agent", ["omarchy/shell.json", "hypr/a.lua", "hypr/b.lua"]) === "shell.json, a.lua, b.lua")
assert("summary update prefix", M.summaryLine("you", ["hypr/a.lua"], "update") === "update a.lua")

var swatches = M.parseColorSwatches('bg = "#1a1b26"\nfg = "#c0caf5"\nskip = 12\naccent = "#7aa2f7"')
assert("swatches count", swatches.length === 3)
assert("swatches hex", swatches[0] === "#1a1b26" && swatches[2] === "#7aa2f7")

assert("confirm copy", M.confirmCopy({ count: 8, hhmm: "14:32", label: "agent" }) === "Restore 8 files from 14:32 (agent). Current state is saved first.")

var reload = M.reloadPlan(["hypr/looknfeel.lua", "omarchy/themes/tokyo/colors.toml", "omarchy/shell.json"], "/home/x/.config/omarchy/themes/tokyo")
assert("reload theme first", reload[0] === "theme")
assert("reload hypr second", reload[1] === "hypr")
assert("reload plugins third", reload[2] === "plugins")

var filtered = M.filterPoints([
  { id: "1", label: "agent", summary: "shell.json", files: ["omarchy/shell.json"] },
  { id: "2", label: "you", summary: "bindings.lua", files: ["hypr/bindings.lua"] },
], "agent")
assert("filter by label", filtered.length === 1 && filtered[0].id === "1")
var filteredFile = M.filterPoints([
  { id: "1", label: "you", summary: "shell.json", files: ["omarchy/shell.json"] },
], "shell")
assert("filter by file", filteredFile.length === 1)

var keep = M.pruneIds(
  [
    { id: "old", ts: 1, size: 100 },
    { id: "mid", ts: 2, size: 100 },
    { id: "new", ts: 3, size: 100 },
  ],
  150,
  { headId: "new", beltId: "mid" }
)
assert("prune drops oldest not head/belt", keep.sort().join(",") === "mid,new")

var root = tmpHome()
var env = {
  home: root,
  shareDir: path.join(root, ".local/share/omarchy-rewind"),
  stateDir: path.join(root, ".local/state/omarchy"),
}
write(path.join(root, ".config/hypr/looknfeel.lua"), "gaps = 8\n")
write(path.join(root, ".config/omarchy/shell.json"), "{\"version\":1}\n")

var rec1 = M.recordBurst(env, {
  paths: [
    path.join(root, ".config/hypr/looknfeel.lua"),
    path.join(root, ".config/omarchy/shell.json"),
    path.join(root, ".config/nvim/init.lua"),
  ],
  tag: "",
  agentRunning: true,
  now: t0,
})
assert("record created", rec1.recorded === true && rec1.id)
assert("record skipped nvim", rec1.files.length === 2)
assert("record label agent", rec1.label === "agent")

var status1 = M.readStatus(env)
assert("status newest first", status1.points[0].id === rec1.id)
assert("status shape files", Array.isArray(status1.points[0].files) && status1.points[0].files.indexOf("hypr/looknfeel.lua") >= 0)
assert("status recording", status1.recording === true)

fs.writeFileSync(path.join(root, ".config/hypr/looknfeel.lua"), "gaps = 2\n")
var rec2 = M.recordBurst(env, {
  paths: [path.join(root, ".config/hypr/looknfeel.lua")],
  tag: "",
  agentRunning: false,
  now: t0 + 60000,
})
assert("second point", rec2.recorded === true && rec2.id !== rec1.id)
assert("second label you", rec2.label === "you")

var diff = M.diffText(env, rec1.id, "hypr/looknfeel.lua")
assert("diff shows old gaps", diff.indexOf("gaps = 8") >= 0)
assert("diff shows new gaps", diff.indexOf("gaps = 2") >= 0)

var restored = M.restorePoint(env, rec1.id, { now: t0 + 120000 })
assert("restore ok", restored.ok === true)
assert("restore wrote old gaps", fs.readFileSync(path.join(root, ".config/hypr/looknfeel.lua"), "utf8") === "gaps = 8\n")
assert("restore belt exists", restored.beltId)
var status2 = M.readStatus(env)
assert("belt is newest", status2.points[0].id === restored.beltId)
assert("belt summary", status2.points[0].summary.indexOf("before restore") >= 0)

var blew = false
var failed = M.restorePoint(env, rec2.id, {
  now: t0 + 180000,
  copyFile: function (from, to) {
    var restoring = from.indexOf("/store/") >= 0 && to.indexOf("/.config/") >= 0
    if (restoring && !blew) {
      blew = true
      throw new Error("disk full")
    }
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.copyFileSync(from, to)
  },
})
assert("restore abort reports error", failed.ok === false && String(failed.error).indexOf("disk full") >= 0)
assert("restore abort rolled back", fs.readFileSync(path.join(root, ".config/hypr/looknfeel.lua"), "utf8") === "gaps = 8\n")

write(path.join(root, ".config/omarchy/themes/x/colors.toml"), 'bg = "#000000"\n')
var recTheme = M.recordBurst(env, {
  paths: [path.join(root, ".config/omarchy/themes/x/colors.toml")],
  tag: "theme-set",
  agentRunning: false,
  now: t0 + 240000,
  capBytes: 200,
})
assert("tiny cap still keeps newest", recTheme.recorded === true)
var afterPrune = M.readStatus(env)
assert("prune left at least two or newest", afterPrune.points.length >= 1)
assert("prune kept newest", afterPrune.points[0].id === recTheme.id)

var refused = M.restorePoint(env, rec1.id, {
  now: t0 + 300000,
  extraFiles: ["../escape.lua"],
})
assert("refuse does not crash", typeof refused.ok === "boolean")

fs.rmSync(root, { recursive: true, force: true })

var ev = M.parseHyprEvent("closewindow>>0x560bdcbe6460")
assert("parse closewindow", ev.name === "closewindow" && ev.address === "0x560bdcbe6460")
var evBare = M.parseHyprEvent("closewindow>>560bde267be0")
assert("parse closewindow bare hex", evBare.address === "0x560bde267be0")
var evOpen = M.parseHyprEvent("openwindow>>0xabc,2,com.mitchellh.ghostty,casa: hdp")
assert("parse openwindow class", evOpen.name === "openwindow" && evOpen.class === "com.mitchellh.ghostty")
assert("parse openwindow title", evOpen.title === "casa: hdp" && evOpen.workspace === "2")
assert("parse junk", M.parseHyprEvent("nope") === null)

assert("skip empty class", M.shouldSkipWindow({ class: "" }) === true)
assert("skip portal", M.shouldSkipWindow({ class: "xdg-desktop-portal-gtk" }) === true)
assert("skip omarchy layer class", M.shouldSkipWindow({ class: "omarchy-bar" }) === true)
assert("keep ghostty", M.shouldSkipWindow({ class: "com.mitchellh.ghostty" }) === false)

var cmd = M.parseCmdline("ghostty\u0000--working-directory=/tmp\u0000")
assert("parse cmdline", cmd[0] === "ghostty" && cmd[1] === "--working-directory=/tmp")
assert("ghostty cwd flag", M.terminalCwdArgs("com.mitchellh.ghostty", "/tmp").join(" ") === "--working-directory=/tmp")
assert("alacritty cwd flag", M.terminalCwdArgs("Alacritty", "/tmp").join(" ") === "--working-directory /tmp")
assert("kitty cwd flag", M.terminalCwdArgs("kitty", "/tmp").join(" ") === "--directory /tmp")
assert("foot cwd flag", M.terminalCwdArgs("foot", "/tmp").join(" ") === "-D /tmp")
assert("firefox no cwd", M.terminalCwdArgs("firefox", "/tmp").length === 0)

var wItem = {
  kind: "window",
  class: "com.mitchellh.ghostty",
  title: "~",
  cwd: "/home/you/proj",
  workspace: 3,
  cmdline: ["ghostty"],
}
assert("window label", M.windowLabel(wItem) === "Ghostty · proj")
var spec = M.hyprExecSpec(wItem)
assert("hypr workspace prefix", spec.indexOf("[workspace 3 silent]") === 0)
assert("hypr has ghostty", spec.indexOf("ghostty") >= 0)
assert("hypr has cwd", spec.indexOf("working-directory") >= 0)
assert("hypr uses uwsm", spec.indexOf("uwsm-app") >= 0)
assert("dispatch lua", M.hyprDispatchArg(spec).indexOf("hl.dsp.exec_cmd") === 0)

var stack = []
stack = M.pushItem(stack, { kind: "window", label: "A", ts: 1 })
stack = M.pushItem(stack, { kind: "config", label: "B", ts: 2 })
assert("push newest first", stack[0].label === "B" && stack[1].label === "A")
var popped = M.popItem(stack)
assert("pop top", popped.item.label === "B" && popped.stack[0].label === "A")
var many = []
var i
for (i = 0; i < 60; i++) many = M.pushItem(many, { kind: "window", label: String(i), ts: i })
assert("cap 50", many.length === 50 && many[0].label === "59" && many[49].label === "10")
var mixed = [
  { kind: "window", label: "Ghostty · proj", class: "com.mitchellh.ghostty" },
  { kind: "config", label: "shell.json", files: ["omarchy/shell.json"] },
]
assert("filter mixed window", M.filterPoints(mixed, "ghost").length === 1)
assert("filter mixed config", M.filterPoints(mixed, "shell").length === 1)

var bootA = "aaa"
var bootB = "bbb"
var saved = { bootId: bootA, items: [{ kind: "window", label: "X" }, { kind: "config", label: "Y" }] }
var loadedSame = M.loadStack(saved, bootA)
assert("same boot keeps stack", loadedSame.length === 2)
var loadedNew = M.loadStack(saved, bootB)
assert("new boot clears stack", loadedNew.length === 0)

assert("superZ taken", M.superZTaken('o.bind("SUPER + Z", "other", "true")\n') === true)
assert("superZ free", M.superZTaken("-- nothing\n") === false)
assert("superZ ours not taken", M.superZTaken("-- esegnorelli.undo\no.bind(\"SUPER + Z\", \"Undo\", \"x\")\n") === false)
var merged = M.mergeBinds("-- keep me\n")
assert("merge adds marker", merged.indexOf("-- esegnorelli.undo") >= 0)
assert("merge idempotent", M.mergeBinds(merged) === merged)

if (fails) {
  console.log(fails + " failed")
  process.exit(1)
}
console.log("all passed")
