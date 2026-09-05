import type { Song } from './types'

// localStorage is the only storage the docs confirm always survives
// backgrounding (IndexedDB/OPFS quotas are explicitly "best-effort"), and a
// choir's whole repertoire in plain text is a few hundred KB at most — well
// inside typical WKWebView localStorage quotas.
const STORAGE_KEY = 'chorus-prompter:songs'

export function loadSongs(): Song[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isSongShape) : []
  } catch (err) {
    console.error('Failed to load song library from localStorage', err)
    return []
  }
}

// Drops entries saved by an older, incompatible schema (localStorage is a
// system boundary — data written by a previous version of this app). A song
// dropped this way just needs to be re-synced from its URL.
function isSongShape(value: unknown): value is Song {
  if (!value || typeof value !== 'object') return false
  const s = value as Partial<Song>
  return (
    Array.isArray(s.movements) &&
    Array.isArray(s.blocks) &&
    s.blocks.every(b => Array.isArray(b?.lines)) &&
    typeof s.lastPosition === 'object' &&
    s.lastPosition !== null &&
    typeof s.lastPosition.blockIndex === 'number' &&
    typeof s.lastPosition.lineOffset === 'number'
  )
}

export function saveSongs(songs: Song[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(songs))
}

// crypto.randomUUID() requires a secure context (HTTPS or localhost). The
// documented dev workflow sideloads from a plain http://<lan-ip>:5173 URL for
// QR scanning, which isn't one — so this uses getRandomValues() instead,
// which has no such restriction, to keep local device testing working.
function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

export function newSong(title: string, sourceUrl: string): Song {
  return {
    id: randomId(),
    title,
    sourceUrl,
    rawMarkdown: '',
    movements: [],
    blocks: [],
    fetchedAt: null,
    syncError: null,
    lastPosition: { blockIndex: 0, lineOffset: 0 },
  }
}

export function upsertSong(songs: Song[], song: Song): Song[] {
  const idx = songs.findIndex(s => s.id === song.id)
  if (idx === -1) return [...songs, song]
  const next = songs.slice()
  next[idx] = song
  return next
}

export function removeSong(songs: Song[], id: string): Song[] {
  return songs.filter(s => s.id !== id)
}
