/**
 * Contoh Penggunaan Storage Helper
 * 
 * File ini mendemonstrasikan cara menggunakan storageHelper untuk upload/download file
 */

import { storageHelper, type FileInput } from '../storage-helper.util'
import * as fs from 'fs'
import * as path from 'path'

// ============================================================
// Contoh 1: Upload dari Buffer (misal dari multipart form)
// ============================================================
async function uploadFromBuffer(fileBuffer: Buffer, originalFilename: string, mimetype: string) {
  const file: FileInput = {
    buffer: fileBuffer,
    filename: originalFilename,
    mimetype,
  }

  // Upload ke root folder
  const result1 = await storageHelper.uploadFile(file)
  console.log('Upload result:', result1)
  // Output: { success: true, url: '...', location: 'minio' | 'local' }

  // Upload dengan subfolder
  const result2 = await storageHelper.uploadFile(file, 'avatars')
  console.log('Upload to subfolder:', result2)
  // Output: { success: true, url: '...', location: 'minio' | 'local' }

  return result2
}

// ============================================================
// Contoh 2: Upload dari File Path Lokal
// ============================================================
async function uploadFromLocalFile(localFilePath: string) {
  const result = await storageHelper.uploadFileFromPath(localFilePath, 'documents')
  console.log('Upload from path:', result)
  return result
}

// ============================================================
// Contoh 3: Download File
// ============================================================
async function downloadFile(fileUrl: string): Promise<Buffer | null> {
  const buffer = await storageHelper.downloadFile(fileUrl)
  
  if (buffer) {
    // Lakukan sesuatu dengan buffer (simpan, stream, dll)
    console.log('File downloaded successfully')
    return buffer
  } else {
    console.log('File not found')
    return null
  }
}

// ============================================================
// Contoh 4: Delete File
// ============================================================
async function deleteFile(fileUrl: string): Promise<boolean> {
  const success = await storageHelper.deleteFile(fileUrl)
  
  if (success) {
    console.log('File deleted successfully')
    return true
  } else {
    console.log('Failed to delete file')
    return false
  }
}

// ============================================================
// Contoh 5: Upload Multiple Files
// ============================================================
interface UploadedFile {
  buffer: Buffer
  originalname: string
  mimetype: string
}

async function uploadMultipleFiles(files: UploadedFile[]) {
  const results = []
  
  for (const file of files) {
    const result = await storageHelper.uploadFile({
      buffer: file.buffer,
      filename: file.originalname,
      mimetype: file.mimetype,
    }, 'attachments')
    
    results.push({
      originalName: file.originalname,
      ...result,
    })
  }
  
  return results
}

// ============================================================
// Contoh 6: Check MinIO Status
// ============================================================
function checkStorageStatus() {
  const isMinioEnabled = storageHelper.isMinioEnabled()
  console.log('MinIO Status:', isMinioEnabled ? 'Connected' : 'Using local storage')
  return isMinioEnabled
}

// ============================================================
// Contoh 7: Reconnect MinIO (jika connection lost)
// ============================================================
async function reconnectMinio() {
  await storageHelper.reconnect()
  console.log('MinIO reconnection attempted')
}

// ============================================================
// Contoh Penggunaan dalam Fastify Route
// ============================================================
/*
// routes/upload.route.ts
import { FastifyInstance } from 'fastify'
import { storageHelper } from '../utils/storage-helper.util'
import multer from 'fastify-multer'

const upload = multer({ storage: multer.memoryStorage() })

export async function uploadRoutes(fastify: FastifyInstance) {
  fastify.post(
    '/upload',
    {
      schema: {
        consumes: ['multipart/form-data'],
        body: {
          type: 'object',
          properties: {
            file: { type: 'string', format: 'binary' },
          },
        },
      },
    },
    async (request, reply) => {
      const data = await request.file()
      
      if (!data) {
        return reply.code(400).send({ error: 'No file provided' })
      }

      const result = await storageHelper.uploadFile(
        {
          buffer: data.file.buffer,
          filename: data.filename,
          mimetype: data.mimetype,
        },
        'user-uploads'
      )

      if (!result.success) {
        return reply.code(500).send({ error: result.error })
      }

      return reply.send({
        success: true,
        url: result.url,
        location: result.location,
      })
    }
  )
}
*/

// ============================================================
// Environment Variables (.env)
// ============================================================
/*
# MinIO Configuration
MINIO_ENABLED=true
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=uploads

# Local Storage Fallback
UPLOAD_DIR=./uploads
*/

// Export untuk digunakan
export {
  uploadFromBuffer,
  uploadFromLocalFile,
  downloadFile,
  deleteFile,
  uploadMultipleFiles,
  checkStorageStatus,
  reconnectMinio,
}
