import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderElement, RenderNode } from 'claude-code'

import { arrange, listed, piecesOf } from '../hooks/pieces'
import type { Link } from '../hooks/pieces'

// The test environment's timer, to let a press's background work finish.
declare const setTimeout: (fn: () => void, ms: number) => unknown
const settle = () => new Promise<void>(resolve => setTimeout(() => resolve(), 50))

const NOW = Date.parse('2026-11-02T12:00:00.000Z')

const BAND = {
  plugin: 'mod-switch',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120, scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

const PANE = {
  plugin: 'mod-switch',
  component: 'Pane',
  requestId: 'mod-switch',
  props: { title: 'Mod Switch', isFocused: false, bodyColumns: 52, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const SETTINGS = 'C:\\Users\\test\\.claude\\settings.json'

// Claude Code's list of installed plugins: two mods, a plugin with no hooks
// module, and this one.
const PLUGINS = [
  { id: 'mod-switch@local', scope: 'user', enabled: true, readFromFolder: 'C:\\mods\\mod-switch' },
  { id: 'token-watch@local', scope: 'user', enabled: true, readFromFolder: 'C:\\mods\\token-watch' },
  { id: 'blast-radius@market', scope: 'project', enabled: false, installPath: 'C:\\cache\\blast-radius\\1.0.0' },
  { id: 'rust-skills@local', scope: 'user', enabled: true, readFromFolder: 'C:\\mods\\rust-skills' },
]
const HOOKS_FILES: Record<string, string> = {
  'C:\\mods\\mod-switch\\hooks\\hooks.json': '{ "modules": ["./register.tsx"] }',
  'C:\\mods\\token-watch\\hooks\\hooks.json': '{ "modules": ["./register.tsx"] }',
  'C:\\cache\\blast-radius\\1.0.0\\hooks\\hooks.json': '{"modules":["./blast-radius.mjs"]}',
}

type Boot = {
  stored?: Record<string, unknown>
  prepend?: string[]
  cliFails?: string
  settingsText?: string
  // Text a mod beneath this one draws in the band.
  beneath?: string
}

// The engine beneath the mod, answered from memory: the store, files, the
// claude CLI (`runs` collects each argv), settings and panes.
async function boot($: Engine, on: On, options: Boot = {}) {
  const saved = new Map<string, unknown>(Object.entries(options.stored ?? {}))
  const files = new Map<string, string>(Object.entries(HOOKS_FILES))
  if (options.settingsText !== undefined) files.set(SETTINGS, options.settingsText)
  const runs: string[][] = []
  const plugins = PLUGINS.map(p => ({ ...p }))
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { OS: 'Windows_NT', USERPROFILE: 'C:\\Users\\test' })
  on('store.get', ($, e) => ({ value: saved.get(e.key) }))
  on('store.set', ($, e) => {
    saved.set(e.key, e.value)
    return { value: undefined }
  })
  on('settings.read', () => ({ value: { prependPlugins: options.prepend ?? [] } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('command.run', () => ({ text: 'Reloaded.' }))
  on('ui.render', ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    return options.beneath ? <Text>{options.beneath}</Text> : <Box />
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('fs.exists', ($, e) => ({ value: files.has(e.path) }))
  on('fs.read', ($, e) => (files.has(e.path) ? { value: files.get(e.path)! } : { deny: 'ENOENT' }))
  on('fs.write', ($, e) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('process.run', ($, e) => {
    runs.push([...e.argv])
    const done = (stdout: string, exitCode = 0, stderr = '') => ({
      value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false },
    })
    if (options.cliFails) return done('', 1, options.cliFails)
    const [, verb, sub, id] = e.argv
    if (verb === 'plugin' && sub === '--json') return done('')
    if (verb === 'plugin' && sub === 'list') return done(JSON.stringify(plugins))
    if (verb === 'plugin' && (sub === 'disable' || sub === 'enable')) {
      const p = plugins.find(x => x.id === id)
      if (p) p.enabled = sub === 'enable'
      return done(`Successfully ${sub}d plugin`)
    }
    return done('', 1, 'unknown')
  })
  await $.session.start({ cwd: '.', surface: 'desktop', isInteractive: false })
  return { saved, files, runs, clock }
}

// A slash command as the person types it.
const run = ($: Engine, command: string, args = '') =>
  $.command.run({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })

// Every string a tree holds, in order.
function textOf(node: RenderNode | null | undefined): string {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string') return node
  const el = node as { type: string; props: { label?: string }; children?: RenderNode[] }
  if (el.type === 'Button' && el.props.label !== undefined) return el.props.label
  return (el.children ?? []).map(textOf).join(' ')
}

async function openPane($: Engine) {
  await run($, 'mod-switch')
  // The list is read in the background once the pane opens.
  await settle()
  return $.ui.mount({ ...PANE, surface: 'desktop' })
}

describe('band pieces', () => {
  const engine = { type: 'Box', props: {}, children: ['engine'] }
  const spike = { type: 'Box', props: { flexDirection: 'column' }, children: [{ type: 'Text', props: {}, children: ['spike'] }, engine] }
  const watch = { type: 'Box', props: { flexDirection: 'column' }, children: [{ type: 'Client', props: { module: './band.tsx' }, client: { plugin: 'token-watch' } }, spike] }
  const link = (plugin: string, returned: unknown, outcome = 'returned', tier = 'user'): Link => ({ plugin, tier, outcome, returned })
  // Replay Theater passes what it got; a hook in a worker answers with a copy.
  const trace = [link('replay-theater', structuredClone(watch)), link('token-watch', watch), link('spike-target', spike), link('engine', engine, 'returned', 'core')]

  test('each mod that stacks is cut out of what it drew beneath', () => {
    const pieces = piecesOf(trace)
    expect(pieces.map(p => `${p.plugin}:${p.kind}`)).toEqual(['replay-theater:none', 'token-watch:own', 'spike-target:own', 'engine:alone'])
    expect(textOf(pieces[2]!.own as RenderNode)).toBe('spike')
    // A Client keeps the stamp naming its plugin.
    expect(JSON.stringify(pieces[1]!.own)).toContain('"client":{"plugin":"token-watch"}')
  })

  test('nothing hidden or reordered leaves the chain\u2019s drawing as it is', () => {
    expect(arrange(piecesOf(trace), { hidden: [], order: [], muted: false })).toBeNull()
  })

  test('a hidden mod is left out; the engine\u2019s part stays last', () => {
    const nodes = arrange(piecesOf(trace), { hidden: ['spike-target'], order: [], muted: false })!
    expect(nodes.map(n => textOf(n as RenderNode))).toEqual(['', 'engine'])
    expect(JSON.stringify(nodes[0])).toContain('token-watch')
  })

  test('the order asked for comes first, the rest after as the chain drew them', () => {
    const nodes = arrange(piecesOf(trace), { hidden: [], order: ['spike-target'], muted: false })!
    expect(nodes.map(n => textOf(n as RenderNode))).toEqual(['spike', '', 'engine'])
  })

  test('a mod that changes what it drew beneath leaves the chain\u2019s drawing standing', () => {
    const changed = { type: 'Box', props: {}, children: [{ type: 'Text', props: {}, children: ['spike, but bold'] }] }
    const pieces = piecesOf([link('rewriter', changed), link('spike-target', spike), link('engine', engine, 'returned', 'core')])
    expect(pieces[0]!.kind).toBe('whole')
    expect(arrange(pieces, { hidden: ['spike-target'], order: [], muted: false })).toBeNull()
  })

  test('a mod that draws without calling next takes the band; nothing beneath it ran', () => {
    const hold = { type: 'Text', props: {}, children: ['Hold'] }
    const above = { type: 'Box', props: { flexDirection: 'column' }, children: [{ type: 'Text', props: {}, children: ['watch'] }, hold] }
    const pieces = piecesOf([link('token-watch', above), link('blast-radius', hold)])
    expect(pieces.map(p => p.kind)).toEqual(['own', 'alone'])
    expect(listed(pieces).map(r => r.plugin)).toEqual(['token-watch', 'blast-radius'])
  })

  test('muted, every installed mod is left out; built-in mods and the engine stay', () => {
    const builtin = { type: 'Box', props: { flexDirection: 'column' }, children: [{ type: 'Text', props: {}, children: ['tip'] }, engine] }
    const above = { type: 'Box', props: { flexDirection: 'column' }, children: [{ type: 'Text', props: {}, children: ['spike'] }, builtin] }
    const pieces = piecesOf([link('spike-target', above), link('you-should-know', builtin, 'returned', 'builtin'), link('engine', engine, 'returned', 'core')])
    const nodes = arrange(pieces, { hidden: [], order: [], muted: true })!
    expect(nodes.map(n => textOf(n as RenderNode))).toEqual(['tip', 'engine'])
  })

  test('a link that was skipped or rejected is not a piece', () => {
    const pieces = piecesOf([link('broken', undefined, 'skipped'), link('spike-target', spike), link('engine', engine, 'returned', 'core')])
    expect(pieces.map(p => p.plugin)).toEqual(['spike-target', 'engine'])
  })
})

describe('the pane', () => {
  test('lists the installed mods, not plugins without a hooks module, nor itself', async ($, on) => {
    await boot($, on, { prepend: ['mod-switch@local'] })
    const ui = await openPane($)
    const text = textOf(await ui.drawn())
    expect(text).toContain('token-watch')
    expect(text).toContain('blast-radius')
    expect(text).not.toContain('rust-skills')
    expect(await ui.find({ key: 'mod-mod-switch@local' })).toBeUndefined()
    expect(text).not.toContain("doesn't run first")
    await ui.unmount()
  })

  test('switching a mod runs Claude Code\u2019s own switch in its scope and asks for a reload', async ($, on) => {
    const { runs } = await boot($, on, { prepend: ['mod-switch@local'] })
    const ui = await openPane($)
    await ui.press({ key: 'mod-blast-radius@market' })
    await settle()
    expect(runs).toContainEqual(['claude', 'plugin', 'enable', 'blast-radius@market', '--scope', 'project'])
    const text = textOf(await ui.drawn())
    expect(text).toContain('/reload-plugins to apply')
    expect(text).toContain('blast-radius enabled in every session')
    await ui.unmount()
  })

  test('a /reload-plugins typed afterwards clears the reminders', async ($, on) => {
    await boot($, on, { prepend: ['mod-switch@local'] })
    const ui = await openPane($)
    await ui.press({ key: 'mod-token-watch@local' })
    await settle()
    const marker = { type: 'Text', text: /^\/reload-plugins to apply$/ } as const
    expect(await ui.find(marker)).toBeDefined()
    await run($, 'reload-plugins')
    expect(await ui.find(marker)).toBeUndefined()
    await ui.unmount()
  })

  test('a failing claude command says so in the pane', async ($, on) => {
    await boot($, on, { cliFails: 'claude: command not found' })
    const ui = await openPane($)
    expect(textOf(await ui.drawn())).toContain('claude plugin list failed: claude: command not found')
    await ui.unmount()
  })

  test('hiding and ordering the band are saved for every session', async ($, on) => {
    // The band as a mod beneath this one drew it, so the pane has a row.
    const { saved, clock } = await boot($, on, { prepend: ['mod-switch@local'], beneath: 'a mod beneath' })
    const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
    // The rows are kept from a timer once the band has drawn.
    await clock.advance(1)
    const ui = await openPane($)
    const rows = await ui.findAll({ type: 'Button', text: /^\u2611 / })
    const row = rows.find(r => !/Mute/.test(r.text ?? ''))
    expect(row).toBeDefined()
    await ui.press({ key: row!.key! })
    expect((saved.get('prefs') as { hidden: string[] }).hidden.length).toBe(1)
    await band.unmount()
    await ui.unmount()
  })
})

describe('muting', () => {
  test('/mod-switch mute toggles it, saved for every session', async ($, on) => {
    const { saved } = await boot($, on)
    expect((await run($, 'mod-switch', 'mute')).text).toBe("Every mod's band is muted.")
    expect(saved.get('prefs')).toEqual({ hidden: [], order: [], muted: true })
    expect((await run($, 'mod-switch', 'mute')).text).toBe('The band is back.')
    expect(saved.get('prefs')).toEqual({ hidden: [], order: [], muted: false })
  })

  test('an arrangement another session saved is picked up within 30 seconds', async ($, on) => {
    const { saved, clock } = await boot($, on)
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect((await ui.find({ key: 'mute' }))?.text).toContain('\u2610')
    saved.set('prefs', { hidden: [], order: [], muted: true })
    await clock.advance(30_000)
    expect((await ui.find({ key: 'mute' }))?.text).toContain('\u2611')
    await ui.unmount()
  })

  test('a malformed arrangement in the store reads as none', async ($, on) => {
    await boot($, on, { stored: { prefs: { hidden: 'all', order: [3, 'x'], muted: 'yes' } } })
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect((await ui.find({ key: 'mute' }))?.text).toContain('\u25cb')
    await ui.unmount()
  })
})

describe('running first', () => {
  test('the pane says when Mod Switch is not first, and Run first adds it, keeping the other settings', async ($, on) => {
    const { files } = await boot($, on, { prepend: [], settingsText: '{\n  "theme": "dark",\n  "prependPlugins": ["org-guard@acme"]\n}\n' })
    const ui = await openPane($)
    expect(textOf(await ui.drawn())).toContain("doesn't run first")
    await ui.press({ key: 'run-first' })
    const settings = JSON.parse(files.get(SETTINGS)!) as Record<string, unknown>
    expect(settings).toEqual({ theme: 'dark', prependPlugins: ['mod-switch@local', 'org-guard@acme'] })
    expect(textOf(await ui.drawn())).not.toContain("doesn't run first")
    await ui.unmount()
  })

  test('settings it cannot parse are left alone, with what to add', async ($, on) => {
    const { files } = await boot($, on, { prepend: [], settingsText: '{ not json' })
    const ui = await openPane($)
    await ui.press({ key: 'run-first' })
    expect(files.get(SETTINGS)).toBe('{ not json')
    expect(textOf(await ui.drawn())).toContain('"prependPlugins": ["mod-switch@local"]')
    await ui.unmount()
  })
})

// The band hook with nothing hidden returns what it got from beneath, as is.
test('with nothing arranged the band is the chain\u2019s own drawing', async ($, on) => {
  await boot($, on, { beneath: 'beneath' })
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(textOf((await band.drawn()) as RenderElement)).toBe('beneath')
  await band.unmount()
})
