import type { Settings } from './types'
import { MAX_TEXT_BRIGHTNESS } from '@evenrealities/even_hub_sdk'

const STORAGE_KEY = 'chorus-prompter:settings'

const DEFAULT_SETTINGS: Settings = {
  brightness: MAX_TEXT_BRIGHTNESS,
  showPracticeNumber: true,
  showPageNumber: true,
  showTitle: true,
  upDownMode: 'practice',
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
  } catch (err) {
    console.error('Failed to load settings from localStorage', err)
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(settings: Settings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
}
