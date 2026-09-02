# Undo

Super+Z for the Omarchy desktop. Close the wrong window, it comes back. An agent rewrites `shell.json`, it comes back. One stack, one key.

This replaces Rewind as the contest product. Rewind's git store stays as the config engine under the hood. The product is the key, not the timeline of diffs.

## Job

A single undo stack for two kinds of event:

- A Hyprland window closed (any closer: Super+W, titlebar, kill)
- A config burst (the Rewind watcher)

Super+Z pops the top. Super+Shift+Z opens the overlay to pick any item. The bar shows the top in a few words.

If Undo is doing session restore at login, redo, or workspace recreation, it is out of spec.

## Why this

Rewind is insurance. You notice it after a disaster. Super+Z is muscle memory. You notice it the first time you close the wrong terminal.

Session restore is the most-filed Omarchy request and already has three plugins. It fires once a morning. Undo fires all day.

`SUPER + Z` is unbound. `SUPER + CTRL + Z` is zoom. Leave zoom alone.

## Shape

Plugin id `esegnorelli.undo`. Public name Undo. MIT. Author Esegnorelli.

| Kind | File | Role |
|------|------|------|
| service | `Service.qml` | Always on. Hyprland socket2 + config watcher. Owns the stack. IPC `undo`. |
| bar-widget | `BarWidget.qml` | Icon plus a short label for the top item. Click undoes. |
| overlay | `Overlay.qml` | History. Click an item to restore that one. |

`keepLoaded` is false. State file: `~/.local/state/omarchy/undo-stack.json`.

Bar `defaultSection`: right. `category`: System. `allowMultiple`: false.

On enable, append a marked block to `~/.config/hypr/bindings.lua` if the marker is missing:

```lua
-- esegnorelli.undo
o.bind("SUPER + Z", "Undo", "omarchy-shell esegnorelli.undo undo")
o.bind("SUPER + SHIFT + Z", "Undo history", "omarchy-shell shell toggle esegnorelli.undo")
```

On remove, README says to delete that block. Do not rewrite the rest of the file. If Super+Z is already bound to something else, skip the bind and show a bar tooltip `SUPER+Z is taken`.

## Stack items

Each item is one JSON object. Newest at index 0.

Window:

```json
{
  "kind": "window",
  "ts": 0,
  "class": "com.mitchellh.ghostty",
  "title": "~",
  "workspace": 3,
  "floating": false,
  "cmdline": ["ghostty"],
  "cwd": "/home/you/proj",
  "label": "Ghostty · proj"
}
```

Config:

```json
{
  "kind": "config",
  "ts": 0,
  "commitId": "abc",
  "files": ["hypr/looknfeel.lua"],
  "configLabel": "agent",
  "label": "looknfeel.lua"
}
```

Cap: 50 items. Drop the oldest. Persist the stack across shell restart. Do not persist across reboot (window commands go stale; config commits remain in the git store but do not auto-fill the stack on boot).

## Window capture

Subscribe to Hyprland `$XDG_RUNTIME_DIR/hypr/$HYPRLAND_INSTANCE_SIGNATURE/.socket2.sock`.

On `openwindow` and `activewindow`, refresh a cache from `hyprctl clients -j`: address, class, title, workspace, floating, pid.

On `closewindow>>ADDRESS`, if the cache has that address, push a window item. Skip:

- namespaces `omarchy-` layer surfaces (bar, overlays, lock, OSD)
- class empty
- xdg-desktop-portal, polkit, 1password prompt classes listed in a skip array in Model.js

`cmdline` from `/proc/<pid>/cmdline` at last cache refresh (pid is gone at close). `cwd` from `/proc/<pid>/cwd` when class matches ghostty, alacritty, kitty, foot, org.wezfurlong.wezterm.

If cmdline is empty, store class only and resolve at undo time with `gtk-launch <desktop>` or `omarchy launch` heuristics in Model.js. If still empty, the undo fails that item.

## Config capture

Reuse Rewind's allowlist, burst gap (12s), git store at `~/.local/share/omarchy-rewind/store/` (keep the path so existing snapshots survive). When a burst records, also push a config item onto the undo stack.

## Super+Z

IPC target `esegnorelli.undo`, method `undo()`:

1. If stack is empty, run `omarchy-show-done` or a one-line notification: `Nothing to undo.`
2. Pop index 0.
3. Window: `hyprctl dispatch exec` with workspace: `hyprctl dispatch exec "[workspace N silent]" <cmdline>` then focus. Terminals: pass cwd (`ghostty --working-directory=`, `alacritty --working-directory=`, `kitty --directory=`, `foot -D`).
4. Config: existing restore (belt commit first, then files, then theme / hyprctl reload / rescanPlugins).
5. Persist stack. Bar label updates.

Overlay click on item i restores that item only and removes it. It does not replay the ones above it.

Middle-click on the bar does nothing. Left-click on the bar is Super+Z (undo top), not open overlay. Overlay is Super+Shift+Z only.

## Overlay

Left: list, newest first, kind chip (`window` / `config`) plus `label`. Right: for window, class and cwd; for config, file list and diff (Rewind's diff). Bottom: Restore this.

Keyboard: `j`/`k`, `Enter` restore selected, `Esc` close, type to filter.

Empty: `Nothing to undo.`

## Errors

| Case | User sees | System does |
|------|-----------|-------------|
| empty stack | `Nothing to undo.` | no-op |
| window exec fails | notification with class | item already popped; do not auto-retry |
| no cmdline and gtk-launch fails | `Can't reopen <class>` | popped |
| config restore mid-fail | overlay/notification error | belt rollback as in Rewind spec |
| socket2 dies | bar muted, `Not recording` | service reconnects |
| Super+Z already bound | tooltip on bar | skip writing binds |

Never sudo. Writes only: hypr/omarchy config (config restore), `~/.local/share/omarchy-rewind/`, `~/.local/state/omarchy/undo*`, `~/.local/state/omarchy/rewind*`, and the marked block in `bindings.lua`.

## Tests

`node test-model.js`. No live Hyprland.

Keep the Rewind tests. Add:

- stack push/pop/cap 50
- skip layer namespaces and empty class
- cmdline from proc-style null-separated buffer
- terminal cwd flag per class
- closewindow parse (`closewindow>>ADDRESS`)
- filterPoints on mixed window/config items

## Files

```
omarchy-undo/   (or this repo, renamed)
  manifest.json          # esegnorelli.undo
  Service.qml
  BarWidget.qml
  Overlay.qml
  Model.js
  test-model.js
  scripts/rewind-record
  scripts/rewind-watch
  scripts/undo-hypr
  scripts/hooks/theme-set
  scripts/hooks/post-update
  preview.png
  README.md
  LICENSE
```

Ship as a new plugin id. Disable `esegnorelli.rewind` on this machine when Undo enables, so two undo UIs do not fight. Close or update marketplace issue #4412 to point at Undo.

## Out of scope

- Session restore at login
- Redo (Super+Shift+Z is history, not redo)
- Recreating empty workspaces
- Browser tab stacks
- Replacing Super+W
- Cloud

## Success

A judge closes a terminal by accident, hits Super+Z, the terminal is back on the same workspace in the same directory, without reading a README. Then an agent edits gaps, Super+Z, gaps return.

`omarchy plugin validate .` passes. `node test-model.js` passes.
