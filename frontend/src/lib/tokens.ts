// Token values needed in JS (deck.gl layer colours, contrast checks).
// These MUST mirror src/styles/tokens.css. If you change one, change both.
export const tokens = {
  bg0: '#06080b', bg1: '#0c1015', bg2: '#121820', bg3: '#1a222d',
  border: '#232c39', borderStrong: '#3a4757',
  text1: '#e9edf2', text2: '#a8b2bf', text3: '#8592a2',
  amber: '#ffb224', cyan: '#5cd3e8', danger: '#ff6459', success: '#41d392',
} as const

export type TokenName = keyof typeof tokens

/** WCAG 2.1 relative luminance contrast ratio between two #rrggbb colours. */
export function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
