// Shared G2 glasses geometry. Both the sync-time pagination (lyrics.ts) and
// the live performer (performer.ts) need the same container box, so the
// numbers live in one place instead of being duplicated and drifting.
//
// Mirrors the text-heavy template's proven layout: a tall body container for
// the verse text, plus a thin footer strip for the title / verse counter.

export const BODY_W = 576
export const BODY_H = 240
export const BODY_PAD = 4
export const BODY_BORDER = 0

export const FOOTER_Y = 250
export const FOOTER_H = 30
export const FOOTER_PAD = 4

// Usable pixel width for the footer's manually-composed practice/title/page
// line (see performer.ts's composeFooterLine — the glasses font has no
// native center/right alignment, so that spacing is computed against this).
export const FOOTER_INNER_WIDTH = BODY_W - 2 * FOOTER_PAD

export const BODY_INNER = {
  width: BODY_W - 2 * (BODY_PAD + BODY_BORDER),
  height: BODY_H - 2 * (BODY_PAD + BODY_BORDER),
}

// LVGL's fixed line height for the glasses' single built-in font.
export const LINE_HEIGHT = 27

// How many wrapped lines fit on screen at once — the unit the performer's
// display-window sliding algorithm (spec.md "一度に表示したい固まり") operates on.
export const MAX_BODY_LINES = Math.max(1, Math.floor(BODY_INNER.height / LINE_HEIGHT))
