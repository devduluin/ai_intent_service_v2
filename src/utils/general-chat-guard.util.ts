// ============================================================
// General Chat Guard
// ============================================================
// Pre-LLM guard that blocks CUD action queries from reaching
// the LLM. Returns a guided response or null (let LLM handle).
// Also injects user profile + emotion context into system prompt.
// ============================================================

import { detectCudAction } from './cud-action-detector.util';
import { detectEmotion } from './emotion-detector.util';
import type { EmotionResult } from './emotion-detector.util';
import type { UserProfileContext } from '../types/user-profile.types';
import { readFileSync } from 'fs';
import { join } from 'path';
import { emotionToneService } from '../services/emotion-tone.service';

interface GuardContext {
  hasPendingConfirmation?: boolean;
  hasPendingSlot?: boolean;
  hasActiveGodMode?: string;
  userProfile?: UserProfileContext;
  emotion?: import('./emotion-detector.util').EmotionResult;
}

/**
 * Run guard checks before LLM call.
 * Returns a response string if blocked, or null to proceed.
 */
export function applyGeneralChatGuard(text: string, context?: GuardContext): string | null {
  // 1. CUD Action Block (hard guard, pre-LLM)
  const cudResult = detectCudAction(text, {
    hasPendingConfirmation: context?.hasPendingConfirmation,
    hasPendingSlot: context?.hasPendingSlot,
    hasActiveGodMode: context?.hasActiveGodMode,
  });

  if (cudResult.isCudAction && cudResult.suggestedResponse) {
    return cudResult.suggestedResponse;
  }

  // 2. No guard triggered â†’ let LLM handle (emotion enriches prompt, see buildEmotionPromptSection)
  return null;
}

/**
 * Build emotion context section for system prompt.
 * Injects user emotional state so LLM can adapt tone naturally.
 */
export function buildEmotionPromptSection(text: string): string {
  const emotion = detectEmotion(text);
  const instruction = emotionToneService.buildSystemInstruction(emotion);
  return instruction ? `\n\n${instruction}\n` : '';
}

/**
 * Build user profile section for system prompt.
 * Only includes high-confidence (â‰¥0.80) non-PII fields.
 * Max 8 fields to keep prompt size manageable.
 */
export function buildProfilePromptSection(profile?: UserProfileContext): string {
  if (!profile) return '';

  const lines: string[] = [];

  // Identity
  if (profile.identity?.name) lines.push(`- Nama: ${profile.identity.name} (sumber utama; abaikan nama lain dari attributes/history jika berbeda)`);
  if (profile.identity?.role || profile.tenant?.role) {
    lines.push(`- Role: ${profile.identity?.role || profile.tenant?.role}`);
  }

  // Tenant
  // Do not inject technical identifiers like company_id into free-form chat.
  // They remain available through explicit user_profile_recall questions.
  if (profile.tenant?.department) lines.push(`- Departemen: ${profile.tenant.department}`);

  // Preferences
  if (profile.preferences?.preferred_language) {
    lines.push(`- Bahasa: ${profile.preferences.preferred_language}`);
  }
  if (profile.preferences?.timezone) {
    lines.push(`- Timezone: ${profile.preferences.timezone}`);
  }
  if (profile.preferences?.format_preference) {
    lines.push(`- Format: ${profile.preferences.format_preference}`);
  }

  if (lines.length === 0) return '';

  // Cap at 8 fields
  const capped = lines.slice(0, 8);

  return '\n\nPROFIL USER:\n' + capped.join('\n') + '\n\nGunakan informasi profil di atas jika relevan dengan pertanyaan user. Jangan menyebut ID teknis atau identifier internal kecuali user bertanya langsung tentang field tersebut.';
}

/**
 * Build strict CUD prohibition section for system prompt.
 */
export function buildCudProhibitionPrompt(): string {
  return `
LARANGAN KERAS â€” ANDA TIDAK BOLEH:
1. Mengkonfirmasi atau mengeksekusi aksi apapun (hapus, simpan, ubah, batalkan, exit, buat, jalankan, dll)
2. Mengatakan "saya sudah menghapus...", "saya sudah menyimpan...", "saya sudah membatalkan..."
3. Berpura-pura melakukan perubahan data
4. Mengonfirmasi penghapusan/pembatalan/penyimpanan

Yang BOLEH Anda lakukan:
- Menjawab pertanyaan dengan informasi yang tersedia
- Menjelaskan cara menggunakan fitur
- Memberikan saran dan rekomendasi
- Untuk keluhan pendek atau ekspresi seperti "aneh", jawab singkat dan bantu arahkan; jangan menjelaskan larangan aksi kecuali user meminta aksi.

Jika user meminta aksi yang tidak bisa Anda lakukan, katakan:
"Saya tidak bisa melakukan aksi itu. Ada yang bisa saya bantu dengan pertanyaan atau informasi?"
`.trim();
}

let _identityCache: string | null = null;

/**
 * Build VIPER identity section for system prompt.
 * Cached in memory â€” read once from VIPER-IDENTITY.md.
 * Only inject when query is about identity/self-awareness.
 */
export function buildIdentityPromptSection(userText?: string): string {
  if (!userText) return '';
  if (!isIdentityQuestion(userText)) return '';

  if (!_identityCache) {
    try {
      _identityCache = readFileSync(join(__dirname, '..', '..', 'VIPER-IDENTITY.md'), 'utf-8');
    } catch {
      _identityCache = '';
    }
  }

  if (!_identityCache) return '';

  return '\n\nIDENTITAS KAMU :\n' + _identityCache + '\n\nGunakan informasi di atas untuk menjawab pertanyaan user tentang identitas, arsitektur, desain, atau kemampuanmu. Jawab dengan natural dan personal.';
}

function isIdentityQuestion(text: string): boolean {
  const n = text
    .toLowerCase()
    .replace(/[\/_-]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return (
    /^(siapa|apa)\s+(anda|kamu|viper|ini)$/i.test(n) ||
    /^(kamu|anda)\s+(itu|ini)?\s*(siapa|apa)$/i.test(n) ||
    /^(who are you|what are you|who is this|what is this)$/i.test(n) ||
    /^(apakah\s+)?(anda|kamu)\s+(manusia|robot|ai|bot|asli|program)$/i.test(n) ||
    /^are you (human|real|a robot|ai|a bot)$/i.test(n) ||
    /^(bagaimana|gimana)\s+(anda|kamu|viper)\s+(bekerja|kerja|didesain|dibangun|dibuat|berfungsi|arsitektur|berpikir|berfikir)$/i.test(n) ||
    /^bagaimana\s+cara\s+(anda|kamu|viper)\s+(berpikir|berfikir|bekerja|think|work|reason)$/i.test(n) ||
    /^how (do you work|are you designed|are you built)$/i.test(n) ||
    /^(jelaskan|jelasin|ceritakan)\s+(dirimu|tentang kamu|tentang anda|tentang viper|arsitekturmu|arsitektur anda)$/i.test(n) ||
    /^(explain|describe|tell me about)\s+(yourself|your architecture)$/i.test(n) ||
    /^(kenalan dong|introduce yourself|perkenalkan dirimu|ceritakan tentang dirimu)$/i.test(n)
  );
}

