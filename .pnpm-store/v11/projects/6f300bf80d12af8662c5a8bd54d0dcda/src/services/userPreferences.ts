export const moodOptions = ['Thoughtful', 'Happy', 'Calm', 'Grateful', 'Frustrated', 'Anxious', 'Sad', 'Hopeful']
export const energyOptions = ['Low', 'Steady', 'High']

export interface UserPreferences {
  defaultMood: string
  defaultEnergy: string
  spellCheck: boolean
  editorTextSize: number
  voiceReplies: boolean
  speechRate: number
}

export const defaultUserPreferences: UserPreferences = {
  defaultMood: 'Thoughtful',
  defaultEnergy: 'Steady',
  spellCheck: true,
  editorTextSize: 16,
  voiceReplies: true,
  speechRate: 0.94,
}

export function loadUserPreferences(): UserPreferences {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem('memory-preferences') ?? 'null')
    if (typeof value !== 'object' || value === null) return defaultUserPreferences
    const stored = value as Partial<UserPreferences>
    return {
      defaultMood: typeof stored.defaultMood === 'string' && moodOptions.includes(stored.defaultMood)
        ? stored.defaultMood
        : defaultUserPreferences.defaultMood,
      defaultEnergy: typeof stored.defaultEnergy === 'string' && energyOptions.includes(stored.defaultEnergy)
        ? stored.defaultEnergy
        : defaultUserPreferences.defaultEnergy,
      spellCheck: typeof stored.spellCheck === 'boolean' ? stored.spellCheck : defaultUserPreferences.spellCheck,
      editorTextSize: stored.editorTextSize === 15 || stored.editorTextSize === 16 || stored.editorTextSize === 18
        ? stored.editorTextSize
        : defaultUserPreferences.editorTextSize,
      voiceReplies: typeof stored.voiceReplies === 'boolean' ? stored.voiceReplies : defaultUserPreferences.voiceReplies,
      speechRate: stored.speechRate === 0.85 || stored.speechRate === 0.94 || stored.speechRate === 1.05
        ? stored.speechRate
        : defaultUserPreferences.speechRate,
    }
  } catch {
    return defaultUserPreferences
  }
}
