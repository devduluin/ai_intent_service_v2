import * as Minio from 'minio'
import { config } from '../config'
import { baseLogger } from './logger.util'
import * as fs from 'fs'
import * as path from 'path'
import { v4 as uuidv4 } from 'uuid'

// ============================================================
// MinIO Client Setup dengan Fallback ke Local Storage
// ============================================================

interface MinioConfig {
  endPoint: string
  port: number
  useSSL: boolean
  accessKey: string
  secretKey: string
}

interface UploadResult {
  success: boolean
  url: string
  location: 'minio' | 'local'
  error?: string
}

interface FileInput {
  buffer: Buffer
  filename: string
  mimetype?: string
}

class StorageHelper {
  private minioClient: Minio.Client | null = null
  private isMinioAvailable: boolean = false
  private bucketName: string = ''
  private uploadDir: string

  constructor() {
    const minioConfig = config.minio

    // Inisialisasi MinIO client jika enabled dan ada credentials
    if (minioConfig.enabled && minioConfig.accessKey && minioConfig.secretKey) {
      this.minioClient = new Minio.Client({
        endPoint: minioConfig.endPoint,
        port: minioConfig.port,
        useSSL: minioConfig.useSSL,
        accessKey: minioConfig.accessKey,
        secretKey: minioConfig.secretKey,
      })
      this.bucketName = minioConfig.bucket
      this.checkMinioConnection()
    } else {
      baseLogger.warn('MinIO disabled or missing credentials, using local storage')
    }

    this.uploadDir = config.storage.uploadDir
    this.ensureUploadDirectory()
  }

  /**
   * Cek koneksi MinIO secara async
   */
  private async checkMinioConnection(): Promise<void> {
    if (!this.minioClient) {
      this.isMinioAvailable = false
      return
    }

    try {
      const bucketExists = await this.minioClient.bucketExists(this.bucketName)
      if (!bucketExists) {
        await this.minioClient.makeBucket(this.bucketName)
        baseLogger.info(`MinIO bucket '${this.bucketName}' created`)
      }
      this.isMinioAvailable = true
      baseLogger.info('MinIO connection established')
    } catch (error) {
      this.isMinioAvailable = false
      baseLogger.warn({ error }, 'MinIO not available, will fallback to local storage')
    }
  }

  /**
   * Pastikan direktori upload lokal ada
   */
  private ensureUploadDirectory(): void {
    const absolutePath = path.resolve(this.uploadDir)
    if (!fs.existsSync(absolutePath)) {
      fs.mkdirSync(absolutePath, { recursive: true })
      baseLogger.info(`Created upload directory: ${absolutePath}`)
    }
  }

  /**
   * Generate unique filename
   */
  private generateFilename(originalFilename: string): string {
    const ext = path.extname(originalFilename)
    const name = path.basename(originalFilename, ext)
    const timestamp = Date.now()
    const uuid = uuidv4().substring(0, 8)
    return `${name}-${timestamp}-${uuid}${ext}`
  }

  /**
   * Upload buffer ke MinIO atau fallback ke local storage
   */
  async uploadFile(file: FileInput, subFolder?: string): Promise<UploadResult> {
    const filename = this.generateFilename(file.filename)
    const relativePath = subFolder ? path.join(subFolder, filename) : filename

    // Coba upload ke MinIO jika tersedia
    if (this.isMinioAvailable && this.minioClient) {
      try {
        await this.minioClient.putObject(
          this.bucketName,
          relativePath,
          file.buffer,
          file.buffer.length,
          {
            'Content-Type': file.mimetype || 'application/octet-stream',
          }
        )

        const url = this.getMinioFileUrl(relativePath)
        baseLogger.info(`File uploaded to MinIO: ${relativePath}`)

        return {
          success: true,
          url,
          location: 'minio',
        }
      } catch (error) {
        baseLogger.warn({ error }, 'MinIO upload failed, falling back to local storage')
        this.isMinioAvailable = false
        // Fallback ke local storage
      }
    }

    // Fallback ke local storage
    try {
      const localPath = path.join(this.uploadDir, relativePath)
      const absolutePath = path.resolve(localPath)

      // Pastikan subfolder ada
      const dirPath = path.dirname(absolutePath)
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true })
      }

      fs.writeFileSync(absolutePath, file.buffer)
      
      const url = `/uploads/${relativePath.replace(/\\/g, '/')}`
      baseLogger.info(`File saved locally: ${relativePath}`)

      return {
        success: true,
        url,
        location: 'local',
      }
    } catch (error) {
      baseLogger.error({ error }, 'Local storage upload failed')
      return {
        success: false,
        url: '',
        location: 'local',
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Upload file dari path lokal ke MinIO atau fallback
   */
  async uploadFileFromPath(filePath: string, subFolder?: string): Promise<UploadResult> {
    const filename = path.basename(filePath)
    const buffer = fs.readFileSync(filePath)
    
    return this.uploadFile({ buffer, filename }, subFolder)
  }

  /**
   * Download file dari MinIO atau local storage
   */
  async downloadFile(fileUrl: string): Promise<Buffer | null> {
    // Jika URL dari MinIO
    if (this.isMinioAvailable && this.minioClient && fileUrl.startsWith('http')) {
      try {
        const key = this.extractKeyFromUrl(fileUrl)
        if (key) {
          const stream = await this.minioClient.getObject(this.bucketName, key)
          return new Promise((resolve, reject) => {
            const chunks: Buffer[] = []
            stream.on('data', (chunk) => chunks.push(chunk))
            stream.on('end', () => resolve(Buffer.concat(chunks)))
            stream.on('error', (err) => reject(err))
          })
        }
      } catch (error) {
        baseLogger.warn({ error }, 'MinIO download failed, trying local storage')
      }
    }

    // Fallback ke local storage
    if (fileUrl.startsWith('/uploads/')) {
      const localPath = path.join(this.uploadDir, fileUrl.replace('/uploads/', ''))
      try {
        return fs.readFileSync(localPath)
      } catch (error) {
        baseLogger.error({ path: localPath, error }, 'Local file not found')
      }
    }

    return null
  }

  /**
   * Delete file dari MinIO atau local storage
   */
  async deleteFile(fileUrl: string): Promise<boolean> {
    // Jika URL dari MinIO
    if (this.isMinioAvailable && this.minioClient && fileUrl.startsWith('http')) {
      try {
        const key = this.extractKeyFromUrl(fileUrl)
        if (key) {
          await this.minioClient.removeObject(this.bucketName, key)
          baseLogger.info(`File deleted from MinIO: ${key}`)
          return true
        }
      } catch (error) {
        baseLogger.warn({ error }, 'MinIO delete failed, trying local storage')
      }
    }

    // Fallback ke local storage
    if (fileUrl.startsWith('/uploads/')) {
      const localPath = path.join(this.uploadDir, fileUrl.replace('/uploads/', ''))
      try {
        if (fs.existsSync(localPath)) {
          fs.unlinkSync(localPath)
          baseLogger.info(`File deleted locally: ${localPath}`)
          return true
        }
      } catch (error) {
        baseLogger.error({ path: localPath, error }, 'Local file delete failed')
      }
    }

    return false
  }

  /**
   * Get URL untuk file di MinIO
   */
  private getMinioFileUrl(key: string): string {
    const minioConfig = config.minio
    const protocol = minioConfig.useSSL ? 'https' : 'http'
    return `${protocol}://${minioConfig.endPoint}:${minioConfig.port}/${this.bucketName}/${key.replace(/\\/g, '/')}`
  }

  /**
   * Extract key dari MinIO URL
   */
  private extractKeyFromUrl(url: string): string | null {
    try {
      const urlObj = new URL(url)
      const pathParts = urlObj.pathname.split('/').filter(Boolean)
      // Format: /bucket/key
      if (pathParts.length >= 2 && pathParts[0] === this.bucketName) {
        return pathParts.slice(1).join('/')
      }
    } catch {
      // Invalid URL
    }
    return null
  }

  /**
   * Check apakah MinIO tersedia
   */
  isMinioEnabled(): boolean {
    return this.isMinioAvailable
  }

  /**
   * Re-check MinIO connection (useful after connection issues)
   */
  async reconnect(): Promise<void> {
    await this.checkMinioConnection()
  }
}

// Singleton instance
export const storageHelper = new StorageHelper()

// Export types
export type { FileInput, UploadResult }
