import type { Song } from './types'
import { parseSong } from './lyrics'

// Fetches the song's Markdown source and re-parses it. On any failure
// (offline, DNS, whitelist/CORS rejection, 404, ...) the previously cached
// blocks are left untouched — a failed sync while offline must never wipe
// out lyrics that already work for tonight's performance.
export async function syncSong(song: Song): Promise<Song> {
  try {
    const res = await fetch(song.sourceUrl, { cache: 'no-store' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const rawMarkdown = await res.text()
    const { movements, blocks } = parseSong(rawMarkdown)
    if (blocks.length === 0) throw new Error('No verses found in fetched Markdown')
    return {
      ...song,
      rawMarkdown,
      movements,
      blocks,
      fetchedAt: Date.now(),
      syncError: null,
      lastPosition: { blockIndex: 0, lineOffset: 0 },
    }
  } catch (err) {
    return {
      ...song,
      syncError: err instanceof Error ? err.message : String(err),
    }
  }
}
