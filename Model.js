var BURST_GAP_MS = 12000
var MAX_FILE_BYTES = 256 * 1024
var DEFAULT_CAP_BYTES = 200 * 1024 * 1024
var ALLOWED_EXT = [
  ".qml", ".js", ".json", ".jsonc", ".md", ".toml", ".lua",
  ".conf", ".txt", ".css", ".yml", ".yaml",
]

var fs = null
var path = null
var child = null
if (typeof require !== "undefined") {
  fs = require("fs")
  path = require("path")
  child = require("child_process")
}

function unique(list) {
  var seen = {}
  var out = []
  var i, v
  for (i = 0; i < list.length; i++) {
    v = String(list[i] || "")
    if (!v || seen[v]) continue
    seen[v] = true
    out.push(v)
  }
  return out
}

function norm(p) {
  return String(p || "").replace(/\\/g, "/")
}

function extOf(p) {
  var base = norm(p).split("/").pop() || ""
  var i = base.lastIndexOf(".")
  if (i <= 0) return ""
  return base.slice(i).toLowerCase()
}

function isUnder(abs, root) {
  abs = norm(abs)
  root = norm(root)
  if (abs === root) return true
  var prefix = root.endsWith("/") ? root : root + "/"
  return abs.indexOf(prefix) === 0
}

function isSecretPath(p) {
  var n = norm(p)
  if (n.indexOf("/.ssh/") >= 0 || /\/\.ssh$/.test(n)) return true
  if (/(^|\/)\.env(\.|$)/.test(n)) return true
  if (n.indexOf("id_rsa") >= 0) return true
  if (/\.pem$/i.test(n)) return true
  if (/credentials/i.test(n)) return true
  if (/secrets/i.test(n)) return true
  if (/keyring/i.test(n)) return true
  if (/token/i.test(n)) return true
  if (/\.key$/i.test(n)) return true
  return false
}

function isGitPath(p) {
  var n = norm(p)
  return n.indexOf("/.git/") >= 0 || /\/\.git$/.test(n)
}

function configHypr(home) {
  return norm(home) + "/.config/hypr"
}

function configOmarchy(home) {
  return norm(home) + "/.config/omarchy"
}

function isAllowedPath(abs, home, info) {
  info = info || {}
  abs = norm(abs)
  home = norm(home)
  if (!abs || !home) return false
  if (isSecretPath(abs) || isGitPath(abs)) return false
  if (info.size > MAX_FILE_BYTES) return false
  if (info.symlink) {
    var real = norm(info.realpath || "")
    if (!isUnder(real, configHypr(home)) && !isUnder(real, configOmarchy(home))) return false
  }
  var hypr = configHypr(home)
  var oma = configOmarchy(home)
  if (isUnder(abs, hypr)) return true
  if (abs === oma + "/shell.json") return true
  if (isUnder(abs, oma + "/themes")) return true
  if (isUnder(abs, oma + "/hooks")) return true
  if (isUnder(abs, oma + "/extensions")) return true
  if (isUnder(abs, oma + "/plugins")) {
    return ALLOWED_EXT.indexOf(extOf(abs)) >= 0
  }
  return false
}

function toStorePath(abs, home) {
  abs = norm(abs)
  home = norm(home)
  var hypr = configHypr(home)
  var oma = configOmarchy(home)
  if (isUnder(abs, hypr)) return ("hypr/" + abs.slice(hypr.length + 1)).replace(/\/$/, "")
  if (isUnder(abs, oma)) return ("omarchy/" + abs.slice(oma.length + 1)).replace(/\/$/, "")
  return ""
}

function toConfigPath(rel, home) {
  rel = norm(rel).replace(/^\/+/, "")
  home = norm(home)
  if (rel.indexOf("hypr/") === 0) return home + "/.config/" + rel
  if (rel.indexOf("omarchy/") === 0) return home + "/.config/" + rel
  return ""
}

function coalesceEvents(events, gapMs) {
  gapMs = gapMs == null ? BURST_GAP_MS : gapMs
  var list = (events || []).slice().sort(function (a, b) { return a.ts - b.ts })
  var out = []
  var i, ev, last
  for (i = 0; i < list.length; i++) {
    ev = list[i]
    if (!out.length || ev.ts - last >= gapMs) {
      out.push({ ts: ev.ts, paths: [ev.path] })
    } else {
      out[out.length - 1].paths.push(ev.path)
    }
    last = ev.ts
  }
  return out
}

function classifyLabel(opts) {
  opts = opts || {}
  var files = opts.files || []
  var tag = opts.tag || ""
  var i
  var themeFile = false
  var allPlugin = files.length > 0
  for (i = 0; i < files.length; i++) {
    if (norm(files[i]).indexOf("omarchy/themes/") === 0) themeFile = true
    if (norm(files[i]).indexOf("omarchy/plugins/") !== 0) allPlugin = false
  }
  if (tag === "theme-set" || themeFile) return "theme"
  if (tag === "plugin" || allPlugin) return "plugin"
  if (opts.agentRunning) return "agent"
  return "you"
}

function summaryLine(label, files, prefix) {
  var names = []
  var i, base
  for (i = 0; i < files.length && names.length < 3; i++) {
    base = norm(files[i]).split("/").pop()
    if (base) names.push(base)
  }
  var body = names.join(", ")
  if (prefix) return prefix + (body ? " " + body : "")
  return body
}

function parseColorSwatches(text) {
  var out = []
  var re = /#([0-9a-fA-F]{6})\b/g
  var m
  var seen = {}
  text = String(text || "")
  while ((m = re.exec(text))) {
    var hex = "#" + m[1].toLowerCase()
    if (seen[hex]) continue
    seen[hex] = true
    out.push(hex)
  }
  return out
}

function confirmCopy(opts) {
  opts = opts || {}
  return "Restore " + opts.count + " files from " + opts.hhmm + " (" + opts.label + "). Current state is saved first."
}

function formatHhmm(ts) {
  var d = new Date(ts)
  var h = d.getHours()
  var m = d.getMinutes()
  return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m
}

function reloadPlan(files, activeThemeDir) {
  files = files || []
  var steps = []
  var i, f
  var theme = false
  var hypr = false
  var plugins = false
  var themePrefix = ""
  if (activeThemeDir) {
    var homeGuess = norm(activeThemeDir).split("/.config/")[0]
    themePrefix = toStorePath(activeThemeDir, homeGuess)
  }
  for (i = 0; i < files.length; i++) {
    f = norm(files[i])
    if (themePrefix && (f === themePrefix || f.indexOf(themePrefix + "/") === 0)) theme = true
    if (f.indexOf("hypr/") === 0) hypr = true
    if (f.indexOf("omarchy/") === 0 && f.indexOf("omarchy/themes/") !== 0) plugins = true
  }
  if (theme) steps.push("theme")
  if (hypr) steps.push("hypr")
  if (plugins) steps.push("plugins")
  return steps
}

function filterPoints(points, query) {
  query = String(query || "").trim().toLowerCase()
  if (!query) return points || []
  var out = []
  var i, p, blob
  for (i = 0; i < (points || []).length; i++) {
    p = points[i]
    blob = (p.label + " " + p.summary + " " + (p.files || []).join(" ")).toLowerCase()
    if (blob.indexOf(query) >= 0) out.push(p)
  }
  return out
}

function pruneIds(points, capBytes, keep) {
  keep = keep || {}
  points = (points || []).slice().sort(function (a, b) { return a.ts - b.ts })
  var total = 0
  var i
  for (i = 0; i < points.length; i++) total += Number(points[i].size) || 0
  var ids = points.map(function (p) { return p.id })
  i = 0
  while (total > capBytes && ids.length > 2 && i < points.length) {
    var p = points[i]
    i += 1
    if (p.id === keep.headId) continue
    if (keep.beltId && p.id === keep.beltId) continue
    var idx = ids.indexOf(p.id)
    if (idx < 0) continue
    ids.splice(idx, 1)
    total -= Number(p.size) || 0
  }
  return ids
}

function defaultCopy(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.copyFileSync(from, to)
}

function git(storeDir, args) {
  var env = {}
  var k
  if (typeof process !== "undefined" && process.env) {
    for (k in process.env) env[k] = process.env[k]
  }
  env.GIT_AUTHOR_NAME = "Rewind"
  env.GIT_AUTHOR_EMAIL = "rewind@omarchy"
  env.GIT_COMMITTER_NAME = "Rewind"
  env.GIT_COMMITTER_EMAIL = "rewind@omarchy"
  env.GIT_CONFIG_GLOBAL = "/dev/null"
  env.GIT_CONFIG_SYSTEM = "/dev/null"
  var r = child.spawnSync("git", ["-C", storeDir].concat(args), {
    encoding: "utf8",
    env: env,
  })
  return {
    code: r.status == null ? 1 : r.status,
    stdout: String(r.stdout || "").trim(),
    stderr: String(r.stderr || "").trim(),
  }
}

function ensureStore(storeDir) {
  fs.mkdirSync(storeDir, { recursive: true })
  if (!fs.existsSync(path.join(storeDir, ".git"))) {
    git(storeDir, ["init"])
    git(storeDir, ["config", "user.name", "Rewind"])
    git(storeDir, ["config", "user.email", "rewind@omarchy"])
  }
}

function wipeWorktree(storeDir) {
  var names = fs.readdirSync(storeDir)
  var i
  for (i = 0; i < names.length; i++) {
    if (names[i] === ".git") continue
    fs.rmSync(path.join(storeDir, names[i]), { recursive: true, force: true })
  }
}

function statInfo(abs) {
  try {
    var st = fs.lstatSync(abs)
    var symlink = st.isSymbolicLink()
    var real = abs
    if (symlink) real = fs.realpathSync(abs)
    return {
      size: st.size,
      symlink: symlink,
      realpath: real,
      exists: true,
      isFile: st.isFile() || (symlink && fs.statSync(abs).isFile()),
    }
  } catch (e) {
    return { size: 0, symlink: false, realpath: abs, exists: false, isFile: false }
  }
}

function tagPath(stateDir) {
  return path.join(stateDir, "rewind-tag")
}

function readTag(stateDir) {
  try {
    return fs.readFileSync(tagPath(stateDir), "utf8").trim()
  } catch (e) {
    return ""
  }
}

function clearTag(stateDir) {
  try { fs.unlinkSync(tagPath(stateDir)) } catch (e) {}
}

function writeMeta(metaDir, id, data) {
  fs.mkdirSync(metaDir, { recursive: true })
  fs.writeFileSync(path.join(metaDir, id + ".json"), JSON.stringify(data) + "\n")
}

function readMeta(metaDir, id) {
  try {
    return JSON.parse(fs.readFileSync(path.join(metaDir, id + ".json"), "utf8"))
  } catch (e) {
    return {}
  }
}

function statusFile(env) {
  return path.join(env.stateDir, "rewind-status.json")
}

function writeStatusFile(env, payload) {
  fs.mkdirSync(env.stateDir, { recursive: true })
  fs.writeFileSync(statusFile(env), JSON.stringify(payload, null, 2) + "\n")
}

function listPoints(storeDir) {
  if (!fs.existsSync(path.join(storeDir, ".git"))) return []
  var r = git(storeDir, ["tag", "-l", "rewind/*"])
  var tags = r.stdout ? r.stdout.split("\n") : []
  var out = []
  var i, tag, ts, id
  for (i = 0; i < tags.length; i++) {
    tag = tags[i]
    if (!tag) continue
    ts = Number(String(tag).replace("rewind/", ""))
    id = git(storeDir, ["rev-parse", tag]).stdout
    if (!id) continue
    out.push({ id: id, tag: tag, ts: ts })
  }
  return out
}

function storeSize(storeDir) {
  var r = child.spawnSync("du", ["-sb", storeDir], { encoding: "utf8" })
  var n = parseInt(String(r.stdout || "").split(/\s/)[0], 10)
  return isFinite(n) ? n : 0
}

function pruneStore(storeDir, capBytes, keep) {
  keep = keep || {}
  var points = listPoints(storeDir).sort(function (a, b) { return a.ts - b.ts })
  var guard = 0
  while (storeSize(storeDir) > capBytes && points.length > 2 && guard < 50) {
    guard += 1
    var drop = null
    var i
    for (i = 0; i < points.length; i++) {
      if (points[i].id === keep.headId) continue
      if (keep.beltId && points[i].id === keep.beltId) continue
      drop = points[i]
      break
    }
    if (!drop) break
    git(storeDir, ["tag", "-d", drop.tag])
    points = points.filter(function (p) { return p.id !== drop.id })
    git(storeDir, ["-c", "gc.auto=0", "gc", "--prune=now", "--quiet"])
  }
}

function recordBurst(env, opts) {
  opts = opts || {}
  var home = env.home
  var storeDir = path.join(env.shareDir, "store")
  var metaDir = path.join(env.shareDir, "meta")
  var now = opts.now || Date.now()
  var copyFile = opts.copyFile || defaultCopy
  var capBytes = opts.capBytes == null ? DEFAULT_CAP_BYTES : opts.capBytes

  fs.mkdirSync(env.shareDir, { recursive: true })
  fs.mkdirSync(env.stateDir, { recursive: true })
  fs.mkdirSync(metaDir, { recursive: true })
  ensureStore(storeDir)

  var allowed = []
  var files = []
  var paths = unique(opts.paths || [])
  var i, abs, st, rel
  for (i = 0; i < paths.length; i++) {
    abs = paths[i]
    st = statInfo(abs)
    if (!st.exists || !st.isFile) continue
    if (!isAllowedPath(abs, home, st)) continue
    rel = toStorePath(abs, home)
    if (!rel || rel.indexOf("..") >= 0) continue
    allowed.push(abs)
    files.push(rel)
  }
  if (allowed.length === 0) return { recorded: false, files: [] }

  var tag = opts.tag != null ? opts.tag : readTag(env.stateDir)
  if (opts.tag == null && tag) clearTag(env.stateDir)
  var label = opts.labelOverride || classifyLabel({
    files: files,
    tag: tag,
    agentRunning: !!opts.agentRunning,
  })
  var prefix = opts.summaryOverride || (tag === "update" ? "update" : "")
  var summary = opts.summaryOverride || summaryLine(label, files, prefix === "update" ? "update" : "")
  if (opts.summaryOverride) summary = opts.summaryOverride

  wipeWorktree(storeDir)
  for (i = 0; i < allowed.length; i++) {
    copyFile(allowed[i], path.join(storeDir, files[i]))
  }

  git(storeDir, ["add", "-A"])
  var tree = git(storeDir, ["write-tree"])
  if (tree.code !== 0 || !tree.stdout) {
    writeStatusFile(env, { recording: true, error: tree.stderr || "git write-tree failed", toast: tree.stderr, points: readStatus(env).points })
    return { recorded: false, error: tree.stderr, files: files }
  }
  var msg = label + ": " + summary
  var commit = git(storeDir, ["commit-tree", tree.stdout, "-m", msg])
  if (commit.code !== 0 || !commit.stdout) {
    writeStatusFile(env, { recording: true, error: commit.stderr || "git commit failed", toast: commit.stderr, points: readStatus(env).points })
    return { recorded: false, error: commit.stderr, files: files }
  }
  var id = commit.stdout
  git(storeDir, ["update-ref", "HEAD", id])
  git(storeDir, ["tag", "-f", "rewind/" + now, id])
  writeMeta(metaDir, id, { files: files, label: label, tag: tag || "", ts: now, summary: summary })
  pruneStore(storeDir, capBytes, { headId: id, beltId: opts.beltId })
  var status = assembleStatus(env, true, "")
  writeStatusFile(env, status)
  return { recorded: true, id: id, files: files, label: label, summary: summary }
}

function assembleStatus(env, recording, error) {
  var storeDir = path.join(env.shareDir, "store")
  var metaDir = path.join(env.shareDir, "meta")
  var points = listPoints(storeDir).sort(function (a, b) { return b.ts - a.ts })
  var out = []
  var i, meta
  for (i = 0; i < points.length; i++) {
    meta = readMeta(metaDir, points[i].id)
    out.push({
      id: points[i].id,
      tag: points[i].tag,
      ts: points[i].ts,
      label: meta.label || "you",
      summary: meta.summary || "",
      files: meta.files || [],
    })
  }
  return { recording: recording !== false, error: error || "", toast: error || "", points: out }
}

function readStatus(env) {
  var payload = assembleStatus(env, true, "")
  try {
    var prev = JSON.parse(fs.readFileSync(statusFile(env), "utf8"))
    if (prev && prev.recording === false) payload.recording = false
    if (prev && prev.error && !payload.error) payload.error = prev.error
  } catch (e) {}
  writeStatusFile(env, payload)
  return payload
}

function gitShow(storeDir, id, rel) {
  var r = git(storeDir, ["show", id + ":" + rel])
  if (r.code !== 0) return ""
  return r.stdout
}

function unifiedDiff(rel, older, newer) {
  older = String(older || "")
  newer = String(newer || "")
  if (older === newer) return ""
  var a = older.split("\n")
  var b = newer.split("\n")
  if (a.length && a[a.length - 1] === "") a.pop()
  if (b.length && b[b.length - 1] === "") b.pop()
  var lines = ["--- a/" + rel, "+++ b/" + rel]
  var i
  var max = Math.max(a.length, b.length)
  for (i = 0; i < max; i++) {
    if (i < a.length && i < b.length && a[i] === b[i]) {
      lines.push(" " + a[i])
    } else {
      if (i < a.length) lines.push("-" + a[i])
      if (i < b.length) lines.push("+" + b[i])
    }
  }
  return lines.join("\n")
}

function diffText(env, pointId, relPath) {
  var storeDir = path.join(env.shareDir, "store")
  var status = assembleStatus(env, true, "")
  var idx = -1
  var i
  for (i = 0; i < status.points.length; i++) {
    if (status.points[i].id === pointId) { idx = i; break }
  }
  var older = gitShow(storeDir, pointId, relPath)
  var newer = ""
  if (idx === 0) {
    try { newer = fs.readFileSync(toConfigPath(relPath, env.home), "utf8") } catch (e) { newer = "" }
  } else if (idx > 0) {
    newer = gitShow(storeDir, status.points[idx - 1].id, relPath)
    if (!newer) {
      try { newer = fs.readFileSync(toConfigPath(relPath, env.home), "utf8") } catch (e) { newer = "" }
    }
  }
  return unifiedDiff(relPath, older, newer)
}

function checkoutTree(storeDir, id) {
  wipeWorktree(storeDir)
  return git(storeDir, ["checkout", "-f", id, "--", "."])
}

function restorePoint(env, targetId, opts) {
  opts = opts || {}
  var home = env.home
  var storeDir = path.join(env.shareDir, "store")
  var metaDir = path.join(env.shareDir, "meta")
  var copyFile = opts.copyFile || defaultCopy
  var meta = readMeta(metaDir, targetId)
  var files = (meta.files || []).slice()
  if (opts.extraFiles) files = files.concat(opts.extraFiles)

  var refused = []
  var currentPaths = []
  var i, rel, abs, st
  for (i = 0; i < files.length; i++) {
    rel = norm(files[i])
    if (!rel || rel.indexOf("..") >= 0 || rel.charAt(0) === "/") {
      refused.push(rel)
      continue
    }
    abs = toConfigPath(rel, home)
    st = statInfo(abs)
    if (st.exists && st.isFile) currentPaths.push(abs)
  }

  var belt = recordBurst(env, {
    paths: currentPaths,
    tag: "",
    agentRunning: false,
    now: opts.now,
    copyFile: copyFile,
    labelOverride: "you",
    summaryOverride: "before restore",
  })

  function rollback() {
    if (!belt.id) return
    checkoutTree(storeDir, belt.id)
    var beltMeta = readMeta(metaDir, belt.id)
    var bf = beltMeta.files || []
    var j
    for (j = 0; j < bf.length; j++) {
      try {
        copyFile(path.join(storeDir, bf[j]), toConfigPath(bf[j], home))
      } catch (e2) {}
    }
  }

  var co = checkoutTree(storeDir, targetId)
  if (co.code !== 0) {
    rollback()
    return { ok: false, error: co.stderr || "checkout failed", beltId: belt.id, refused: refused }
  }

  var targetFiles = meta.files || []
  var restored = 0
  try {
    for (i = 0; i < targetFiles.length; i++) {
      rel = norm(targetFiles[i])
      if (!rel || rel.indexOf("..") >= 0 || rel.charAt(0) === "/") {
        refused.push(rel)
        continue
      }
      abs = toConfigPath(rel, home)
      st = statInfo(abs)
      if (st.exists && !st.isFile) {
        refused.push(rel)
        continue
      }
      copyFile(path.join(storeDir, rel), abs)
      restored += 1
    }
  } catch (e) {
    rollback()
    return { ok: false, error: e.message || String(e), beltId: belt.id, refused: refused }
  }

  if (restored === 0) {
    rollback()
    return { ok: false, error: "Zero files restored", beltId: belt.id, refused: refused }
  }

  var status = assembleStatus(env, true, "")
  writeStatusFile(env, status)
  return {
    ok: true,
    beltId: belt.id,
    restored: restored,
    refused: refused,
    reload: reloadPlan(targetFiles, opts.activeThemeDir || ""),
  }
}

function envFromHome(home) {
  home = home || (typeof process !== "undefined" && process.env.HOME) || ""
  var stateHome = (typeof process !== "undefined" && process.env.XDG_STATE_HOME) || (home + "/.local/state")
  var shareHome = (typeof process !== "undefined" && process.env.XDG_DATA_HOME) || (home + "/.local/share")
  return {
    home: home,
    shareDir: shareHome + "/omarchy-rewind",
    stateDir: stateHome + "/omarchy",
  }
}

function agentRunning() {
  if (!child) return false
  var names = ["grok", "claude", "codex", "cursor", "agent"]
  var i, r
  for (i = 0; i < names.length; i++) {
    r = child.spawnSync("pgrep", ["-x", names[i]], { encoding: "utf8" })
    if (r.status === 0) return true
  }
  return false
}

if (typeof module !== "undefined") {
  module.exports = {
    BURST_GAP_MS: BURST_GAP_MS,
    MAX_FILE_BYTES: MAX_FILE_BYTES,
    DEFAULT_CAP_BYTES: DEFAULT_CAP_BYTES,
    coalesceEvents: coalesceEvents,
    isAllowedPath: isAllowedPath,
    isSecretPath: isSecretPath,
    toStorePath: toStorePath,
    toConfigPath: toConfigPath,
    classifyLabel: classifyLabel,
    summaryLine: summaryLine,
    parseColorSwatches: parseColorSwatches,
    confirmCopy: confirmCopy,
    formatHhmm: formatHhmm,
    reloadPlan: reloadPlan,
    filterPoints: filterPoints,
    pruneIds: pruneIds,
    recordBurst: recordBurst,
    restorePoint: restorePoint,
    diffText: diffText,
    readStatus: readStatus,
    envFromHome: envFromHome,
    agentRunning: agentRunning,
    assembleStatus: assembleStatus,
  }
}
