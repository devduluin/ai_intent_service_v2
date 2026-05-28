import type { StructuredResponse, StructuredResponseBlock, StructuredResponseSection } from '../types'

type GenericObject = Record<string, unknown>

export class ResponseStructureUtil {
  static build(response: string, apiResult?: unknown): StructuredResponse | undefined {
    const fromMarkdown = this.fromMarkdown(response)
    const hasStructuredMarkdown = fromMarkdown.sections.some(section => section.blocks.length > 0)

    if (hasStructuredMarkdown && this.hasMeaningfulStructure(fromMarkdown)) {
      return fromMarkdown
    }

    const fromObject = this.fromObject(apiResult, response)
    if (fromObject) {
      return fromObject
    }

    return hasStructuredMarkdown ? fromMarkdown : undefined
  }

  private static hasMeaningfulStructure(doc: StructuredResponse): boolean {
    let blockCount = 0
    let nonMarkdownCount = 0

    for (const section of doc.sections) {
      blockCount += section.blocks.length
      nonMarkdownCount += section.blocks.filter(block => block.type !== 'markdown').length
    }

    return nonMarkdownCount > 0 || blockCount > 1 || !!doc.title
  }

  static fromMarkdown(markdown: string): StructuredResponse {
    const normalized = (markdown || '').replace(/\r\n/g, '\n').trim()
    const sections: StructuredResponseSection[] = []
    let documentTitle: string | undefined
    let currentSection = this.createSection('overview')
    sections.push(currentSection)

    if (!normalized) {
      return { sections }
    }

    const lines = normalized.split('\n')
    const paragraphBuffer: string[] = []

    const flushParagraph = () => {
      const content = paragraphBuffer.join('\n').trim()
      if (content) {
        currentSection.blocks.push({ type: 'markdown', content })
      }
      paragraphBuffer.length = 0
    }

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]
      const trimmed = line.trim()

      if (!trimmed) {
        flushParagraph()
        continue
      }

      const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/)
      if (headingMatch) {
        flushParagraph()
        const level = headingMatch[1].length
        const title = headingMatch[2].trim()

        if (!documentTitle && level === 1) {
          documentTitle = title
          continue
        }

        const sectionId = this.slugify(title || `section-${sections.length + 1}`)
        currentSection = this.createSection(sectionId, title)
        sections.push(currentSection)
        continue
      }

      if (/^---+$/.test(trimmed)) {
        flushParagraph()
        currentSection.blocks.push({ type: 'divider' })
        continue
      }

      if (/^\|.*\|$/.test(trimmed) && i + 1 < lines.length && /^\|\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(lines[i + 1].trim())) {
        flushParagraph()
        const tableLines = [trimmed, lines[i + 1].trim()]
        i += 2

        while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) {
          tableLines.push(lines[i].trim())
          i += 1
        }
        i -= 1

        const tableBlock = this.parseMarkdownTable(tableLines)
        if (tableBlock) {
          currentSection.blocks.push(tableBlock)
          continue
        }
      }

      const listMatch = trimmed.match(/^([-*]|\d+\.)\s+(.+)$/)
      if (listMatch) {
        flushParagraph()
        const ordered = /\d+\./.test(listMatch[1])
        const items: string[] = [listMatch[2]]

        while (i + 1 < lines.length) {
          const nextTrimmed = lines[i + 1].trim()
          const nextMatch = nextTrimmed.match(/^([-*]|\d+\.)\s+(.+)$/)
          if (!nextMatch) break
          items.push(nextMatch[2])
          i += 1
        }

        currentSection.blocks.push({
          type: 'list',
          ordered,
          items,
        })
        continue
      }

      const noteMatch = trimmed.match(/^(?:💡\s*)?(Catatan|Note|Tips?|Penting)\s*:\s*(.+)$/i)
      if (noteMatch) {
        flushParagraph()
        currentSection.blocks.push({
          type: 'note',
          title: noteMatch[1],
          content: noteMatch[2],
          tone: /penting/i.test(noteMatch[1]) ? 'warning' : 'info',
        })
        continue
      }

      paragraphBuffer.push(line)
    }

    flushParagraph()

    return {
      title: documentTitle,
      sections: sections.filter(section => section.title || section.blocks.length > 0),
    }
  }

  static fromObject(apiResult: unknown, fallbackResponse?: string): StructuredResponse | undefined {
    const root = this.unwrapObject(apiResult)
    if (!root || typeof root !== 'object' || Array.isArray(root)) {
      return undefined
    }

    const sections: StructuredResponseSection[] = []
    const detailEntries: Array<{ label: string; value: string }> = []

    for (const [key, value] of Object.entries(root)) {
      if (value === null || value === undefined) continue

      if (this.isPrimitive(value)) {
        detailEntries.push({ label: this.labelize(key), value: this.stringifyValue(value) })
        continue
      }

      const section = this.createSection(this.slugify(key), this.labelize(key))
      const blocks = this.blocksFromValue(value)
      if (blocks.length > 0) {
        section.blocks.push(...blocks)
        sections.push(section)
      }
    }

    if (detailEntries.length > 0) {
      sections.unshift({
        id: 'detail',
        title: 'Detail',
        blocks: [
          {
            type: 'key_value',
            entries: detailEntries,
          },
        ],
      })
    }

    if (sections.length === 0) {
      return fallbackResponse
        ? { sections: [{ id: 'overview', blocks: [{ type: 'markdown', content: fallbackResponse }] }] }
        : undefined
    }

    return { sections }
  }

  private static blocksFromValue(value: unknown): StructuredResponseBlock[] {
    if (this.isPrimitive(value)) {
      return [{ type: 'markdown', content: this.stringifyValue(value) }]
    }

    if (Array.isArray(value)) {
      if (value.length === 0) {
        return [{ type: 'markdown', content: '-' }]
      }

      if (value.every(item => this.isPrimitive(item))) {
        return [
          {
            type: 'list',
            items: value.map(item => this.stringifyValue(item)),
          },
        ]
      }

      const objects = value.filter(item => item && typeof item === 'object' && !Array.isArray(item)) as GenericObject[]
      if (objects.length > 0) {
        const columns = Array.from(
          new Set(objects.flatMap(item => Object.keys(item)))
        ).slice(0, 8)

        return [
          {
            type: 'table',
            columns: columns.map(column => this.labelize(column)),
            rows: objects.map(item =>
              columns.map(column => this.stringifyValue(item[column]))
            ),
          },
        ]
      }

      return [{ type: 'markdown', content: this.stringifyValue(value) }]
    }

    if (value && typeof value === 'object') {
      const obj = value as GenericObject
      const primitiveEntries = Object.entries(obj)
        .filter(([, nested]) => this.isPrimitive(nested))
        .map(([label, nested]) => ({
          label: this.labelize(label),
          value: this.stringifyValue(nested),
        }))

      const nestedBlocks: StructuredResponseBlock[] = []

      if (primitiveEntries.length > 0) {
        nestedBlocks.push({
          type: 'key_value',
          entries: primitiveEntries,
        })
      }

      for (const [nestedKey, nestedValue] of Object.entries(obj)) {
        if (this.isPrimitive(nestedValue)) continue
        const childBlocks = this.blocksFromValue(nestedValue)
        if (childBlocks.length > 0) {
          nestedBlocks.push({
            type: 'markdown',
            content: `#### ${this.labelize(nestedKey)}`,
          })
          nestedBlocks.push(...childBlocks)
        }
      }

      return nestedBlocks
    }

    return []
  }

  private static parseMarkdownTable(lines: string[]): StructuredResponseBlock | null {
    if (lines.length < 3) return null

    const parseRow = (row: string) =>
      row
        .replace(/^\||\|$/g, '')
        .split('|')
        .map(cell => cell.trim())

    const columns = parseRow(lines[0])
    const rows = lines.slice(2).map(parseRow)

    if (columns.length === 0) return null

    return {
      type: 'table',
      columns,
      rows,
    }
  }

  private static unwrapObject(value: unknown): unknown {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return value
    }

    const obj = value as GenericObject
    const keys = Object.keys(obj)

    if (keys.length === 1 && obj[keys[0]] && typeof obj[keys[0]] === 'object') {
      return obj[keys[0]]
    }

    return obj
  }

  private static createSection(id: string, title?: string): StructuredResponseSection {
    return {
      id,
      title,
      blocks: [],
    }
  }

  private static isPrimitive(value: unknown): value is string | number | boolean {
    return ['string', 'number', 'boolean'].includes(typeof value)
  }

  private static stringifyValue(value: unknown): string {
    if (value === null || value === undefined) return '-'
    if (typeof value === 'string') return value
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }

  private static labelize(key: string): string {
    return key
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^\w/, char => char.toUpperCase())
  }

  private static slugify(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'section'
  }
}
