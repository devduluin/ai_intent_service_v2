import type { ChatMessage } from '../types'
// ============================================================
// 🧠 CHAT HISTORY TRIMMER
// Menghemat token dengan:
// 1. Membatasi jumlah message terakhir
// 2. Membatasi panjang isi message
// 3. Filter berdasarkan role
// ============================================================

interface TrimOptions {
  maxMessages?: number
  maxLength?: number
  filterRole?: string | string[]
}

export function trimChatHistory(
  history: ChatMessage[] = [],
  options: TrimOptions = {}
): ChatMessage[] {

  const {
    maxMessages = 10,
    maxLength = 128,
    filterRole
  } = options

  if (!history.length) return []

  // ============================================================
  // Normalize filter role
  // ============================================================

  const allowedRoles = filterRole
    ? Array.isArray(filterRole)
      ? filterRole
      : [filterRole]
    : null

  // ============================================================
  // Filter role jika ada
  // ============================================================

  const filtered = allowedRoles
    ? history.filter(msg => allowedRoles.includes(msg.role))
    : history

  // ============================================================
  // Ambil message terakhir
  // Tetap mempertahankan urutan asli:
  // lama -> terbaru
  // ============================================================

  const sliced = filtered.slice(-maxMessages)

  // ============================================================
  // Trim content
  // ============================================================

  return sliced.map(msg => {
    let content = msg.content || ''

    if (content.length > maxLength) {
      content =
        content.substring(0, maxLength).trim() + '…'
    }

    return {
      role: msg.role === 'user'
        ? 'user'
        : 'assistant',

      content
    }
  })
}