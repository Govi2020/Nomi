export type ThemeId = 'light' | 'dark' | 'storybook-harvest' | 'moss-paper' | 'clay-journal' | 'blue-hour' | 'plum-evening'

export type ColorTheme = {
  id: ThemeId
  name: string
  mode: 'light' | 'dark'
  description: string
  swatches: readonly [string, string, string, string, string]
  tokens: Record<string, string>
}

export const colorThemes: readonly ColorTheme[] = [
  {
    id: 'light',
    name: 'Light',
    mode: 'light',
    description: 'Soft paper and sage',
    swatches: ['#f4f4ef', '#ffffff', '#eceee7', '#65765d', '#947047'],
    tokens: {},
  },
  {
    id: 'dark',
    name: 'Dark',
    mode: 'dark',
    description: 'Quiet charcoal and sage',
    swatches: ['#191c18', '#20241f', '#262b24', '#8b9a81', '#c7a77c'],
    tokens: {},
  },
  {
    id: 'storybook-harvest',
    name: 'Storybook Harvest',
    mode: 'light',
    description: 'Teal, marigold, and deep berry',
    swatches: ['#335c67', '#fff3b0', '#e09f3e', '#9e2a2b', '#540b0e'],
    tokens: {
      '--bg': '#fff9e8', '--panel': '#fffdf7', '--panel2': '#f7edcf', '--line': '#d8ceb0', '--line-soft': '#e8dfc8',
      '--ink': '#263238', '--muted': '#4c6268', '--quiet': '#637478', '--sage': '#335c67', '--sage2': '#335c67', '--amber': '#e09f3e',
      '--accent': '#540b0e', '--accent-soft': '#f3e5d6', '--page-glow': '#fff3b0',
    },
  },
  {
    id: 'moss-paper',
    name: 'Moss & Paper',
    mode: 'light',
    description: 'Garden greens with warm linen',
    swatches: ['#344b3e', '#eff2e5', '#b8c9a9', '#c18a50', '#26352d'],
    tokens: {
      '--bg': '#f1f3e8', '--panel': '#fcfcf5', '--panel2': '#e5eadc', '--line': '#cbd5c5', '--line-soft': '#dce4d6',
      '--ink': '#29382f', '--muted': '#506357', '--quiet': '#6b796f', '--sage': '#496653', '--sage2': '#3f624d', '--amber': '#b78048',
      '--accent': '#344b3e', '--accent-soft': '#e0e9dc', '--page-glow': '#dce7d2',
    },
  },
  {
    id: 'clay-journal',
    name: 'Clay Journal',
    mode: 'light',
    description: 'Terracotta, rose, and parchment',
    swatches: ['#743d35', '#f7eee7', '#d6a68a', '#b97856', '#3a2b29'],
    tokens: {
      '--bg': '#f6eee8', '--panel': '#fffaf6', '--panel2': '#efe1d7', '--line': '#decec4', '--line-soft': '#e8dad1',
      '--ink': '#382b29', '--muted': '#6b514a', '--quiet': '#847067', '--sage': '#9e5848', '--sage2': '#87483d', '--amber': '#b97856',
      '--accent': '#743d35', '--accent-soft': '#f0dfd5', '--page-glow': '#f1dfd1',
    },
  },
  {
    id: 'blue-hour',
    name: 'Blue Hour',
    mode: 'dark',
    description: 'Inky blue with sea glass',
    swatches: ['#15262c', '#203740', '#72abb0', '#d7a575', '#e4efee'],
    tokens: {
      '--bg': '#15262c', '--panel': '#1d3037', '--panel2': '#263e46', '--line': '#3b555d', '--line-soft': '#30484f',
      '--ink': '#e4efee', '--muted': '#b6c9c8', '--quiet': '#8ca5a6', '--sage': '#72abb0', '--sage2': '#7bb6ba', '--amber': '#d7a575',
      '--accent': '#72abb0', '--accent-soft': '#28464c', '--page-glow': '#254149',
    },
  },
  {
    id: 'plum-evening',
    name: 'Plum Evening',
    mode: 'dark',
    description: 'Mulberry ink and muted rose',
    swatches: ['#251e2b', '#342a39', '#cf90ab', '#d8aa77', '#f2eaf0'],
    tokens: {
      '--bg': '#251e2b', '--panel': '#302736', '--panel2': '#403348', '--line': '#59475f', '--line-soft': '#493a50',
      '--ink': '#f2eaf0', '--muted': '#cbbaca', '--quiet': '#a393a4', '--sage': '#cf90ab', '--sage2': '#d397b2', '--amber': '#d8aa77',
      '--accent': '#cf90ab', '--accent-soft': '#443345', '--page-glow': '#493043',
    },
  },
]

export function getColorTheme(theme: string): ColorTheme {
  return colorThemes.find(option => option.id === theme) ?? colorThemes[1]
}
