# Rewind

Undo for [Omarchy](https://omarchy.org/) config. An agent (or you) breaks the bar, one click puts `shell.json` back.

Rewind watches `~/.config/hypr` and the Omarchy config that actually runs the desktop. Each burst of edits becomes a point on a timeline. Restore writes a safety snapshot first, then puts those files back and reloads Hyprland / the shell / the theme.

Nothing leaves the machine.

![Rewind](preview.png)

## Install

```bash
omarchy plugin add https://github.com/Esegnorelli/omarchy-rewind.git --enable
```

Left-click the rewind icon on the bar to open the timeline.

Suggested bind in `~/.config/hypr/bindings.lua`:

```lua
o.bind("SUPER + SHIFT + Z", "Rewind config", "omarchy-shell shell toggle esegnorelli.rewind")
```

## Use

- `j` / `k` move through time
- `Enter` restores the selected point
- `Esc` closes
- Type to filter by file or label (`agent`, `you`, `theme`, `plugin`)

Labels: `theme` if a theme file or `theme-set` hook fired, `plugin` if the burst is only plugin QML, `agent` if grok/claude/codex/cursor/agent is running, otherwise `you`.

## Remove

```bash
omarchy plugin disable esegnorelli.rewind
omarchy plugin remove esegnorelli.rewind --yes
rm -f ~/.config/omarchy/hooks/theme-set.d/rewind ~/.config/omarchy/hooks/post-update.d/rewind
# optional:
# rm -rf ~/.local/share/omarchy-rewind ~/.local/state/omarchy/rewind-status.json ~/.local/state/omarchy/rewind-tag ~/.local/state/omarchy/rewind-error.log ~/.local/state/omarchy/rewind-pending.txt
```

A leftover hook only writes a tag nobody reads.

## What is stored

| Path | What |
|------|------|
| `~/.local/share/omarchy-rewind/store/` | Hidden git snapshots (parentless commits) |
| `~/.local/state/omarchy/rewind-status.json` | Timeline the overlay reads |
| `~/.local/state/omarchy/rewind-tag` | Last hook (`theme-set` / `update`) |

Watched: Hyprland config, `shell.json`, themes, hooks, extensions, and plugin `qml/js/json/toml/lua` files. Secrets, `.git/`, and files over 256KB are skipped. Cap: 200MB.

## Requirements

- Omarchy Quattro
- `inotifywait` (inotify-tools) and `node` on `PATH`

No accounts. No network.

## License

MIT
