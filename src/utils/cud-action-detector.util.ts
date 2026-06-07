// ============================================================
// CUD Action Detector
// ============================================================
// Detects Create/Update/Delete/Execute verbs in user text to
// prevent general_chat from hallucinating action execution.
// This is a HARD GUARD — runs before LLM, zero latency.
// ============================================================

type CudCategory = 'create' | 'update' | 'delete' | 'execute';

interface ActiveState {
  hasPendingConfirmation?: boolean;
  hasPendingSlot?: boolean;
  hasActiveGodMode?: string;
}

export interface CudDetectionResult {
  isCudAction: boolean;
  verb?: string;
  category?: CudCategory;
  suggestedResponse?: string;
}

const CUD_PATTERNS: Array<{
  regex: RegExp;
  category: CudCategory;
  verb: string;
}> = [
  // Delete
  { regex: /^(hapus|delete|remove)\b/i, category: 'delete', verb: 'hapus' },
  { regex: /^(batalkan|batal|cancel|stop)\b/i, category: 'delete', verb: 'batalkan' },
  { regex: /^h(?:apus|ps)\s+\d+/i, category: 'delete', verb: 'hapus' },

  // Create
  { regex: /^(simpan|save)\b$/i, category: 'create', verb: 'simpan' },
  { regex: /^(buat|bikin|create|generate|tambah|add)\b/i, category: 'create', verb: 'buat' },

  // Update
  { regex: /^(ubah|ganti|edit|modif|update|patch)\b/i, category: 'update', verb: 'ubah' },

  // Execute
  { regex: /^(exit|keluar|kluar|tutup|close)\b$/i, category: 'execute', verb: 'exit' },
  { regex: /^(jalankan|eksekusi|run|execute|proses|lakukan)\b/i, category: 'execute', verb: 'jalankan' },
];

export function detectCudAction(text: string, activeState?: ActiveState): CudDetectionResult {
  const normalized = String(text || '').trim();

  if (/^(ya|iya|iy|yes|y|ok|oke)$/i.test(normalized)) {
    if (activeState?.hasPendingConfirmation) {
      return {
        isCudAction: true,
        verb: 'simpan',
        category: 'create',
        suggestedResponse: buildCudResponse('simpan', 'create', activeState),
      };
    }

    return { isCudAction: false };
  }

  for (const pattern of CUD_PATTERNS) {
    if (pattern.regex.test(normalized)) {
      return {
        isCudAction: true,
        verb: pattern.verb,
        category: pattern.category,
        suggestedResponse: buildCudResponse(pattern.verb, pattern.category, activeState),
      };
    }
  }

  return { isCudAction: false };
}

function buildCudResponse(verb: string, category: CudCategory, state?: ActiveState): string {
  // Has active state → guide user
  if (state?.hasPendingConfirmation) {
    switch (verb) {
      case 'simpan':
        return 'Ketik "simpan" atau "ya" untuk menyimpan draft yang sedang dikonfirmasi.';
      case 'batalkan':
        return 'Ketik "batalkan" untuk membatalkan draft. Atau "simpan" untuk menyimpan.';
      case 'ubah':
        return 'Ketik "ubah ..." untuk mengubah draft yang sedang dikonfirmasi.';
      default:
        return 'Anda sedang dalam proses konfirmasi. Ketik "simpan", "ubah ...", atau "batalkan".';
    }
  }

  if (state?.hasActiveGodMode) {
    switch (verb) {
      case 'exit':
        return `Ketik "exit" atau "kluar" untuk keluar dari mode ${state.hasActiveGodMode}.`;
      case 'hapus':
        return `Gunakan "hapus <nomor>" untuk menghapus item di mode ${state.hasActiveGodMode}.`;
      default:
        return `Anda dalam mode ${state.hasActiveGodMode}. Gunakan perintah yang tersedia di mode ini, atau ketik "exit" untuk keluar.`;
    }
  }

  if (state?.hasPendingSlot) {
    switch (verb) {
      case 'batalkan':
        return 'Ketik "batalkan" untuk membatalkan pengisian data yang sedang berlangsung.';
      default:
        return 'Anda sedang mengisi data. Selesaikan dulu, atau ketik "batalkan" untuk membatalkan.';
    }
  }

  // No active state → inform user
  switch (verb) {
    case 'hapus':
      return 'Tidak ada yang bisa dihapus saat ini. Ada yang bisa saya bantu?';
    case 'batalkan':
      return 'Tidak ada yang perlu dibatalkan saat ini. Ada yang bisa saya bantu?';
    case 'simpan':
      return 'Tidak ada draft yang perlu disimpan saat ini. Ada yang bisa saya bantu?';
    case 'ubah':
      return 'Tidak ada yang bisa diubah saat ini. Ada yang bisa saya bantu?';
    case 'buat':
      return 'Saya tidak bisa membuat/menambah data. Ada yang bisa saya bantu?';
    case 'exit':
      return 'Tidak ada mode aktif yang perlu ditutup. Ada yang bisa saya bantu?';
    case 'jalankan':
      return 'Saya tidak bisa menjalankan perintah. Ada yang bisa saya bantu?';
    default:
      return `Saya tidak bisa melakukan aksi "${verb}". Ada yang bisa saya bantu?`;
  }
}
