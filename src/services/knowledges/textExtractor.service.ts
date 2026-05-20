import axios from 'axios'
import * as cheerio from 'cheerio'
// @ts-ignore
import pdf from 'pdf-parse'
import mammoth from 'mammoth'
import { htmlCleanerService } from './htmlCleaner.service'

class TextExtractorService {

  // =========================================================
  // UNIVERSAL FILE DOWNLOADER (MinIO / S3 / CDN / Gateway)
  // =========================================================
  private async downloadFile(url: string): Promise<Buffer> {
    console.log('[Extractor] Downloading:', url)

    const res = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 20000
    })

    return Buffer.from(res.data)
  }

  // =========================================================
  // TEXT (manual input)
  // =========================================================
  async fromText(content: string): Promise<string> {
    return this.cleanText(content)
  }

  // =========================================================
  // WEB SCRAPER
  // =========================================================
  async fromWeb(url: string): Promise<string> {
    console.log('[Extractor] Scraping web:', url)

    const res = await axios.get(url, {
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    })

    return htmlCleanerService.clean(res.data)
  }

  // =========================================================
  // PDF EXTRACTOR
  // =========================================================
  async fromPDF(url: string): Promise<string> {
    console.log('[Extractor] Extracting PDF:', url)

    const buffer = await this.downloadFile(url)

    const pdfParse = typeof pdf === 'function'
      ? pdf
      : (pdf as any).default || pdf

    const data = await pdfParse(buffer)

    return this.cleanText(data.text)
  }

  // =========================================================
  // DOCX EXTRACTOR
  // =========================================================
  async fromDocx(url: string): Promise<string> {
    console.log('[Extractor] Extracting DOCX:', url)

    const buffer = await this.downloadFile(url)

    const result = await mammoth.extractRawText({ buffer })

    return this.cleanText(result.value)
  }

  // =========================================================
  // TEXT NORMALIZER (IMPORTANT FOR RAG)
  // =========================================================
  private cleanText(text: string): string {
    return text
      .replace(/\r/g, '')
      .replace(/\t/g, ' ')
      .replace(/[^\S\n]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }
}

export const textExtractorService = new TextExtractorService()