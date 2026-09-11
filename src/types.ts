// A "movement" is one `## N. Title` section. A single synced Markdown file
// can hold an entire large work (e.g. a whole passion or requiem) split into
// many movements, or a whole concert program — spec.md's numbering scheme
// exists precisely so the footer can show which one is currently playing.
export interface Movement {
  number: string
  title: string
}

// One on-screen line, already word-wrapped to fit BODY_INNER.width. Carries
// the page/practice numbers in effect at that point in the source Markdown
// (spec.md: these persist line-to-line until the next `<N>`/`[X]` marker) so
// the footer can compute the visible window's number range.
export interface PhysicalLine {
  text: string
  pageNumber: number
  practiceNumber: string
  /** Index into Song.movements, or -1 for content before any heading. */
  movementIndex: number
  /**
   * Monotonic count of `### ` headings seen so far (0 before the first one),
   * for UP/DOWN navigation by "heading3" — unlike movementIndex, `###` lines
   * stay visible in the body (there's no footer slot for a sub-heading
   * title), this is purely a boundary counter alongside them.
   */
  sectionIndex: number
}

// A display unit: lines separated by a blank line (or a movement heading) in
// the source, shown together per spec.md's "固まり" concept. Never crosses a
// movement boundary, so movementIndex is constant within a block.
export interface Block {
  lines: PhysicalLine[]
}

export interface Song {
  id: string
  title: string
  sourceUrl: string
  rawMarkdown: string
  movements: Movement[]
  blocks: Block[]
  fetchedAt: number | null
  syncError: string | null
  /** Where to resume this song's performance next time it's opened. */
  lastPosition: { blockIndex: number; lineOffset: number }
}

export type UpDownMode = 'practice' | 'page' | 'heading2' | 'heading3' | 'window'

export interface Settings {
  /** Glasses text brightness, 0-4 (firmware range; see MAX_TEXT_BRIGHTNESS). */
  brightness: number
  showPracticeNumber: boolean
  showPageNumber: boolean
  showTitle: boolean
  /**
   * Default UP/DOWN unit for a new performance. The performer can change it
   * mid-performance via the glasses-side double-tap picker (performer.ts);
   * that in-session choice doesn't write back here.
   */
  upDownMode: UpDownMode
}
