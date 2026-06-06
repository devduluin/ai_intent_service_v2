// ============================================================
// Cancel Noop Message Builder
// ============================================================
// Generates rich, varied, human-like "nothing to cancel" messages.
// Many variants prevent robotic repetition across sessions.
// ============================================================

/**
 * Get a rich variety of "nothing to cancel" messages.
 * Context-sensitive: fresh user, retry, or normal.
 */
export function buildCancelNoopVariants(context?: {
  name?: string;
  hasHistory?: boolean;
  retryCount?: number;
}): string {
  const name = context?.name;

  // User keeps saying "cancel" — be more reassuring and suggest alternatives
  if (context?.retryCount && context.retryCount >= 2) {
    return pick([
      `${name ? `${name}, ` : ''}saya pastikan sekali lagi: tidak ada yang perlu dibatalkan. Mungkin ada yang ingin kamu tanyakan atau kerjakan?`,
      `Serius nih${name ? ` ${name}` : ''}, semua aman. Tidak ada proses yang berjalan. Yuk mulai dari awal — tulis aja apa yang kamu butuhkan.`,
      `${name ? `${name}, ` : ''}tidak ada proses aktif, sudah saya cek beberapa kali. Gimana kalau kita lanjut ke topik baru?`,
      `Semua clear kok${name ? ` ${name}` : ''}. Tidak ada draft, konfirmasi, atau apa pun yang pending. Cerita aja apa yang kamu mau.`,
      `${name ? `${name}, ` : ''}tenang, tidak ada yang perlu dibatalkan. Mungkin ada hal lain yang ingin kamu selesaikan?`,
    ]);
  }

  // Fresh user or first interaction
  if (!context?.hasHistory) {
    return pick([
      `Hai${name ? ` ${name}` : ''}! Tidak ada yang perlu dibatalkan. Saya siap membantu — langsung tulis aja kebutuhanmu.`,
      `Semua aman${name ? `, ${name}` : ''}. Tidak ada proses yang sedang berjalan. Ada yang bisa saya bantu?`,
      `Tidak ada yang perlu dikhawatirkan${name ? `, ${name}` : ''}. Belum ada proses aktif. Mau mulai dari mana?`,
      `Selamat datang${name ? ` ${name}` : ''}! Tidak ada yang pending. Langsung aja — apa yang ingin kamu lakukan?`,
    ]);
  }

  // Normal — nothing to cancel
  return pick([
    `Tidak ada proses yang perlu dibatalkan saat ini${name ? `, ${name}` : ''}. Ada yang bisa saya bantu?`,
    `${name ? `${name}, ` : ''}semua aman. Tidak ada draft, konfirmasi, atau pengisian data yang sedang berjalan. Silakan tulis kebutuhan baru.`,
    `Tidak ada yang perlu dibatalkan. Kalau mau kelola automation, ketik "/automation manager". Atau langsung tulis aja kebutuhanmu.`,
    `Santai${name ? ` ${name}` : ''}, tidak ada yang pending. Saya siap bantu — mau mulai dari mana?`,
    `Belum ada proses aktif yang menunggu.${name ? ` Jadi tenang aja ya, ${name}.` : ''} Ada yang ingin dikerjakan?`,
    `Semua clear${name ? `, ${name}` : ''}. Tidak ada proses yang perlu dibatalkan. Yuk lanjut — ada yang bisa saya bantu?`,
    `Tidak ada yang perlu di-cancel${name ? ` ${name}` : ''}. Bebas aja tulis apa yang kamu butuhkan.`,
    `${name ? `${name}, ` : ''}nggak ada yang aktif kok. Langsung aja — saya siap bantu apa pun.`,
    `Semua dalam keadaan idle${name ? `, ${name}` : ''}. Tidak ada yang perlu dibatalkan. Apa yang ingin kamu lakukan?`,
    `Tidak ada proses yang menunggu pembatalan.${name ? ` Kamu bisa langsung mulai, ${name}.` : ''} Ada ide?`,
    `Aman terkendali${name ? ` ${name}` : ''}. Tidak ada yang perlu dibatalkan. Mau ngobrol atau ada task yang ingin dikerjakan?`,
  ]);
}

function pick(variants: string[]): string {
  return variants[Math.floor(Math.random() * variants.length)];
}