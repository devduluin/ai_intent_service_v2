import type { EmotionResult } from '../utils/emotion-detector.util';

export class EmotionToneService {
  buildSystemInstruction(emotion?: EmotionResult | null): string {
    if (!emotion || emotion.emotion === 'neutral' || emotion.intensity < 0.6) return '';

    const lang = emotion.language || 'id';
    const pct = Math.round(emotion.intensity * 100);
    const instructions: Record<string, Record<string, string>> = {
      frustrated: {
        id: 'User sedang frustrasi. Akui dengan singkat, jangan defensif, jangan membuat janji eskalasi/tiket kecuali sistem memang menjalankannya. Fokus pada langkah konkret berikutnya.',
        en: 'The user is frustrated. Acknowledge briefly, do not be defensive, and do not promise escalation/tickets unless the system actually performs them. Focus on the next concrete step.',
      },
      confused: {
        id: 'User sedang bingung. Jelaskan lebih sederhana, gunakan contoh konkret, dan hindari jargon.',
        en: 'The user is confused. Explain more simply, use concrete examples, and avoid jargon.',
      },
      satisfied: {
        id: 'User puas. Beri apresiasi singkat. Jangan memperpanjang jawaban.',
        en: 'The user is satisfied. Give brief appreciation. Do not over-extend the answer.',
      },
      urgent: {
        id: 'User merasa urgent. Langsung ke hasil/langkah aksi. Jangan small talk. Tetap ikuti semua aturan safety, validasi, dan konfirmasi.',
        en: 'The user feels urgency. Go straight to result/action steps. Do not use small talk. Still follow all safety, validation, and confirmation rules.',
      },
    };

    const text = instructions[emotion.emotion]?.[lang] || instructions[emotion.emotion]?.id;
    if (!text) return '';

    return [
      'KONTEKS EMOSI USER:',
      text,
      `Emotion: ${emotion.emotion}`,
      `Intensity: ${pct}%`,
      'Batasan: emosi hanya mengubah tone/format jawaban, tidak boleh melewati confirmation, slot filling, permission, atau safety guard.',
    ].join('\n');
  }

  adaptShortMessage(message: string, emotion?: EmotionResult | null): string {
    const base = String(message || '').trim();
    if (!base || !emotion || emotion.emotion === 'neutral' || emotion.intensity < 0.65) return base;

    if (emotion.emotion === 'frustrated') {
      return `Saya paham ini mengganggu. ${base}`;
    }

    if (emotion.emotion === 'confused') {
      return `Saya sederhanakan. ${base}`;
    }

    if (emotion.emotion === 'urgent') {
      return base.replace(/^(baik|oke|halo)[,.\s]+/i, '').trim();
    }

    if (emotion.emotion === 'satisfied') {
      return `Senang bisa membantu. ${base}`;
    }

    return base;
  }
}

export const emotionToneService = new EmotionToneService();
