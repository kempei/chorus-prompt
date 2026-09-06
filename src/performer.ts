import {
  TextContainerProperty,
  TextContainerUpgrade,
  CreateStartUpPageContainer,
  OsEventTypeList,
  MIN_TEXT_BRIGHTNESS,
  type EvenAppBridge,
  type EvenHubEvent,
} from '@evenrealities/even_hub_sdk'
import { getAdvW, getTextWidth } from '@evenrealities/pretext'
import type { PhysicalLine, Settings, Song, UpDownMode } from './types'
import {
  BODY_W,
  BODY_H,
  BODY_PAD,
  BODY_BORDER,
  FOOTER_Y,
  FOOTER_H,
  FOOTER_PAD,
  FOOTER_INNER_WIDTH,
  MAX_BODY_LINES,
} from './layout'

// Drives the glasses display for one (possibly movement-spanning) song per
// this project's ring mapping:
//   CLICK        -> next data (next window of the current block, or next
//                   block once the current one is fully shown)
//   UP/DOWN      -> jump to the previous/next boundary of the current
//                   UP/DOWN unit (practice number / page number / heading2 /
//                   heading3 — see UP_DOWN_MODES below)
//   DOUBLE_CLICK -> open an on-glasses picker to change that unit for the
//                   rest of this performance
//
// The phone's Settings.upDownMode (src/settings.ts, src/ui.ts) only supplies
// the *starting* unit for a new performance; the double-tap picker below is
// the only way to change it afterwards, and that choice is session-local
// (never written back to Settings) per user decision.
//
// There is deliberately no glasses-side exit gesture: the phone's "back to
// library" button (src/ui.ts) is the sole, official way to stop a
// performance, since double-click is now spoken for and long-press is
// presumed to be intercepted by the system menu on real hardware rather than
// reaching the app (per user decision — never verified in the simulator,
// which doesn't emulate that firmware behavior either).
//
// The picker is a plain hand-rolled list rendered into the existing body/
// footer TextContainers (cursor drawn as "> "), not the SDK's
// ListContainerProperty/MenuContainerProperty. Those exist (SDK 0.0.14) and
// would auto-manage selection, but their selection-event schema has never
// been exercised against this simulator; reusing the already-verified
// textContainerUpgrade path keeps this feature's behavior fully within code
// we control and can test today. Revisit if glasses-side song selection ever
// needs those container types (see CLAUDE.md).
//
// Mirrors the text-heavy template's proven container lifecycle (flicker-free
// textContainerUpgrade, serialized bridge writes) rather than re-deriving it.

const BODY_CONTAINER_ID = 1
const FOOTER_CONTAINER_ID = 2

// Order shown in the double-tap picker; mirrors the phone settings screen's
// practice/page ordering with the two heading units appended after.
const UP_DOWN_MODES: UpDownMode[] = ['practice', 'page', 'heading2', 'heading3']
const UP_DOWN_MODE_LABELS: Record<UpDownMode, string> = {
  practice: '練習番号ごと',
  page: 'ページ番号ごと',
  heading2: '見出し2ごと',
  heading3: '見出し3ごと',
}

export interface PerformanceHandle {
  stop(): void
}

type Position = { blockIndex: number; lineOffset: number }

export async function startPerformance(
  bridge: EvenAppBridge,
  song: Song,
  settings: Settings,
  onExit: (lastPosition: Position) => void,
): Promise<PerformanceHandle> {
  const maxLines = MAX_BODY_LINES
  let blockIndex = Math.min(Math.max(song.lastPosition.blockIndex, 0), song.blocks.length - 1)
  let lineOffset = song.lastPosition.lineOffset
  // The default from Settings, changeable for the rest of this performance
  // via the double-tap picker below — never written back to Settings.
  let upDownMode: UpDownMode = settings.upDownMode
  // Non-null while the double-tap picker is on screen; index into UP_DOWN_MODES.
  let picker: { selection: number } | null = null

  // Whether a number/title is meaningful anywhere in this song — spec.md:
  // an item stuck at its default value the whole way through is forced off
  // regardless of the phone-side toggle, since showing it is never useful.
  const pageEnabled = settings.showPageNumber && song.blocks.some(b => b.lines.some(l => l.pageNumber !== 0))
  const practiceEnabled =
    settings.showPracticeNumber && song.blocks.some(b => b.lines.some(l => l.practiceNumber !== '0'))
  const titleEnabled =
    settings.showTitle && (song.title.trim() !== '' || song.movements.some(m => m.title.trim() !== ''))

  const body = new TextContainerProperty({
    xPosition: 0,
    yPosition: 0,
    width: BODY_W,
    height: BODY_H,
    borderWidth: BODY_BORDER,
    borderColor: 5,
    paddingLength: BODY_PAD,
    containerID: BODY_CONTAINER_ID,
    containerName: 'body',
    content: '',
    isEventCapture: 1,
    // textColor deliberately omitted here: creation-time textColor is
    // rejected outright by the desktop simulator's (older) native binary
    // ("unknown field `textColor`") even though the SDK's TypeScript types
    // document it as a valid, safely-omittable field there. Brightness is
    // applied via textContainerUpgrade in render() instead, which this
    // simulator does accept.
  })

  const footer = new TextContainerProperty({
    xPosition: 0,
    yPosition: FOOTER_Y,
    width: BODY_W,
    height: FOOTER_H,
    borderWidth: 0,
    borderColor: 5,
    paddingLength: FOOTER_PAD,
    containerID: FOOTER_CONTAINER_ID,
    containerName: 'footer',
    content: '',
    isEventCapture: 0,
    // See the body container above — textColor is set via textContainerUpgrade instead.
  })

  const created = await bridge.createStartUpPageContainer(
    new CreateStartUpPageContainer({ containerTotalNum: 2, textObject: [body, footer] }),
  )
  if (created !== 0) console.error('createStartUpPageContainer failed:', created)

  // Serialize bridge writes so a fast tap/swipe can't queue overlapping upgrades.
  let rendering: Promise<unknown> = Promise.resolve()
  let lastFooterText: string | null = null
  let blinkTimers: number[] = []

  function footerDimBrightness(): number {
    return Math.max(MIN_TEXT_BRIGHTNESS, settings.brightness - 2)
  }

  function clampOffset(offset: number, total: number): number {
    if (total <= maxLines) return 0
    return Math.min(Math.max(offset, 0), total - maxLines)
  }

  function visibleLines(): PhysicalLine[] {
    const block = song.blocks[blockIndex]
    lineOffset = clampOffset(lineOffset, block.lines.length)
    return block.lines.slice(lineOffset, Math.min(lineOffset + maxLines, block.lines.length))
  }

  function render() {
    const lines = visibleLines()
    const bodyText = lines.map(l => l.text).join('\n')
    const footerText = buildFooter(lines)
    const footerChanged = footerText !== lastFooterText
    lastFooterText = footerText

    blinkTimers.forEach(id => window.clearTimeout(id))
    blinkTimers = []

    rendering = rendering.then(async () => {
      await bridge.textContainerUpgrade(
        new TextContainerUpgrade({
          containerID: BODY_CONTAINER_ID,
          containerName: 'body',
          content: bodyText,
          textColor: settings.brightness,
        }),
      )
      await bridge.textContainerUpgrade(
        new TextContainerUpgrade({
          containerID: FOOTER_CONTAINER_ID,
          containerName: 'footer',
          content: footerText,
          textColor: footerDimBrightness(),
        }),
      )
      if (footerChanged) scheduleFooterBlink(footerText)
    })
  }

  // "ゆっくりと1回だけ点滅" — one slow pulse up to body brightness and back,
  // so a footer change (new number range / new movement title) reads as
  // clearly different from the surrounding static main text. Content is
  // resent on every step (not just textColor) — the simulator does not
  // reliably keep the existing content when a textContainerUpgrade omits it.
  function scheduleFooterBlink(footerText: string) {
    blinkTimers.push(
      window.setTimeout(() => {
        void bridge.textContainerUpgrade(
          new TextContainerUpgrade({
            containerID: FOOTER_CONTAINER_ID,
            containerName: 'footer',
            content: footerText,
            textColor: settings.brightness,
          }),
        )
      }, 250),
    )
    blinkTimers.push(
      window.setTimeout(() => {
        void bridge.textContainerUpgrade(
          new TextContainerUpgrade({
            containerID: FOOTER_CONTAINER_ID,
            containerName: 'footer',
            content: footerText,
            textColor: footerDimBrightness(),
          }),
        )
      }, 550),
    )
  }

  function buildFooter(lines: PhysicalLine[]): string {
    const left = practiceEnabled ? rangeLabel(lines.map(l => l.practiceNumber)) : ''
    const right = pageEnabled ? rangeLabel(lines.map(l => l.pageNumber)) : ''
    const center = titleEnabled ? truncateTitle(movementTitle(lines[0].movementIndex)) : ''
    return composeFooterLine(left, center, right)
  }

  function movementTitle(movementIndex: number): string {
    const movement = movementIndex >= 0 ? song.movements[movementIndex] : undefined
    const title = movement?.title.trim()
    return title || song.title
  }

  function advanceClick() {
    const block = song.blocks[blockIndex]
    const end = clampOffset(lineOffset, block.lines.length) + Math.min(maxLines, block.lines.length)
    if (end < block.lines.length) {
      lineOffset += maxLines - 1 // clamped again on next render
    } else if (blockIndex < song.blocks.length - 1) {
      blockIndex++
      lineOffset = 0
    }
    render()
  }

  function jumpBoundary(direction: 1 | -1, mode: UpDownMode) {
    const target = findBoundary(direction, mode)
    if (!target) return
    blockIndex = target.blockIndex
    lineOffset = target.lineIndex
    render()
  }

  function valueAt(pos: { blockIndex: number; lineIndex: number }, mode: UpDownMode): number | string {
    const line = song.blocks[pos.blockIndex].lines[pos.lineIndex]
    switch (mode) {
      case 'page': return line.pageNumber
      case 'practice': return line.practiceNumber
      case 'heading2': return line.movementIndex
      case 'heading3': return line.sectionIndex
    }
  }

  function stepPos(
    pos: { blockIndex: number; lineIndex: number },
    dir: 1 | -1,
  ): { blockIndex: number; lineIndex: number } | null {
    let { blockIndex: b, lineIndex: l } = pos
    l += dir
    while (b >= 0 && b < song.blocks.length) {
      const len = song.blocks[b].lines.length
      if (l >= 0 && l < len) return { blockIndex: b, lineIndex: l }
      b += dir
      if (b < 0 || b >= song.blocks.length) return null
      l = dir === 1 ? 0 : song.blocks[b].lines.length - 1
    }
    return null
  }

  // Walks in `direction` from the current position until `mode`'s value
  // differs from where we started — i.e. the next/previous boundary.
  function findBoundary(direction: 1 | -1, mode: UpDownMode): { blockIndex: number; lineIndex: number } | null {
    const pos: { blockIndex: number; lineIndex: number } = { blockIndex, lineIndex: lineOffset }
    const referenceValue = valueAt(pos, mode)
    let next = stepPos(pos, direction)
    while (next && valueAt(next, mode) === referenceValue) next = stepPos(next, direction)
    return next
  }

  // --- Double-tap UP/DOWN-unit picker ---------------------------------
  // A plain hand-rolled list drawn into the same body/footer containers
  // (cursor as "> "), not ListContainerProperty/MenuContainerProperty — see
  // the file-level comment for why.

  function openModePicker() {
    picker = { selection: UP_DOWN_MODES.indexOf(upDownMode) }
    renderPicker()
  }

  function movePicker(direction: 1 | -1) {
    if (!picker) return
    picker.selection = Math.min(Math.max(picker.selection + direction, 0), UP_DOWN_MODES.length - 1)
    renderPicker()
  }

  function confirmPicker() {
    if (!picker) return
    upDownMode = UP_DOWN_MODES[picker.selection]
    picker = null
    render()
  }

  function renderPicker() {
    if (!picker) return
    const bodyText = [
      'UP/DOWNの単位を選択',
      ...UP_DOWN_MODES.map((mode, i) => `${i === picker!.selection ? '>' : ' '} ${UP_DOWN_MODE_LABELS[mode]}`),
    ].join('\n')

    blinkTimers.forEach(id => window.clearTimeout(id))
    blinkTimers = []

    rendering = rendering.then(async () => {
      await bridge.textContainerUpgrade(
        new TextContainerUpgrade({
          containerID: BODY_CONTAINER_ID,
          containerName: 'body',
          content: bodyText,
          textColor: settings.brightness,
        }),
      )
      await bridge.textContainerUpgrade(
        new TextContainerUpgrade({
          containerID: FOOTER_CONTAINER_ID,
          containerName: 'footer',
          content: 'UP/DOWN:選択　クリック:決定',
          textColor: footerDimBrightness(),
        }),
      )
    })
  }

  let stopped = false
  function stop() {
    if (stopped) return
    stopped = true
    unsubscribe()
    window.removeEventListener('beforeunload', stop)
    blinkTimers.forEach(id => window.clearTimeout(id))
    void bridge.shutDownPageContainer(1)
    onExit({ blockIndex, lineOffset })
  }

  const unsubscribe = bridge.onEvenHubEvent((event: EvenHubEvent) => {
    const sysType = eventTypeOf(event.sysEvent)
    const textType = eventTypeOf(event.textEvent)

    if (sysType === OsEventTypeList.SYSTEM_EXIT_EVENT || sysType === OsEventTypeList.ABNORMAL_EXIT_EVENT) {
      stop()
      return
    }

    if (picker) {
      if (textType === OsEventTypeList.SCROLL_TOP_EVENT) movePicker(-1)
      else if (textType === OsEventTypeList.SCROLL_BOTTOM_EVENT) movePicker(1)
      else if (sysType === OsEventTypeList.CLICK_EVENT || textType === OsEventTypeList.CLICK_EVENT) confirmPicker()
      // Anything else (notably another double-click) is ignored while picking.
      return
    }

    if (sysType === OsEventTypeList.CLICK_EVENT || textType === OsEventTypeList.CLICK_EVENT) {
      advanceClick()
      return
    }
    if (textType === OsEventTypeList.SCROLL_TOP_EVENT) {
      jumpBoundary(-1, upDownMode)
      return
    }
    if (textType === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
      jumpBoundary(1, upDownMode)
      return
    }
    if (sysType === OsEventTypeList.DOUBLE_CLICK_EVENT || textType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
      openModePicker()
    }
  })

  window.addEventListener('beforeunload', stop)

  render()

  return { stop }
}

function rangeLabel(values: Array<number | string>): string {
  const first = values[0]
  const last = values[values.length - 1]
  return first === last ? String(first) : `${first}-${last}`
}

// The glasses font has no native center/right alignment ("計算で合わせる" —
// spec.md explicitly calls for computing it), so this pads with spaces sized
// from pretext's own glyph metrics to approximate it. A few px of safety
// margin are reserved off the usable width: pxToSpaces always rounds down
// (never overshoots), but the container clips/wraps on ANY overflow at all —
// even a single px past the edge silently drops the last character onto a
// clipped second line — so slightly under-filling is the only safe side to
// err on, in exchange for alignment that's off by at most one space glyph.
const FOOTER_SAFETY_MARGIN_PX = 6

function composeFooterLine(left: string, center: string, right: string): string {
  const usableWidth = FOOTER_INNER_WIDTH - FOOTER_SAFETY_MARGIN_PX
  let line = left

  if (center) {
    const targetLeftEdge = (usableWidth - getTextWidth(center)) / 2
    line += padTo(line, targetLeftEdge) + center
  }
  if (right) {
    const targetLeftEdge = usableWidth - getTextWidth(right)
    line += padTo(line, targetLeftEdge) + right
  }
  return line
}

function padTo(current: string, targetLeftEdgePx: number): string {
  const gapPx = Math.max(0, targetLeftEdgePx - getTextWidth(current))
  const count = current ? Math.max(1, pxToSpaces(gapPx)) : pxToSpaces(gapPx)
  return ' '.repeat(count)
}

function pxToSpaces(px: number): number {
  const spaceWidth = (getAdvW(32) + 8) >> 4 // mirrors pretext's own px rounding for one space glyph
  if (spaceWidth <= 0) return 0
  return Math.floor(px / spaceWidth) // round down — see FOOTER_SAFETY_MARGIN_PX above
}

// CJK-titled songs get a tighter budget — narrow glyphs read fine at 20
// characters, but full-width CJK glyphs at that length would overflow.
function truncateTitle(title: string): string {
  const isCjkTitle = /[⺀-鿿豈-﫿가-힯]/.test(title)
  const limit = isCjkTitle ? 10 : 20
  return Array.from(title).slice(0, limit).join('')
}

function eventTypeOf(envelope?: { eventType?: OsEventTypeList }): OsEventTypeList | null {
  if (!envelope) return null
  return envelope.eventType ?? OsEventTypeList.CLICK_EVENT
}
