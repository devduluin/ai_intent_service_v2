// ============================================================
// Cancel Noop Message Builder
// ============================================================
// Generates rich, varied, human-like messages when user tries
// to cancel but nothing is active. Not robotic — natural.
// ============================================================

/**
 * Build a human-like "nothing to cancel" message.
 * Varied based on user context to avoid robotic repetition.
 */
export function buildCancelNoopMessage(context?: {
  name?: string;
  hasHistory?: boolean;
  retryCount?: number;
}): string {
  const name = context?.name;

  // Fresh user (first interaction)
  if (!context?.hasHistory) {
    const variants = [
      `Hai${name ? ` ${name}` : ''}! Tidak ada yang perlu dibatalkan. Saya siap membantu — langsung tulis aja kebutuhanmu ya.`,
      `Semua aman${name ? `, ${name}` : ''}. Tidak ada proses yang sedang berjalan. Ada yang bisa saya bantu?`,
      `Tidak ada yang perlu dikhawatirkan${name ? `, ${name}` : ''}. Belum ada proses aktif. Mau mulai dari mana?`,
    ];
    return pick(variants);
  }

  // Retry — user keeps saying "cancel" multiple times
  if (context?.retryCount && context.retryCount >= 2) {
    const variants = [
      `${name ? `${name}, ` : ''}saya pastikan lagi: tidak ada yang perlu dibatalkan. Mungkin ada yang ingin kamu tanyakan atau kerjakan?`,
      `Serius nih${name ? ` ${name}` : ''}, tidak ada proses yang berjalan. Yuk mulai dari awal — tulis aja apa yang kamu butuhkan.`,
      `${name ? `${name}, ` : ''}saya sudah cek beberapa kali dan tidak ada yang aktif. Gimana kalau kita lanjut ke topik baru?`,
    ];
    return pick(variants);
  }

  // Normal "cancel" but nothing active
  const variants = [
    `Tidak ada proses yang perlu dibatalkan saat ini${name ? `, ${name}` : ''}. Ada yang bisa saya bantu?`,
    `${name ? `${name}, ` : ''}semua aman. Tidak ada draft, konfirmasi, atau pengisian data yang sedang berjalan. Silakan tulis kebutuhan baru.`,
    `Tidak ada yang perlu dibatalkan. Kalau mau kelola automation, ketik "/automation manager". Atau langsung tulis aja kebutuhanmu.`,
    `Santai${name ? ` ${name}` : ''}, tidak ada yang pending. Saya siap bantu — mau mulai dari mana?`,
    `Belum ada proses aktif yang menunggu.${name ? ` Jadi tenang aja ya, ${name}.` : ''} Ada yang ingin dikerjakan?`,
  ];

  return pick(variants);
}

function pick(variants: string[]): string {
  return variants[Math.floor(Math.random() * variants.length)];
}