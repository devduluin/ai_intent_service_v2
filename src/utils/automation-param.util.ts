import type { AutomationJobType } from '../types/automation.types';
import {
  isGenericDesireText,
  normalizeIntentText,
  stripGenericDesireWords
} from './text-intent-cleanup.util';

export function normalizeAutomationTypeLabel(value: unknown): AutomationJobType | undefined {
  const normalized = normalizeAutomationText(value);
  if (!normalized) return undefined;

  if (/^(reminder|pengingat)$/.test(normalized)) return 'reminder';
  if (/^(scheduled workflow|workflow terjadwal|workflow berkala|scheduled workflow terjadwal|jadwal workflow)$/.test(normalized)) {
    return 'scheduled_workflow';
  }
  if (/^(conditional alert|alert bersyarat|monitoring kondisi|condition alert)$/.test(normalized)) {
    return 'conditional_alert';
  }

  return undefined;
}

export function isGenericAutomationGoal(value: unknown): boolean {
  const normalized = normalizeAutomationText(value);
  if (!normalized) return true;

  return /^(buat\s+)?(automation|automasi)$/.test(normalized) ||
    /^(buat|bikin|create)\s+(reminder|pengingat|scheduled workflow|workflow terjadwal|conditional alert|alert bersyarat)$/.test(normalized) ||
    isGenericDesireText(normalized) ||
    /^(saya\s+|aku\s+|i\s+)?(ingin|mau|pengen|butuh|perlu|want|wanna|need)\s+(buat|bikin|create)?\s*(automation|automasi|reminder|pengingat|scheduled workflow|workflow terjadwal|conditional alert|alert bersyarat)?$/.test(normalized) ||
    normalizeAutomationTypeLabel(normalized) !== undefined;
}

export function cleanAutomationGoalText(value: unknown): string | undefined {
  const normalized = stripGenericDesireWords(String(value || ''))
    .replace(/\b(klarifikasi user|clarification user)\s*:\s*/gi, ' ')
    .replace(/\b(tolong|please|mohon)\b/gi, ' ')
    .replace(/\b(buat|create|bikin)\b/gi, ' ')
    .replace(/\b(automation|automasi)\b/gi, ' ')
    .replace(/\b(reminder|pengingat|scheduled workflow|workflow terjadwal|conditional alert|alert bersyarat)\b/gi, ' ')
    .replace(/\b(ingatkan saya|ingatkan|remind me|jadwalkan|schedule|setiap|tiap|pantau|monitor)\b/gi, ' ')
    .replace(/\b(saya|aku|me|untuk|about|soal|bahwa)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return isGenericAutomationGoal(normalized) ? undefined : normalized;
}

function normalizeAutomationText(value: unknown): string {
  return normalizeIntentText(value).replace(/[/.]+/g, ' ').replace(/\s+/g, ' ').trim();
}
