import { getAdvW } from '@evenrealities/pretext'
import { BODY_INNER } from './layout'
import type { Block, Movement, PhysicalLine } from './types'

// Turns a Markdown lyric sheet into a movement list + a sequence of display
// blocks, per spec.md:
//
// - `## N. Title` starts a new movement. A single synced file can hold an
//   entire large work (e.g. a whole passion or requiem) split into many
//   movements, or a whole concert program — the footer shows whichever one
//   the performer is currently in.
// - `<N>` at the start of a line sets the page number in effect from that
//   line on (default 0 until the first marker); `[X]` does the same for the
//   practice/rehearsal number (default "0"). Either can appear in either
//   order, and persist until the next marker.
// - A "block" (spec.md's 固まり) is the span between blank lines, and never
//   crosses a movement boundary. The performer slides a fixed-height window
//   over a block's wrapped lines; blocks are never merged (unlike a generic
//   text reader that packs paragraphs onto a page to minimize page turns —
//   here one tap must line up with the song's structure).

const HEADING_RE = /^##(?!#)\s+(?:(\S+)\.\s+)?(.+)$/
const PAGE_MARKER_RE = /^<(\d+)>/
const PRACTICE_MARKER_RE = /^\[([^\]]+)\]/

interface RawContentLine {
  text: string
  pageNumber: number
  practiceNumber: string
  movementIndex: number
}

export function parseSong(source: string): { movements: Movement[]; blocks: Block[] } {
  const lines = source.replace(/\r\n/g, '\n').split('\n')

  const movements: Movement[] = []
  const rawBlocks: RawContentLine[][] = []
  let currentBlock: RawContentLine[] = []
  let movementIndex = -1
  let pageNumber = 0
  let practiceNumber = '0'

  const flush = () => {
    if (currentBlock.length > 0) rawBlocks.push(currentBlock)
    currentBlock = []
  }

  for (const line of lines) {
    if (!line.trim()) {
      flush()
      continue
    }

    const heading = HEADING_RE.exec(line)
    if (heading) {
      flush()
      movements.push({ number: heading[1] ?? '', title: heading[2].trim() })
      movementIndex = movements.length - 1
      continue
    }

    let rest = line
    let strippedMarker = true
    while (strippedMarker) {
      strippedMarker = false
      const pageMatch = PAGE_MARKER_RE.exec(rest)
      if (pageMatch) {
        pageNumber = Number(pageMatch[1])
        rest = rest.slice(pageMatch[0].length)
        strippedMarker = true
        continue
      }
      const practiceMatch = PRACTICE_MARKER_RE.exec(rest)
      if (practiceMatch) {
        practiceNumber = practiceMatch[1]
        rest = rest.slice(practiceMatch[0].length)
        strippedMarker = true
      }
    }

    const text = stripLine(rest)
    if (!text) continue // a marker-only line just updates state, prints nothing

    currentBlock.push({ text, pageNumber, practiceNumber, movementIndex })
  }
  flush()

  const blocks: Block[] = rawBlocks.map(rawLines => ({
    lines: rawLines.flatMap((rawLine): PhysicalLine[] =>
      wrapLine(rawLine.text, BODY_INNER.width).map(text => ({
        text,
        pageNumber: rawLine.pageNumber,
        practiceNumber: rawLine.practiceNumber,
        movementIndex: rawLine.movementIndex,
      })),
    ),
  }))

  return { movements, blocks: blocks.filter(b => b.lines.length > 0) }
}

// Strips Markdown syntax the glasses font can't render (no bold/italic/
// headings). `##` headings are consumed structurally above and never reach
// here; this still handles stray `#`/`###`+ lines the same as before.
function stripLine(line: string): string {
  return line
    .replace(/^#{1,6}\s+/, '')
    .replace(/^[-*+]\s+/, '')
    .replace(/^\d+\.\s+/, '')
    .replace(/^>\s?/, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trimEnd()
}

// Word-wraps one source line into 1+ physical (on-screen) lines. Ports the
// exact line-breaking rules LVGL/pretext's measureTextWrap uses on-device
// (space/hyphen word boundaries, CJK breakable at any codepoint) — but
// measureTextWrap only reports line *widths*, not the substrings, so the
// actual splitting has to be redone here using the same glyph metrics
// (`getAdvW`, no kerning — pretext doesn't export its kerning table, a minor
// accepted approximation) to get real line strings.
function wrapLine(text: string, maxWidth: number): string[] {
  if (!text) return []
  const cps = Array.from(text)
  const codePoints = cps.map(c => c.codePointAt(0)!)
  const out: string[] = []

  let lineStart = 0
  let width = 0
  let lastBreakIdx = -1
  let i = 0

  const push = (endExclusive: number) => {
    out.push(cps.slice(lineStart, endExclusive).join(''))
  }

  while (i < codePoints.length) {
    const cp = codePoints[i]

    if (width === 0 && cp === 32) {
      // Skip leading spaces at the start of any line (LVGL does this too).
      i++
      lineStart = i
      continue
    }

    const adv = advancePx(cp)
    if (width + adv > maxWidth) {
      if (cp === 32) {
        push(i) // space itself overflows — wrap here, discard the space
        i++
        lineStart = i
        width = 0
        lastBreakIdx = -1
      } else if (lastBreakIdx !== -1) {
        const breakCp = codePoints[lastBreakIdx]
        push(breakCp === 32 ? lastBreakIdx : lastBreakIdx + 1)
        i = lastBreakIdx + 1
        lineStart = i
        width = 0
        lastBreakIdx = -1
      } else {
        push(i) // hard break — no breakable point on this line at all
        lineStart = i
        width = adv
        lastBreakIdx = -1
        i++
      }
    } else {
      width += adv
      if (isBreakable(cp)) lastBreakIdx = i
      i++
    }
  }
  push(codePoints.length)
  return out
}

function advancePx(cp: number): number {
  const raw = getAdvW(cp)
  if (raw === 0 && cp >= 32) return 4 // firmware placeholder for unmapped glyphs
  return (raw + 8) >> 4
}

function isBreakable(cp: number): boolean {
  if (cp === 32) return true // space
  if (cp === 45) return true // hyphen
  return isCJK(cp)
}

// Mirrors pretext's internal CJK ranges (Han, Hiragana, Katakana, Bopomofo,
// Hangul Compatibility Jamo, Hangul Syllables, CJK compatibility ideographs).
function isCJK(cp: number): boolean {
  return (cp >= 0x2e80 && cp <= 0x9fff) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xac00 && cp <= 0xd7af)
}
