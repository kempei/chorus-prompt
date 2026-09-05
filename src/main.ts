import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk'
import type { Song } from './types'
import { loadSongs, saveSongs, newSong, upsertSong, removeSong } from './library'
import { loadSettings, saveSettings } from './settings'
import { syncSong } from './sync'
import { startPerformance, type PerformanceHandle } from './performer'
import { renderLibrary, renderPerforming } from './ui'

const bridge = await waitForEvenAppBridge()
const root = document.querySelector<HTMLDivElement>('#app')!

let songs = loadSongs()
let settings = loadSettings()
const syncingIds = new Set<string>()
// `handle` is null until startPerformance's bridge call resolves. Kept here
// (not just inside the promise closure) so the phone-screen "back to
// library" button can call it directly — it's the only way to stop a
// performance now that the ring's double-click is spec'd for a 10-step jump
// instead of exiting, and long-press has no ring gesture assigned to it.
let view: { kind: 'library' } | { kind: 'performing'; song: Song; handle: PerformanceHandle | null } = { kind: 'library' }

function render() {
  if (view.kind === 'performing') {
    renderPerforming(root, view.song, () => view.kind === 'performing' && view.handle?.stop())
    return
  }
  renderLibrary(root, songs, syncingIds, settings, {
    onAdd: (title, url) => {
      const song = newSong(title, url)
      songs = upsertSong(songs, song)
      saveSongs(songs)
      render()
      void doSync(song.id)
    },
    onSync: id => void doSync(id),
    onDelete: id => {
      songs = removeSong(songs, id)
      saveSongs(songs)
      render()
    },
    onPerform: id => {
      const song = songs.find(s => s.id === id)
      if (!song || song.blocks.length === 0) return
      view = { kind: 'performing', song, handle: null }
      render()
      startPerformance(bridge, song, settings, lastPosition => {
        songs = upsertSong(songs, { ...song, lastPosition })
        saveSongs(songs)
        view = { kind: 'library' }
        render()
      })
        .then(handle => {
          if (view.kind === 'performing' && view.song === song) view = { ...view, handle }
        })
        .catch(err => {
          console.error('Failed to start performance:', err)
          view = { kind: 'library' }
          render()
        })
    },
    onSettingsChange: next => {
      settings = next
      saveSettings(settings)
      render()
    },
  })
}

async function doSync(id: string) {
  const song = songs.find(s => s.id === id)
  if (!song) return
  syncingIds.add(id)
  render()
  const synced = await syncSong(song)
  syncingIds.delete(id)
  songs = upsertSong(songs, synced)
  saveSongs(songs)
  render()
}

render()
