# Mod Switch

Several Claude Code mods can draw in the band above the prompt, and they share it. Mod Switch decides which of them show there and in what order, live, without turning anything off. It can also mute every mod's band at once, and switch any installed mod on or off.

It works with any mod. The mods it arranges don't need to know about it.

```text
Band
☐ Mute every mod's band
[↑] [↓] ☑ token-watch
[↑] [↓] ☐ replay-theater
[↑] [↓] ☑ blast-radius       takes the whole band
[Reset order]

Mods [↻]
☑ token-watch
☑ blast-radius
☐ replay-theater             /reload-plugins to apply
```

## Install

At the prompt of a terminal session:

```text
/plugin install mod-switch --marketplace nevermemo/mod-switch
```

From a shell:

```bash
claude plugin install mod-switch --marketplace nevermemo/mod-switch
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `nevermemo/mod-switch`, then **Add plugin**.

Then open the pane with `/mod-switch` and press **Run first** (see [below](#set-it-up-run-first)).

## Use it

- **`/mod-switch`** opens the pane.
- **Band:** tick a mod to show its part of the band, untick it to hide it. `[↑]` and `[↓]` move it. **Mute every mod's band** hides them all; the band of Claude Code's built-in mods stays. All of this applies at once, in every session, and nothing is unloaded: a hidden mod's commands and panes keep working.
- **Mods:** tick or untick a mod to switch it on or off with Claude Code's own switch (`claude plugin enable` / `disable`). That changes your settings, so it applies to every session, each at its next `/reload-plugins`. The pane marks the mods waiting for one.
- **`/mod-switch mute`** mutes or unmutes from the prompt.

## Set it up: run first

Mod Switch arranges what the mods after it draw, so it needs to run before them. Claude Code runs the mods named in `prependPlugins` first. If Mod Switch isn't named there, the pane says so and its **Run first** button adds it to your `~/.claude/settings.json`:

```json
{
  "prependPlugins": ["mod-switch@mod-switch"]
}
```

(`mod-switch@mod-switch` when installed from this repository; the part after `@` is the marketplace's name.)

Claude Code reads `prependPlugins` from your own settings only on a machine without managed settings, and only when the session isn't signed in with a Team or Enterprise `/login`. Elsewhere it's your organisation's to set, and Mod Switch arranges only the mods that load after it.

Requires Claude Code 2.1.309 or later.

## What it can't do

- **A mod that takes the whole band:** a mod that draws without passing the band on (Blast Radius while it holds a command, for example) stops the mods after it from drawing while it does. Hiding it hides it, but can't bring those back; switching it off can. The pane labels such a mod *takes the whole band*.
- **A mod that changes what the mods after it drew:** its part can't be told apart from theirs, so while it draws that way the band stays as Claude Code drew it. The pane labels it *drawn as it is*.
- **Switching a mod on or off without a reload:** Claude Code applies it at the next `/reload-plugins`, which has to be typed: a reload a mod starts is refused.

## How it works

The band is drawn by a chain: each mod's hook draws its part and passes the band on to the next, Claude Code's own last. A mod that stacks draws its line and puts what it got back underneath. Mod Switch runs first, lets the chain draw, and reads what each mod drew from the chain's trace (`next.trace`). A mod's own part is its drawing with the next mod's drawing taken out. Mod Switch then draws the band again from the parts you chose, in your order. With nothing hidden or reordered, it leaves the band exactly as the chain drew it.

The arrangement is kept in Mod Switch's store, which every session shares; each session picks up a change within 30 seconds.

## Privacy

Mod Switch makes no network connections. What it touches:

- **Runs** `claude plugin list --json` when the pane opens or you press `[↻]`, and `claude plugin enable` / `disable <mod> --scope <scope>` when you tick a mod.
- **Reads** each installed plugin's `hooks/hooks.json`, to tell mods from other plugins, and the `prependPlugins` setting.
- **Writes** `~/.claude/settings.json` (or the one under `CLAUDE_CONFIG_DIR`) only when you press **Run first**, adding its own id to `prependPlugins` and keeping everything else. Settings it can't parse are left alone, and the pane says what to add.
- **Stores** the arrangement (hidden mods, order, mute) in its own store.
- **Environment variables**, by name: `CLAUDE_CONFIG_DIR`, `OS`, `USERPROFILE`, `HOME`, to find your settings file.
- **Hooks:** `session.start`, `command.run` (`/mod-switch`, and `/reload-plugins` to clear the reminders after it runs), and `ui.render` (the band and the pane).

## License

Apache-2.0. See [LICENSE](LICENSE).
