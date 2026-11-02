// What Mod Switch keeps in the session's state, and the shapes it shares.

// How a mod drew in the band last time: its own piece (own), nothing (none),
// the whole band, so nothing beneath it ran (alone), or something it cannot
// be told apart from (whole).
export type BandKind = 'own' | 'none' | 'alone' | 'whole'

// A mod that draws in the band, as the band last saw it.
export type BandRow = { plugin: string; tier: string; kind: BandKind }

// An installed mod, as `claude plugin list --json` reports it.
export type ModRow = { id: string; name: string; enabled: boolean; scope: string }

// The band's arrangement, shared by every session through the store.
export type Prefs = { hidden: string[]; order: string[]; muted: boolean }

// Whether this mod runs first (named in prependPlugins), and its own id.
export type Setup = { isFirst: boolean | null; id: string | null }

declare module 'claude-code' {
  interface PluginState {
    'mod-switch': {
      bands: BandRow[]
      // Null until the list has been read once.
      mods: ModRow[] | null
      // Mods switched since the last /reload-plugins, by id.
      pending: string[]
      prefs: Prefs
      setup: Setup
      // A line under the pane: what the last action did, or why it failed.
      note: string
    }
  }
}
