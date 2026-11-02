// The band's pieces: what each mod beneath this one drew there, told apart
// from what it drew beneath. A ui.render hook's `next.trace` holds every
// link's drawing, nearest first, the engine's last. A mod that stacks draws
// its own line and puts what it got from `next` under it, so its own piece is
// its drawing with the next link's drawing taken out.

import type { BandKind, Prefs } from '../types'

// One link's share of the band. kind: `own` (its piece, cut cleanly), `none`
// (it passed what was beneath, or drew nothing), `alone` (it drew without
// calling `next`, so nothing beneath it ran), or `whole` (what was beneath is
// in its drawing but changed, so the two cannot be told apart).
export type Piece = { plugin: string; tier: string; kind: BandKind; own: unknown }

export type Link = { readonly plugin: string; readonly tier: string; readonly outcome: string; readonly returned: unknown }

// The engine's own link: always drawn, last, never listed.
export const ENGINE = 'engine'

const RAN = new Set(['returned', 'passed', 'kept', 'caught'])
// The tiers of the mods a person installs, as opposed to the built-in ones
// and the engine's own.
const INSTALLED = new Set(['user', 'prepend', 'append'])
const NOT_FOUND = Symbol('not found')
const REMOVED = Symbol('removed')

export function piecesOf(trace: readonly Link[]): Piece[] {
  const ran = trace.filter(link => RAN.has(link.outcome))
  return ran.map((link, i): Piece => {
    const base = { plugin: link.plugin, tier: link.tier }
    const below = ran[i + 1]
    if (link.outcome === 'passed' || isEmpty(link.returned)) return { ...base, kind: 'none', own: null }
    if (below === undefined) return { ...base, kind: 'alone', own: link.returned }
    if (isEmpty(below.returned)) return { ...base, kind: 'own', own: link.returned }
    const cut = without(link.returned, below.returned)
    if (cut === NOT_FOUND) return { ...base, kind: 'whole', own: link.returned }
    // Its whole drawing was what beneath drew: a hook in a worker that passed
    // answers with a copy, so the trace reads `returned`, not `passed`.
    if (cut === REMOVED) return { ...base, kind: 'none', own: null }
    return { ...base, kind: 'own', own: cut }
  })
}

// The band drawn again from the pieces: the mods not hidden, in the order
// asked for (the rest after, as the chain drew them), the engine's last.
// Muted, every installed mod's piece is left out, and the built-in mods' and
// the engine's stay. Null when the chain's own drawing should stand: nothing
// is hidden or reordered, or a piece could not be told from the rest, so
// nothing is lost or doubled.
export function arrange(pieces: readonly Piece[], prefs: Prefs): unknown[] | null {
  if (prefs.muted) return pieces.filter(p => !INSTALLED.has(p.tier) || p.plugin === ENGINE).map(p => p.own).filter(isNode)
  if (prefs.hidden.length === 0 && prefs.order.length === 0) return null
  if (pieces.some(p => p.kind === 'whole')) return null
  const rank = (p: Piece) => (prefs.order.includes(p.plugin) ? prefs.order.indexOf(p.plugin) : prefs.order.length)
  const mods = pieces.filter(p => p.plugin !== ENGINE && !prefs.hidden.includes(p.plugin)).sort((a, b) => rank(a) - rank(b))
  const engine = pieces.filter(p => p.plugin === ENGINE)
  return [...mods, ...engine].map(p => p.own).filter(isNode)
}

// The mods of the band as the pane lists them, in the order it draws them.
export function listed(pieces: readonly Piece[]) {
  return pieces.filter(p => p.plugin !== ENGINE).map(p => ({ plugin: p.plugin, tier: p.tier, kind: p.kind }))
}

function isEmpty(node: unknown) {
  return node === null || node === undefined || node === ''
}

function isNode(node: unknown) {
  return typeof node === 'string' ? node !== '' : typeof node === 'object' && node !== null
}

// `node` with its first subtree equal to `target` taken out: REMOVED when
// that is `node` itself, NOT_FOUND when there is none. Trees are plain data,
// copied between environments, so equal means equal as JSON.
function without(node: unknown, target: unknown): unknown {
  const key = JSON.stringify(target)
  let isFound = false
  const walk = (n: unknown): unknown => {
    if (isFound) return n
    if (JSON.stringify(n) === key) {
      isFound = true
      return REMOVED
    }
    if (typeof n !== 'object' || n === null) return n
    const el = n as { children?: unknown }
    if (!Array.isArray(el.children)) return n
    return { ...el, children: el.children.map(walk).filter(c => c !== REMOVED) }
  }
  const result = walk(node)
  return isFound ? result : NOT_FOUND
}
