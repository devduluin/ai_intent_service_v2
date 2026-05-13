import * as cheerio from 'cheerio'

class HtmlCleanerService {

  clean(html: string): string {
    const $ = cheerio.load(html)

    // hapus elemen yang pasti noise
    const noiseSelectors = [
      'script',
      'style',
      'noscript',
      'header',
      'footer',
      'nav',
      'aside',
      'form',
      'button',
      'svg',
      'img',
      '.cookie',
      '.cookies',
      '.banner',
      '.navbar',
      '.footer',
      '.sidebar',
      '.advertisement',
      '.ads'
    ]

    noiseSelectors.forEach(sel => $(sel).remove())

    // ambil kemungkinan main content area
    const candidates = [
      'article',
      'main',
      '#content',
      '.content',
      '.post',
      '.article',
      '.markdown-body'
    ]

    for (const selector of candidates) {
      const text = $(selector).text()
      if (text.length > 200) {
        return this.cleanText(text)
      }
    }

    // fallback kalau tidak ketemu
    return this.cleanText($('body').text())
  }

  private cleanText(text: string): string {
    return text
      .replace(/\s+/g, ' ')
      .replace(/\n+/g, '\n')
      .trim()
  }
}

export const htmlCleanerService = new HtmlCleanerService()