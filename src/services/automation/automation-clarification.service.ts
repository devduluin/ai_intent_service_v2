class AutomationClarificationService {
  buildQuestion(
    missing: string[],
    collectedParams: Record<string, unknown> = {}
  ): string {
    if (missing.includes('automation_type')) {
      return [
        'Jenis automation apa yang ingin dibuat?',
        '',
        'Contoh:',
        '- Reminder: "ingatkan saya besok jam 7 pagi meeting"',
        '- Scheduled workflow: "cek laporan operasional setiap hari jam 5 sore"',
        '- Conditional alert: "kabari saya kalau expense lebih dari 10 juta setiap hari jam 5 sore"'
      ].join('\n');
    }

    if (missing.includes('goal')) {
      return 'Apa tujuan automation ini? Contoh: "cek laporan operasional harian" atau "ingatkan meeting dengan client".';
    }

    if (missing.includes('condition')) {
      return 'Kondisi apa yang harus dipenuhi? Contoh: "expense lebih dari 10 juta", "stok kurang dari 20", atau "approval tertunda lebih dari 2 hari".';
    }

    if (missing.includes('schedule')) {
      const schedule = String(collectedParams.schedule || '').trim();
      if (schedule && /\b(setiap|tiap|every)\b/i.test(schedule)) {
        return `Saya sudah menangkap polanya: "${schedule}". Jam berapa automation ini dijalankan? Contoh: "jam 5 sore".`;
      }

      if (schedule && /\b(jam|pukul|\d{1,2}[:.]\d{2})\b/i.test(schedule)) {
        return `Saya sudah menangkap waktunya: "${schedule}". Apakah ini hanya sekali, setiap hari, setiap minggu, atau tanggal tertentu? Contoh: "setiap hari".`;
      }

      return [
        'Kapan automation ini dijalankan?',
        '',
        'Contoh jadwal:',
        '- "besok jam 7 pagi"',
        '- "setiap hari jam 5 sore"',
        '- "setiap Senin jam 9 pagi"',
        '- "setiap tanggal 1 jam 08:00"'
      ].join('\n');
    }

    return 'Saya masih butuh detail tambahan untuk membuat automation ini. Mohon lengkapi informasi yang diminta.';
  }
}

export const automationClarificationService = new AutomationClarificationService();
