import type { Settings, Song, UpDownMode } from './types'

// Phone-screen UI: a plain library list (no framework — the whole app is a
// couple hundred lines, a framework would be pure overhead). Re-renders the
// whole screen on state changes and uses event delegation so listeners don't
// need to be re-attached per row.

export interface LibraryCallbacks {
  onAdd(title: string, url: string): void
  onSync(id: string): void
  onDelete(id: string): void
  onPerform(id: string): void
  onSettingsChange(settings: Settings): void
}

export function renderLibrary(
  root: HTMLElement,
  songs: Song[],
  syncingIds: ReadonlySet<string>,
  settings: Settings,
  cb: LibraryCallbacks,
): void {
  root.innerHTML = `
    <main style="margin:0 auto;padding:24px;max-width:640px;box-sizing:border-box;width:100%;">
      <header style="margin-bottom:20px;">
        <h1 style="font-size:20px;font-weight:600;margin:0 0 4px;">合唱プロンプター</h1>
        <p style="font-size:12px;color:#919191;margin:0;">
          Markdown の URL を登録して同期すると、機内モードでも Bluetooth 経由で G2 / R1 から歌詞を操作できます。
        </p>
      </header>

      <form id="add-form" style="display:flex;flex-direction:column;gap:8px;margin-bottom:24px;padding:16px;background:#2E2E2E;border:1px solid #3E3E3E;border-radius:12px;">
        <input name="title" placeholder="曲名" required
          style="${inputStyle}" />
        <input name="url" type="url" placeholder="https://raw.githubusercontent.com/.../song.md" required
          style="${inputStyle}" />
        <button type="submit" style="${buttonStyle('#4C8BF5')}">曲を追加 &amp; 同期</button>
      </form>

      <ul id="song-list" style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px;margin-bottom:24px;">
        ${songs.length ? songs.map(songRow(syncingIds)).join('') : emptyState}
      </ul>

      <form id="settings-form" style="display:flex;flex-direction:column;gap:12px;padding:16px;background:#2E2E2E;border:1px solid #3E3E3E;border-radius:12px;">
        <h2 style="font-size:14px;font-weight:600;margin:0;">グラス表示の設定</h2>

        <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#B5B5B5;">
          明るさ（${settings.brightness}/4）
          <input name="brightness" type="range" min="0" max="4" step="1" value="${settings.brightness}" />
        </label>

        <label style="${checkboxLabelStyle}">
          <input name="showPracticeNumber" type="checkbox" ${settings.showPracticeNumber ? 'checked' : ''} />
          練習番号を表示（左下）
        </label>
        <label style="${checkboxLabelStyle}">
          <input name="showTitle" type="checkbox" ${settings.showTitle ? 'checked' : ''} />
          曲名を表示（中央下）
        </label>
        <label style="${checkboxLabelStyle}">
          <input name="showPageNumber" type="checkbox" ${settings.showPageNumber ? 'checked' : ''} />
          ページ番号を表示（右下）
        </label>

        <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#B5B5B5;">
          UP / DOWN（リング上下スワイプ）で移動する単位の既定値（演奏中はグラス側のダブルタップでいつでも変更できます）
          <select name="upDownMode" style="${inputStyle}">
            <option value="practice" ${settings.upDownMode === 'practice' ? 'selected' : ''}>練習番号ごと</option>
            <option value="page" ${settings.upDownMode === 'page' ? 'selected' : ''}>ページ番号ごと</option>
            <option value="heading2" ${settings.upDownMode === 'heading2' ? 'selected' : ''}>見出し2ごと</option>
            <option value="heading3" ${settings.upDownMode === 'heading3' ? 'selected' : ''}>見出し3ごと</option>
          </select>
        </label>
      </form>
    </main>
  `

  root.querySelector('#add-form')!.addEventListener('submit', e => {
    e.preventDefault()
    const form = e.currentTarget as HTMLFormElement
    const data = new FormData(form)
    const title = String(data.get('title') ?? '').trim()
    const url = String(data.get('url') ?? '').trim()
    if (!title || !url) return
    cb.onAdd(title, url)
    form.reset()
  })

  root.querySelector('#song-list')!.addEventListener('click', e => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-action]')
    if (!target) return
    const id = target.dataset.id!
    switch (target.dataset.action) {
      case 'sync': cb.onSync(id); break
      case 'delete': cb.onDelete(id); break
      case 'perform': cb.onPerform(id); break
    }
  })

  const settingsForm = root.querySelector<HTMLFormElement>('#settings-form')!
  settingsForm.addEventListener('input', () => {
    const data = new FormData(settingsForm)
    cb.onSettingsChange({
      brightness: Number(data.get('brightness')),
      showPracticeNumber: data.get('showPracticeNumber') != null,
      showTitle: data.get('showTitle') != null,
      showPageNumber: data.get('showPageNumber') != null,
      upDownMode: asUpDownMode(data.get('upDownMode')),
    })
  })
}

export function renderPerforming(root: HTMLElement, song: Song, onBack: () => void): void {
  root.innerHTML = `
    <main style="margin:auto;padding:24px;max-width:640px;box-sizing:border-box;text-align:center;">
      <h1 style="font-size:18px;font-weight:600;margin:0 0 8px;">${escapeHtml(song.title)}</h1>
      <p style="font-size:13px;color:#919191;margin:0 0 4px;">グラスに表示中 — R1 / タッチパッドで操作してください</p>
      <p style="font-size:12px;color:#7B7B7B;margin:0 0 20px;">
        クリック: 次へ&emsp;上スワイプ: 前の単位へ&emsp;下スワイプ: 次の単位へ&emsp;ダブルタップ: 移動単位を選択
      </p>
      <button id="back-btn" style="${buttonStyle('#E5716A')}">
        終了してライブラリに戻る（グラスの表示も終了します）
      </button>
    </main>
  `
  root.querySelector('#back-btn')!.addEventListener('click', onBack)
}

const emptyState = `
  <li style="padding:20px;text-align:center;color:#7B7B7B;font-size:13px;background:#2E2E2E;border:1px dashed #3E3E3E;border-radius:12px;">
    まだ曲がありません。上のフォームから Markdown の URL を追加してください。
  </li>
`

function songRow(syncingIds: ReadonlySet<string>) {
  return (song: Song): string => {
    const syncing = syncingIds.has(song.id)
    const status = syncing
      ? '同期中…'
      : song.syncError
        ? `同期エラー: ${escapeHtml(song.syncError)}`
        : song.fetchedAt
          ? `同期済み: ${new Date(song.fetchedAt).toLocaleString('ja-JP')}（${song.blocks.length}節）`
          : '未同期'
    const statusColor = song.syncError ? '#E5716A' : '#919191'
    const canPerform = song.blocks.length > 0 && !syncing

    return `
      <li style="padding:14px 16px;background:#2E2E2E;border:1px solid #3E3E3E;border-radius:12px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
          <div style="min-width:0;">
            <div style="font-size:15px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(song.title)}</div>
            <div style="font-size:11px;color:${statusColor};margin-top:2px;">${status}</div>
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-top:10px;">
          <button data-action="perform" data-id="${song.id}" ${canPerform ? '' : 'disabled'}
            style="${buttonStyle(canPerform ? '#4CAF50' : '#3E3E3E')}">再生</button>
          <button data-action="sync" data-id="${song.id}" ${syncing ? 'disabled' : ''}
            style="${buttonStyle('#3E3E3E')}">同期</button>
          <button data-action="delete" data-id="${song.id}"
            style="${buttonStyle('#3E3E3E')}">削除</button>
        </div>
      </li>
    `
  }
}

const inputStyle = 'background:#1E1E1E;border:1px solid #3E3E3E;border-radius:8px;padding:10px 12px;color:#E5E5E5;font-size:14px;'
const checkboxLabelStyle = 'display:flex;align-items:center;gap:8px;font-size:13px;color:#E5E5E5;'

function buttonStyle(bg: string): string {
  return `flex:1;background:${bg};border:none;border-radius:8px;padding:9px 12px;color:#fff;font-size:13px;font-weight:500;`
}

const UP_DOWN_MODES: UpDownMode[] = ['practice', 'page', 'heading2', 'heading3']

function asUpDownMode(value: FormDataEntryValue | null): UpDownMode {
  return UP_DOWN_MODES.includes(value as UpDownMode) ? (value as UpDownMode) : 'practice'
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
