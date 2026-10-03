import type { ClinicalReport, ClinicalReportObservation, ClinicalReportSource } from './clinicalReportService'

const PAGE_WIDTH = 595
const PAGE_HEIGHT = 842
const LEFT = 52
const RIGHT = 543
const CP1252: Record<string, number> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89,
  'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95,
  '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
}

function pdfHex(text: string) {
  const bytes: number[] = []
  for (const character of text) {
    const code = character.codePointAt(0) ?? 63
    if (CP1252[character] != null) bytes.push(CP1252[character])
    else if (code >= 32 && code <= 126 || code >= 160 && code <= 255) bytes.push(code)
    else if (character === '✳' || character === '✓') bytes.push(42)
    else bytes.push(63)
  }
  return `<${bytes.map(byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase()}>`
}

function parseColor(input: string, fallback: [number, number, number]): [number, number, number] {
  const value = input.trim()
  const hex = value.match(/^#([\da-f]{3}|[\da-f]{6})$/i)?.[1]
  if (hex) {
    const full = hex.length === 3 ? [...hex].map(char => char + char).join('') : hex
    return [0, 2, 4].map(index => Number.parseInt(full.slice(index, index + 2), 16) / 255) as [number, number, number]
  }
  const rgb = value.match(/rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)/i)
  if (rgb) return [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255]
  return fallback
}

function colorToken(name: string, fallback: [number, number, number]) {
  return parseColor(getComputedStyle(document.documentElement).getPropertyValue(name), fallback)
}

function wrap(text: string, maxCharacters: number) {
  const words = text.replace(/\s+/g, ' ').trim().split(' ')
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    if (!word) continue
    if (line && `${line} ${word}`.length > maxCharacters) {
      lines.push(line)
      line = word
    } else line = line ? `${line} ${word}` : word
  }
  if (line) lines.push(line)
  return lines.length ? lines : ['']
}

function buildPdf(report: ClinicalReport) {
  const background = colorToken('--bg', [0.96, 0.96, 0.93])
  const ink = colorToken('--ink', [0.14, 0.17, 0.14])
  const muted = colorToken('--muted', [0.39, 0.44, 0.37])
  const accent = colorToken('--sage2', [0.42, 0.51, 0.38])
  const line = colorToken('--line', [0.81, 0.83, 0.78])
  const pages: string[][] = []
  let commands: string[] = []
  let y = 785

  const rgb = (color: [number, number, number]) => color.map(value => Math.max(0, Math.min(1, value)).toFixed(3)).join(' ')
  const newPage = () => {
    commands = [`q ${rgb(background)} rg 0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT} re f Q`, `q ${rgb(accent)} rg 0 0 ${PAGE_WIDTH} 9 re f Q`]
    pages.push(commands)
    y = 787
  }
  const ensure = (height: number) => { if (y - height < 54) newPage() }
  const addText = (text: string, options: { size?: number; bold?: boolean; color?: [number, number, number]; x?: number } = {}) => {
    const size = options.size ?? 9
    commands.push(`${rgb(options.color ?? ink)} rg BT /${options.bold ? 'F2' : 'F1'} ${size} Tf 1 0 0 1 ${options.x ?? LEFT} ${y.toFixed(1)} Tm ${pdfHex(text)} Tj ET`)
  }
  const addParagraph = (text: string, options: { size?: number; bold?: boolean; color?: [number, number, number]; indent?: number; x?: number; maxCharacters?: number } = {}) => {
    const size = options.size ?? 9
    const lines = wrap(text, options.maxCharacters ?? 94)
    ensure(lines.length * 13 + 7)
    for (const value of lines) {
      addText(value, { size, bold: options.bold, color: options.color, x: options.x ?? LEFT + (options.indent ?? 0) })
      y -= 13
    }
    y -= 5
  }
  const addHeading = (title: string) => {
    ensure(37)
    y -= 4
    addText(title, { size: 13, bold: true, color: accent })
    y -= 8
    commands.push(`${rgb(line)} RG 0.7 w ${LEFT} ${y.toFixed(1)} m ${RIGHT} ${y.toFixed(1)} l S`)
    y -= 17
  }
  const addSources = (sources: ClinicalReportSource[]) => {
    for (const source of sources) {
      addParagraph(`[E${source.id}] ${source.date} - ${source.title}${source.excerpt ? `: ${source.excerpt}` : ''}`, { size: 8, color: muted, indent: 10, maxCharacters: 105 })
    }
  }
  const addItems = (title: string, items: ClinicalReportObservation[], empty: string) => {
    addHeading(title)
    if (!items.length) {
      addParagraph(empty, { color: muted })
      return
    }
    items.forEach((item, index) => {
      ensure(53)
      addText(item.title, { size: 10, bold: true })
      y -= 16
      addParagraph(item.description, { maxCharacters: 98 })
      addSources(item.sources)
      if (index < items.length - 1) y -= 4
    })
  }

  newPage()
  addText('NOMI  /  PERSONAL JOURNAL SUMMARY', { size: 8, bold: true, color: muted })
  y -= 28
  addText('Journal overview for counseling', { size: 21, bold: true })
  y -= 23
  addText(`Prepared ${report.generated_at}  ·  Period ${report.first_entry_date ?? '—'} to ${report.last_entry_date ?? '—'}`, { size: 9, color: muted })
  y -= 22
  commands.push(`${rgb(accent)} rg ${LEFT} ${(y - 3).toFixed(1)} 3 47 re f`)
  addParagraph('Context and limitations', { size: 10, bold: true, x: LEFT + 10, color: accent })
  addParagraph('This is a descriptive summary of self-selected journal writing, not a diagnosis, validated psychological test, or clinical opinion. It may reflect what was recorded rather than the person’s full experience. Review each interpretation with the person and add context or corrections.', { indent: 10, maxCharacters: 88, color: muted })

  addHeading('Coverage and mood scores')
  addParagraph(`${report.analyzed_entry_count} text entries reviewed across ${report.writing_days} writing days. The qualitative review used ${report.analysis_sample_count} entries.`)
  const scoreDays = report.mood_score_days ?? []
  if (scoreDays.length) {
    const mean = scoreDays.reduce((sum, day) => sum + day.average_score, 0) / scoreDays.length
    addParagraph(`Average of daily averages: ${mean.toFixed(1)} / 10 across ${scoreDays.length} scored days. A day’s score averages all rated entries for that date; unrated entries and dates are omitted.`, { color: muted })
    for (const day of scoreDays) addParagraph(`${day.date}: ${day.average_score.toFixed(1)} / 10 (${day.entry_count} ${day.entry_count === 1 ? 'entry' : 'entries'})`, { indent: 10, size: 8 })
  } else addParagraph('No numeric mood scores have been recorded. This is not a zero score.', { color: muted })

  addItems('Self-described preferences and personal tendencies', report.personality_details ?? [], 'The selected entries did not support a repeated, evidence-linked pattern in this area.')
  addItems('Behavior patterns and possible meaning', report.behavior_patterns ?? report.observations ?? [], 'The selected entries did not support a repeated, evidence-linked behavior pattern.')
  addItems('Behavioral shifts across time', report.behavioral_shifts ?? [], 'The selected entries did not support a clear, evidence-linked change across time.')

  addHeading('Overall comment')
  const overall = report.overall_comment
  addParagraph(overall?.text ?? 'This report reflects a partial, self-selected diary record. Its observations can support discussion but do not establish a complete picture of the person.', { maxCharacters: 98 })
  if (overall?.sources?.length) addSources(overall.sources)
  addHeading('Questions for discussion')
  for (const question of [
    'Which interpretations feel representative, and which need more context?',
    'What was happening in daily life around the dates cited in this report?',
    'Are there other experiences or sources of information to consider?',
  ]) addParagraph(`• ${question}`, { indent: 8 })

  pages.forEach((page, index) => {
    page.push(`${rgb(muted)} rg BT /F1 8 Tf 1 0 0 1 ${LEFT} 32 Tm ${pdfHex('Private journal summary · Review with the writer')} Tj ET`)
    page.push(`${rgb(muted)} rg BT /F1 8 Tf 1 0 0 1 ${RIGHT - 48} 32 Tm ${pdfHex(`Page ${index + 1} of ${pages.length}`)} Tj ET`)
  })

  const objects: string[] = []
  const addObject = (content: string) => { objects.push(content); return objects.length }
  addObject('<< /Type /Catalog /Pages 2 0 R >>')
  addObject('')
  addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
  addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')
  const pageIds: number[] = []
  pages.forEach(page => {
    const pageId = objects.length + 1
    const streamId = pageId + 1
    pageIds.push(pageId)
    const stream = page.join('\n')
    addObject(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${streamId} 0 R >>`)
    addObject(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
  })
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`

  let pdf = '%PDF-1.4\n%NOMI\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(pdf.length)
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xrefOffset = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
  return new TextEncoder().encode(pdf)
}

export function downloadClinicalReportPdf(report: ClinicalReport) {
  const bytes = buildPdf(report)
  const blob = new Blob([bytes], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `Nomi-Journal-Report-${report.generated_at || new Date().toISOString().slice(0, 10)}.pdf`
  anchor.style.display = 'none'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
