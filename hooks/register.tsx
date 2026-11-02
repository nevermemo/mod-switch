import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement, RenderNode } from 'claude-code'

import type { BandRow, ModRow, Prefs, Setup } from '../types'
import { arrange, listed, piecesOf } from './pieces'

// Mod Switch: which mods draw in the band above the prompt, in what order,
// and which mods load at all.
//
// The band: this mod runs first (named in prependPlugins), so its band hook is
// the outermost. It lets the mods beneath draw, reads what each drew from
// `next.trace`, and draws the band again from the pieces not hidden, in the
// order chosen, live. Muted, it leaves out every installed mod's piece. The
// arrangement is shared by every session through the store.
//
// The mods: Claude Code's own switch (`claude plugin disable` / `enable`),
// which applies in a session at its next /reload-plugins. The reload is the
// person's to type: one a mod runs counts as remote, and the desktop app
// refuses it.

const PANE = 'mod-switch'
const TITLE = 'Mod Switch'
const PANE_COLUMNS = 52
const SELF = 'mod-switch'
// How often the arrangement another session saved is picked up.
const POLL_MS = 30_000
const CLI_TIMEOUT_MS = 30_000
const NO_PREFS: Prefs = { hidden: [], order: [], muted: false }

const bands = atom({ plugin: 'mod-switch', key: 'bands' } as const, [])
const mods = atom({ plugin: 'mod-switch', key: 'mods' } as const, null)
const pending = atom({ plugin: 'mod-switch', key: 'pending' } as const, [])
const prefs = atom({ plugin: 'mod-switch', key: 'prefs' } as const, NO_PREFS)
const setup = atom({ plugin: 'mod-switch', key: 'setup' } as const, { isFirst: null, id: null })
const note = atom({ plugin: 'mod-switch', key: 'note' } as const, '')

// The band rows last written, so a redraw that changes nothing writes nothing.
let lastBands = ''

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({
      name: 'mod-switch',
      description: 'Open Mod Switch: show, hide and order the mods in the band above the prompt, and switch mods on or off. "mute" hides every mod\'s band.',
      argumentHint: '[mute]',
    })
    await update($, prefs, () => NO_PREFS)
    await pickUpPrefs($)
    $.clock.every(POLL_MS, () => void pickUpPrefs($).catch(() => {}))
    return result
  })

  on('command.run', { command: 'mod-switch' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'mute') {
      const muted = !(await read($, prefs)).muted
      await savePrefs($, p => ({ ...p, muted }))
      return { text: muted ? 'Every mod\'s band is muted.' : 'The band is back.' }
    }
    if (arg !== '') return { text: 'Usage: /mod-switch [mute]' }
    const opened = await $.ui.open({ id: PANE, title: TITLE, columns: PANE_COLUMNS })
    if (!opened.isPlaced) {
      // Not placed: close it rather than leave it waiting, undrawn, for a
      // surface that would show it later unasked.
      await $.ui.close({ id: PANE }).catch(() => {})
      return { text: `${TITLE} can't be shown here (${opened.reason}).` }
    }
    void readMods($)
    return { text: `${TITLE} opened.` }
  })

  // A /reload-plugins the person typed applies every switch made before it.
  on('command.run', { command: 'reload-plugins' }, async ($, e, next) => {
    const result = await next(e)
    await update($, pending, () => [])
    return result
  })

  // Muting draws the band from the built-in mods' and the engine's pieces
  // alone rather than continuing beneath the installed tier with `next.to`: a
  // module that uses `next.to` loads only for a managed (prepended) plugin,
  // and this one must load to say when it is not first.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const shown = await read($, prefs)
    const whole = await next(e)
    const pieces = piecesOf(next.trace)
    // A render hook may not write state while it draws: the rows are kept
    // from a timer, an event of its own, once this drawing is done.
    const rows = listed(pieces)
    $.clock.after(0, () => void noteBands($, rows).catch(() => {}))
    const nodes = arrange(pieces, shown)
    if (nodes === null) return whole
    const { Box } = $.ui.resolve(e)
    return h(Box, { flexDirection: 'column' }, ...(nodes as RenderNode[])) as RenderElement
  })

  // The pane: the band's mods (shown or hidden, and their order), every
  // installed mod's switch, and whether this mod runs first. A checkbox is
  // its mark and its label in one Button: ☑ / ☐ on the desktop, ● / ○ in a
  // terminal (☑ may draw there as a wide emoji); the rest are bracketed.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const isTerminal = e.surface === 'terminal'
    const mark = (isOn: boolean) => (isTerminal ? (isOn ? '●' : '○') : isOn ? '☑' : '☐')
    const checkbox = (key: string, label: string, isOn: boolean, onPress: () => void) => (
      <Box key={key} flexShrink={1} minWidth={0}>
        <Button key={key} plain onPress={onPress}>
          {`${mark(isOn)} ${label}`}
        </Button>
      </Box>
    )
    const action = (key: string, label: string, onPress: () => void, isDim = false) => (
      <Box key={key} flexShrink={0}>
        <Button key={key} plain dimColor={isDim || undefined} onPress={onPress}>
          {`[${label}]`}
        </Button>
      </Box>
    )
    const heading = (text: string) => <Text bold>{text}</Text>
    const shown = await read($, prefs)
    const rows = ordered(await read($, bands), shown.order)
    const list = await read($, mods)
    const toApply = await read($, pending)
    const first = await read($, setup)
    const said = await read($, note)

    const kindNote = (row: BandRow) =>
      row.kind === 'alone'
        ? 'takes the whole band'
        : row.kind === 'whole'
          ? 'drawn as it is'
          : row.kind === 'none'
            ? 'nothing now'
            : ''

    return (
      <Box flexDirection="column" rowGap={1}>
        <Box flexDirection="column">
          {heading('Band')}
          {checkbox('mute', "Mute every mod's band", shown.muted, () => void savePrefs($, p => ({ ...p, muted: !p.muted })))}
          {rows.length === 0 ? (
            <Text dimColor wrap="wrap">
              No mod has drawn in the band yet.
            </Text>
          ) : (
            rows.map((row, i) => (
              <Box key={`band-${row.plugin}`} flexDirection="row" columnGap={1}>
                {action(`up-${row.plugin}`, '↑', () => void move($, rows, i, -1), i === 0)}
                {action(`down-${row.plugin}`, '↓', () => void move($, rows, i, 1), i === rows.length - 1)}
                {checkbox(`show-${row.plugin}`, row.plugin, !shown.hidden.includes(row.plugin), () => void toggleHidden($, row.plugin))}
                {kindNote(row) !== '' && (
                  <Text dimColor wrap="truncate">
                    {kindNote(row)}
                  </Text>
                )}
              </Box>
            ))
          )}
          {shown.order.length > 0 && action('reset-order', 'Reset order', () => void savePrefs($, p => ({ ...p, order: [] })))}
        </Box>
        <Box flexDirection="column">
          <Box flexDirection="row" columnGap={1}>
            {heading('Mods')}
            {action('refresh', '↻', () => void readMods($))}
          </Box>
          {list === null ? (
            <Text dimColor>Reading the installed mods…</Text>
          ) : list.length === 0 ? (
            <Text dimColor>No other mods are installed.</Text>
          ) : (
            list.map(mod => (
              <Box key={`mod-${mod.id}`} flexDirection="row" columnGap={1}>
                {checkbox(`mod-${mod.id}`, mod.name, mod.enabled, () => void switchMod($, mod))}
                {toApply.includes(mod.id) && (
                  <Text color="yellow" wrap="truncate">
                    /reload-plugins to apply
                  </Text>
                )}
              </Box>
            ))
          )}
        </Box>
        {first.isFirst === false && (
          <Box flexDirection="column">
            <Text color="yellow" wrap="wrap">
              Mod Switch doesn't run first, so it can only arrange and mute the mods that load after it.
            </Text>
            {first.id !== null && action('run-first', 'Run first', () => void runFirst($))}
          </Box>
        )}
        {said !== '' && (
          <Text dimColor wrap="wrap">
            {said}
          </Text>
        )}
      </Box>
    )
  })
}

// The band rows in the order the band draws them: the ones `order` names
// first, in its order, then the rest as the chain drew them.
function ordered(rows: readonly BandRow[], order: readonly string[]) {
  const rank = (row: BandRow) => (order.includes(row.plugin) ? order.indexOf(row.plugin) : order.length)
  return [...rows].sort((a, b) => rank(a) - rank(b))
}

// What the band drew, kept for the pane: this drawing's mods first, then
// those seen before that did not run now (beneath a mod that took the band),
// as drawing nothing.
async function noteBands($: EngineInterface, now: BandRow[]) {
  const before = await read($, bands)
  const names = new Set(now.map(row => row.plugin))
  const rows = [...now, ...before.filter(row => !names.has(row.plugin)).map(row => ({ ...row, kind: 'none' as const }))]
  const key = JSON.stringify(rows)
  if (key === lastBands) return
  lastBands = key
  await update($, bands, () => rows)
}

async function move($: EngineInterface, rows: readonly BandRow[], i: number, step: number) {
  const j = i + step
  if (j < 0 || j >= rows.length) return
  const names = rows.map(row => row.plugin)
  ;[names[i], names[j]] = [names[j]!, names[i]!]
  await savePrefs($, p => ({ ...p, order: names }))
}

async function toggleHidden($: EngineInterface, plugin: string) {
  await savePrefs($, p => ({ ...p, hidden: p.hidden.includes(plugin) ? p.hidden.filter(n => n !== plugin) : [...p.hidden, plugin] }))
}

// The arrangement as the store keeps it, read again; anything malformed reads
// as nothing hidden, no order and not muted.
function prefsIn(value: unknown): Prefs {
  if (typeof value !== 'object' || value === null) return NO_PREFS
  const v = value as Record<string, unknown>
  const names = (x: unknown) => (Array.isArray(x) ? x.filter((n): n is string => typeof n === 'string') : [])
  return { hidden: names(v.hidden), order: names(v.order), muted: v.muted === true }
}

async function pickUpPrefs($: EngineInterface) {
  const stored = prefsIn(await $.store.get('prefs'))
  const now = await read($, prefs)
  if (JSON.stringify(stored) !== JSON.stringify(now)) await update($, prefs, () => stored)
}

async function savePrefs($: EngineInterface, change: (p: Prefs) => Prefs) {
  const next = change(await read($, prefs))
  await $.store.set('prefs', next)
  await update($, prefs, () => next)
}

// The installed mods, from Claude Code's own list: each plugin with a hooks
// module, this one left out. Also whether this mod runs first.
async function readMods($: EngineInterface) {
  const run = await cli($, ['plugin', 'list', '--json'])
  if (run === null) return
  let entries: unknown
  try {
    entries = JSON.parse(run)
  } catch {
    await update($, note, () => 'Could not read the list of installed mods.')
    return
  }
  if (!Array.isArray(entries)) return
  const rows: ModRow[] = []
  let ownId: string | null = null
  for (const entry of entries as Record<string, unknown>[]) {
    const id = typeof entry.id === 'string' ? entry.id : ''
    const name = id.split('@')[0] ?? ''
    if (name === '') continue
    if (name === SELF) {
      ownId = id
      continue
    }
    const folder = typeof entry.readFromFolder === 'string' ? entry.readFromFolder : typeof entry.installPath === 'string' ? entry.installPath : ''
    if (!(await hasHooksModule($, folder))) continue
    rows.push({ id, name, enabled: entry.enabled === true, scope: typeof entry.scope === 'string' ? entry.scope : 'user' })
  }
  await update($, mods, () => rows)
  const prepend = await $.settings.read({ key: 'prependPlugins' }).catch(() => undefined)
  const isFirst = Array.isArray(prepend) && prepend.some(id => typeof id === 'string' && id.split('@')[0] === SELF)
  await update($, setup, (): Setup => ({ isFirst, id: ownId }))
}

// Whether a plugin's folder holds a hooks module: hooks/hooks.json naming
// `modules`. A plugin without one is not a mod.
async function hasHooksModule($: EngineInterface, folder: string) {
  if (folder === '') return false
  const sep = folder.includes('\\') ? '\\' : '/'
  const path = [folder.replace(/[\\/]+$/, ''), 'hooks', 'hooks.json'].join(sep)
  try {
    if (!(await $.fs.exists(path))) return false
    return /"modules"\s*:/.test(String(await $.fs.read(path)))
  } catch {
    return false
  }
}

async function switchMod($: EngineInterface, mod: ModRow) {
  const verb = mod.enabled ? 'disable' : 'enable'
  const ran = await cli($, ['plugin', verb, mod.id, '--scope', mod.scope])
  if (ran === null) return
  await update($, pending, list => (list.includes(mod.id) ? list.filter(id => id !== mod.id) : [...list, mod.id]))
  await update($, note, () => `${mod.name} ${verb}d in every session. Type /reload-plugins to apply it here.`)
  await readMods($)
}

// `claude <args>`: its output, or null with the failure in the pane's note.
async function cli($: EngineInterface, args: string[]) {
  try {
    const run = await $.process.run(['claude', ...args], { timeoutMs: CLI_TIMEOUT_MS })
    if (run.exitCode === 0) return run.stdout
    const said = (run.stderr || run.stdout).trim().split('\n').pop() ?? ''
    await update($, note, () => `claude ${args.slice(0, 2).join(' ')} failed: ${said}`)
  } catch (err) {
    await update($, note, () => `Could not run claude: ${err instanceof Error ? err.message : String(err)}`)
  }
  return null
}

// Names this mod in prependPlugins in the person's own settings, so it runs
// before every installed mod; Claude Code reloads the sessions' mods when
// that list changes. Only on the pane's press.
async function runFirst($: EngineInterface) {
  const id = (await read($, setup)).id
  const path = await settingsPath($)
  if (id === null || path === null) return
  try {
    const text = (await $.fs.exists(path)) ? String(await $.fs.read(path)) : '{}'
    const settings = JSON.parse(text) as Record<string, unknown>
    const list = Array.isArray(settings.prependPlugins) ? settings.prependPlugins.filter(x => x !== id) : []
    settings.prependPlugins = [id, ...list]
    await $.fs.write(path, JSON.stringify(settings, null, 2) + '\n')
    await update($, note, () => `Added ${id} to prependPlugins in ${path}.`)
    await update($, setup, s => ({ ...s, isFirst: true }))
  } catch (err) {
    await update($, note, () => `Could not change ${path} (${err instanceof Error ? err.message : String(err)}). Add "prependPlugins": ["${id}"] there yourself.`)
  }
}

// ~/.claude/settings.json, or under CLAUDE_CONFIG_DIR when that is set. `~` is
// USERPROFILE on Windows and HOME elsewhere, as Node's os.homedir() chooses.
// Each variable named as written: the engine reads env names literally.
async function settingsPath($: EngineInterface) {
  const config = await $.env.get('CLAUDE_CONFIG_DIR')
  const isWindows = (await $.env.get('OS')) === 'Windows_NT'
  const profile = await $.env.get('USERPROFILE')
  const posixHome = await $.env.get('HOME')
  const home = isWindows ? profile || posixHome : posixHome || profile
  const dir = config || (home ? `${home.replace(/[\\/]+$/, '')}${home.includes('\\') ? '\\' : '/'}.claude` : '')
  if (dir === '') return null
  return `${dir.replace(/[\\/]+$/, '')}${dir.includes('\\') ? '\\' : '/'}settings.json`
}
