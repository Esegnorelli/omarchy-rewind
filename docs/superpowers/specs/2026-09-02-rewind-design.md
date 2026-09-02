# Rewind

Undo for Omarchy config. An agent (or you) breaks the bar, one click puts `shell.json` back.

This is the product for the next Omarchy plugin competition ($10k pool, previous winners excluded, rules due within two weeks of 2026-09-01). It is not a pet, not AirDrop, not a home backup.

## Job

Watch the files that make the desktop, record each burst of edits as one point in time, let the user see a diff and restore that point.

If Rewind is doing anything else, it is out of spec.

## Why this and not the rest

The first contest rewarded three shapes: spectacle plus daily use (Radio Atlas), delight (Omagotchi), the Mac hole (AirPods). GitHub was useful and did not podium.

OmaCapy is a Tamagotchi. Omagotchi already won that shelf and is banned from round two anyway. LocalSend is first-party. Nearby, Time Machine (restic), and OmaConnect already exist.

Omarchy is Arch plus Hyprland plus agents writing `~/.config` all day. There is no undo. That is the hole.

## Shape

Plugin id `esegnorelli.rewind`. Public name Rewind. MIT.

| Kind | File | Role |
|------|------|------|
| service | `Service.qml` | Always on. Runs the watcher. Writes the store and the status JSON. |
| bar-widget | `BarWidget.qml` | Quiet icon. Pulses ~10s after a new point. Click summons the overlay. |
| overlay | `Overlay.qml` | Timeline, diff, restore. Loaded on summon. `open()` / `close()`. |

`keepLoaded` is false. The service holds state. The overlay reads `~/.local/state/omarchy/rewind-status.json`.

Enable path: `omarchy plugin add <repo> --enable`. That puts the service in `plugins[]` and the widget on the bar (`defaultSection`: right, `category`: System, `allowMultiple`: false).

## What is recorded

Allowlisted roots:

- `~/.config/hypr/`
- `~/.config/omarchy/shell.json`
- `~/.config/omarchy/themes/`
- `~/.config/omarchy/hooks/`
- `~/.config/omarchy/extensions/`
- `~/.config/omarchy/plugins/` only `*.qml`, `*.js`, `*.json`, `*.jsonc`, `*.md`, `*.toml`, `*.lua`, `*.conf`, `*.txt`, `*.css`, `*.yml`, `*.yaml`

A burst is every allowlisted write with gaps shorter than 12 seconds. The quiet trailing 12 seconds closes the burst as one point.

### Skip, even under those roots

- Paths matching `.ssh`, `.env`, `id_rsa`, `.pem`, `credentials`, `secrets`, `keyring`, `token`, `*.key`
- Any `.git/` directory
- Any file larger than 256KB
- Symlinks whose target is outside `~/.config/hypr` or `~/.config/omarchy`

v1 does not watch alacritty, kitty, ghostty, foot, nvim, or the rest of `~/.config`.

## Store

Git repo the user never sees, at `~/.local/share/omarchy-rewind/store/`.

Layout inside the repo mirrors the two roots:

```
store/
  hypr/...
  omarchy/...
```

`hypr/` maps to `~/.config/hypr/`. `omarchy/` maps to `~/.config/omarchy/`.

On a closed burst the watcher copies the touched allowlisted files into the store and creates one git commit with **no parent** (`git commit-tree`). Points are siblings, not a linear branch. Diff is `git diff A B`. Restore is checkout of that tree. Prune is delete the oldest ref plus `git gc`.

Commit message is one line: `agent: shell.json, bindings.lua` (label, then up to three basenames). Tag: `rewind/<unix-ms>`. Extra metadata (full path list, hook name if any) lives in `~/.local/share/omarchy-rewind/meta/<commit>.json`.

`~/.local/state/omarchy/rewind-status.json` is the overlay's index: commit id, time, label, summary, file list. The service rewrites it after every commit and every restore.

Cap: if `store/` exceeds 200MB, delete oldest snapshot refs until under the cap. Never delete HEAD (newest). Never delete the belt of an in-flight restore. If a prune would leave fewer than two points, stop. Tests call `prune(store, capBytes)` with a tiny cap, not 200MB.

## Labels

Each point gets exactly one label.

- `theme` if the burst includes a file under `themes/` or a `theme-set` hook fired during the burst
- `plugin` if the burst is only under `plugins/` or `omarchy plugin add|remove|update` ran during the burst
- `agent` if, at close of burst, any of these processes is running: `grok`, `claude`, `codex`, `cursor`, `agent`
- otherwise `you`

On first start, if missing, the service copies two hook scripts into `~/.config/omarchy/hooks/theme-set.d/rewind` and `post-update.d/rewind`. They write `~/.local/state/omarchy/rewind-tag`. The watcher reads and deletes that file when it closes a burst.

- `theme-set` → next burst is `theme`
- `post-update` → next burst is `you` with summary prefix `update`

Uninstall (README): `omarchy plugin remove esegnorelli.rewind --yes`, then delete those two hook files. A leftover hook only writes a tag nobody reads.

If both `theme` and `plugin` rules match, `theme` wins. `agent` only applies when the others do not.

inotify does not give the writer pid. Do not pretend it does. Do not pull in fanotify or auditd in v1.

## Overlay

Left column: vertical timeline, newest at the top. Each row is time, label chip, one-line summary.

Right column: files in the selected point. Click a file, see the unified diff against the next newer point (or against the working tree for the newest point). Monospace, theme colors.

If the point touched a `colors.toml`, show a row of hex swatches parsed from that file. Do not live-apply the theme while browsing.

Bottom: Restore this. Confirm copy: `Restore N files from HH:MM (label). Current state is saved first.`

Keyboard:

- `j` / `k` or arrows move in the timeline
- `Enter` restore (opens confirm)
- `/` filters the timeline by filename or label
- `Esc` closes. Click outside the panel also closes. The rest of the overlay is click-through.

Empty state: `Nothing recorded yet.`

Middle-click on the bar does nothing. The bar does not restore.

## Restore

1. Copy current allowlisted files that will be overwritten into the store and commit. This is the belt. Label `you`, summary `before restore`.
2. Check out the chosen commit's paths in the store.
3. Copy those files onto `~/.config/...`. Refuse any path that fails the allowlist, whose symlink escapes, or that would replace a directory with a file (or the reverse). Refused paths are listed. Remaining paths still restore.
4. Reload in this order, so restored Hyprland files win over theme templates:
   1. any restored file under the active theme directory (`omarchy theme dir "$(omarchy theme current)"`) → `omarchy theme refresh`
   2. any restored `hypr/` path → `hyprctl reload`
   3. any other restored `omarchy/` path → `omarchy-shell shell rescanPlugins`
5. If step 2 or 3 fails after the belt exists, check out the belt commit, copy back, reload, and show the error. Do not leave a half-written config.

Zero files restored is a hard error. The overlay stays open.

Restore always restores the whole point, not one file.

## Watcher

`scripts/rewind-watch`. The service starts it as a child process and restarts it if it exits.

Implementation: `inotifywait` recursive on the two roots, debounce 12s, then call into `Model.js` (via a small `scripts/rewind-record` node runner) to filter, copy, commit, and rewrite status.

If the watcher is dead, the bar icon uses a muted color and the overlay header reads `Not recording`.

The watcher must not block the shell. Failures go to the user journal (`logger --tag rewind`) and to `~/.local/state/omarchy/rewind-error.log`.

## Errors

| Case | What the user sees | What the system does |
|------|--------------------|----------------------|
| git commit fails | overlay toast on next open | retry on next quiet period |
| disk at cap | silent prune of old points | if still over cap after prune, skip the new snapshot and log |
| restore mid-fail | overlay error, config back to belt | belt checkout + reload |
| path refused | listed under the error, others restored | skip that path |
| watcher down | muted bar, `Not recording` | service restarts the child |
| store missing | first snapshot creates it | `git init` on first run |

Rewind never `sudo`s. It never writes outside `~/.config/hypr`, `~/.config/omarchy`, `~/.local/share/omarchy-rewind`, and `~/.local/state/omarchy/rewind*`.

## Tests

`node test-model.js`. No QML. No live inotify.

Covered:

- burst coalesce (events 1s apart become one point, a 13s gap starts another)
- allowlist accept/reject (roots, extensions, secrets, size, symlink escape)
- label precedence (`theme` > `plugin` > `agent` > `you`)
- restore plan (paths copied, belt commit first)
- restore abort (failed copy rolls back to belt, working tree matches belt)
- prune (oldest dropped, newest and belt kept, injectable cap)
- status JSON shape the overlay will read

v1 does not test inotify itself.

## Files

```
omarchy-rewind/
  manifest.json
  Service.qml
  BarWidget.qml
  Overlay.qml
  Model.js
  test-model.js
  scripts/rewind-watch
  scripts/rewind-record
  scripts/hooks/theme-set
  scripts/hooks/post-update
  preview.png
  README.md
  LICENSE
  docs/superpowers/specs/2026-09-02-rewind-design.md
```

`Model.js` is the source of truth for filter, coalesce, label, restore plan, prune. QML and the scripts call it. They do not reimplement those rules.

## Out of scope

- CLI (`rewind undo`)
- Single-file restore
- Live theme preview while scrubbing the timeline
- Cloud, remotes, branches
- Home / disk / pacman backup
- Watching the rest of `~/.config`
- fanotify pids
- Auto-restore
- Binding a default Super key (README may suggest one)

## Success

A judge can: enable the plugin, have an agent edit `looknfeel.lua` gaps, see the bar pulse, open the overlay, restore, watch the gaps return, without reading a manual.

`omarchy plugin validate .` passes. `node test-model.js` passes. Nothing leaves the machine except what the user already had in git when they publish the plugin.

## Marketplace

README in English (Core team). Short, like Radio Atlas: what it does, install, remove, what is stored where.

Submit to https://github.com/omacom/omarchy-plugin-marketplace when the second contest form is open. Until then the repo can be installed by URL.
