// ============================================================
// 🧠 CHAT HISTORY TRIMMER (MESSAGE + LENGTH BASED)
// Menghemat token dengan:
// 1. Membatasi jumlah message terakhir
// 2. Membatasi panjang isi tiap message
// ============================================================

export interface ChatHistoryItem {
  role: 'user' | 'assistant' | string
  content: string
}

interface TrimOptions {
  maxMessages?: number   // jumlah message terakhir
  maxLength?: number     // panjang karakter per message
}

export function trimChatHistory(
  history: ChatHistoryItem[] = [],
  options: TrimOptions = {}
): ChatHistoryItem[] {

  const {
    maxMessages = 10,   // default simpan 10 message terakhir
    maxLength = 128     // default max 128 char per message
  } = options

  if (!history.length) return []

  // 1️⃣ Ambil message terakhir
  const sliced = history.slice(-maxMessages)

  // 2️⃣ Potong isi tiap message
  const trimmed = sliced.map(msg => {
    let content = msg.content || ''

    if (content.length > maxLength) {
      content = content.substring(0, maxLength).trim() + '…'
    }

    return {
      role: msg.role === 'user' ? 'user' : 'assistant',
      content
    }
  })

  return trimmed
}