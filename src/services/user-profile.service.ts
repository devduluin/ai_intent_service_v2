import type { PipelineInput, ToolParam } from '../types';
import type {
  ProfileClass,
  ProfileUpsertInput,
  UserProfileContext,
  UserProfileEntry,
} from '../types/user-profile.types';
import { userProfileRepository } from '../repositories/user-profile.repository';
import { normalizeProfileKey } from '../utils/user-profile-key-normalizer.util';
import {
  isExplicitProfileStatementText,
  isPotentialDynamicProfileStatementText,
  parseUserProfileStatement,
} from '../utils/user-profile-statement.util';
import { appLogger } from '../utils/logger.util';
import { openAiService } from './openAi.service';

const ATTRIBUTE_KEY_MAP: Record<string, { key: string; profileClass: ProfileClass; isPii?: boolean }> = {
  name: { key: 'name', profileClass: 'identity', isPii: true },
  user_name: { key: 'name', profileClass: 'identity', isPii: true },
  email: { key: 'contact.email', profileClass: 'identity', isPii: true },
  phone: { key: 'contact.phone', profileClass: 'identity', isPii: true },
  company_id: { key: 'company_id', profileClass: 'tenant' },
  department: { key: 'department', profileClass: 'tenant' },
  role: { key: 'role', profileClass: 'tenant' },
  employee_id: { key: 'employee_id', profileClass: 'tenant', isPii: true },
  timezone: { key: 'timezone', profileClass: 'preference' },
  language: { key: 'preferred_language', profileClass: 'preference' },
  preferred_language: { key: 'preferred_language', profileClass: 'preference' },
  preferred_channel: { key: 'preferred_channel', profileClass: 'preference' },
};

export class UserProfileService {
  async upsert(userId: string, appName: string, input: ProfileUpsertInput): Promise<UserProfileEntry | null> {
    return userProfileRepository.upsert(userId, appName, input);
  }

  async upsertFromAttributes(input: PipelineInput): Promise<void> {
    const params = (input.attributes?.params || {}) as Record<string, unknown>;
    const flat = { ...(input.attributes || {}), ...params } as Record<string, unknown>;
    const entries = Object.entries(flat).filter(([key, value]) => ATTRIBUTE_KEY_MAP[key] && this.isMeaningful(value));

    for (const [attrKey, rawValue] of entries) {
      const mapping = ATTRIBUTE_KEY_MAP[attrKey];
      await userProfileRepository.upsert(input.user_id, input.app_name, {
        key: mapping.key,
        value: String(rawValue),
        confidence: 0.9,
        source: 'attributes',
        profileClass: mapping.profileClass,
        evidenceText: `attribute:${attrKey}`,
        isPii: mapping.isPii || this.isPiiKey(mapping.key),
      });
    }

    if (entries.length > 0) {
      appLogger.debug('[UserProfile] Attributes upserted', {
        userId: input.user_id,
        appName: input.app_name,
        count: entries.length,
        keys: entries.map(([key]) => key),
      });
    }
  }

  extractAndUpsertAsync(input: PipelineInput): void {
    void this.extractAndUpsert(input).catch(error => {
      appLogger.debug('[UserProfile] Async extraction failed', {
        userId: input.user_id,
        appName: input.app_name,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  async extractAndUpsert(input: PipelineInput): Promise<UserProfileEntry[]> {
    let facts = this.extractDeterministicFacts(input.text);
    if (facts.length === 0 && isPotentialDynamicProfileStatementText(input.text)) {
      facts = await this.extractDynamicFactsWithLLM(input.text);
    }

    const results: UserProfileEntry[] = [];

    for (const fact of facts) {
      const saved = await userProfileRepository.upsert(input.user_id, input.app_name, {
        ...fact,
        source: 'user',
        confidence: fact.confidence ?? 0.92,
        evidenceText: input.text,
      });
      if (saved) results.push(saved);
    }

    if (facts.length > 0) {
      appLogger.debug('[UserProfile] Deterministic facts extracted', {
        userId: input.user_id,
        appName: input.app_name,
        count: facts.length,
        keys: facts.map(fact => fact.key),
      });
    }

    return results;
  }

  isExplicitProfileStatement(text: string): boolean {
    return isExplicitProfileStatementText(text) || isPotentialDynamicProfileStatementText(text);
  }

  formatSavedMessage(entries: UserProfileEntry[]): string {
    if (entries.length === 0) {
      return 'Saya belum menemukan informasi profil yang bisa disimpan dari pesan itu.';
    }

    const rows = entries.map(entry => {
      const key = entry.valueLabel && entry.valueLabel !== 'default'
        ? `${entry.profileKey}.${entry.valueLabel}`
        : entry.profileKey;
      const value = entry.isPii ? this.mask(entry.profileValue) : entry.profileValue;
      return `- ${key}: ${value}`;
    });

    return ['Data profil sudah saya simpan.', '', ...rows, '', 'Anda bisa melihatnya lewat `/me`.'].join('\n');
  }

  async getContext(userId: string, appName: string): Promise<UserProfileContext> {
    return userProfileRepository.getContext(userId, appName);
  }

  async getAll(userId: string, appName: string): Promise<UserProfileEntry[]> {
    return userProfileRepository.getAll(userId, appName);
  }

  async collectForParams(userId: string, appName: string, params: ToolParam[]): Promise<Record<string, unknown>> {
    const collected: Record<string, unknown> = {};
    const entries = (await userProfileRepository.getAll(userId, appName, 200))
      .filter(entry => entry.confidence >= 0.7 && entry.status === 'active');

    for (const param of params) {
      const candidateKeys = this.buildProfileParamCandidateKeys(param.name);
      const usable = entries.filter(entry => candidateKeys.has(entry.profileKey));

      if (usable.length === 1) {
        collected[param.name] = usable[0].profileValue;
      } else if (usable.length > 1) {
        // Multiple matches: pick highest confidence
        const best = usable.reduce((a, b) => a.confidence > b.confidence ? a : b);
        collected[param.name] = best.profileValue;
      }
    }

    return collected;
  }

  async delete(userId: string, appName: string, keyText: string): Promise<number> {
    const normalized = normalizeProfileKey(keyText);
    const split = this.splitKeyLabel(normalized.key, normalized.valueLabel);
    return userProfileRepository.delete(userId, appName, split.key, split.valueLabel);
  }

  async forgetMe(userId: string, appName: string): Promise<number> {
    return userProfileRepository.forgetMe(userId, appName);
  }

  private extractDeterministicFacts(text: string): Array<ProfileUpsertInput & { confidence?: number }> {
    return parseUserProfileStatement(text).facts;
  }

  private async extractDynamicFactsWithLLM(text: string): Promise<Array<ProfileUpsertInput & { confidence?: number }>> {
    const prompt = [
      'Tugas: ekstrak fakta profil user dari satu pesan.',
      '',
      'Definisi fakta profil:',
      '- Informasi stabil tentang user: identitas, kontak, tenant/company, preferensi, relasi, kebiasaan.',
      '- Hanya ekstrak jika user secara eksplisit menyatakan fakta tentang dirinya.',
      '- Jangan ekstrak perintah operasional, pertanyaan, permintaan tool, atau data bisnis.',
      '',
      `Pesan user: ${JSON.stringify(text)}`,
      '',
      'Output HARUS JSON saja:',
      '{',
      '  "facts": [',
      '    {',
      '      "key": "snake_case_or_dot.notation_key",',
      '      "value": "nilai",',
      '      "valueLabel": "default",',
      '      "profileClass": "identity|tenant|preference|behavior|safety",',
      '      "isPii": false,',
      '      "confidence": 0.0',
      '    }',
      '  ]',
      '}',
      '',
      'Contoh:',
      'Input: "warna favorit saya biru" -> {"facts":[{"key":"preference.favorite_color","value":"biru","valueLabel":"default","profileClass":"preference","isPii":false,"confidence":0.86}]}',
      'Input: "cek kendaraan exit hari ini" -> {"facts":[]}'
    ].join('\n');

    try {
      const response = await openAiService.generateJson(prompt, { temperature: 0, num_predict: 500 });
      const parsed = JSON.parse(response) as { facts?: any[] };
      const facts = Array.isArray(parsed.facts) ? parsed.facts : [];

      return facts
        .map(fact => this.normalizeDynamicFact(fact))
        .filter((fact): fact is ProfileUpsertInput & { confidence?: number } => !!fact);
    } catch (error) {
      appLogger.debug('[UserProfile] Dynamic LLM extraction failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  private normalizeDynamicFact(fact: any): (ProfileUpsertInput & { confidence?: number }) | null {
    if (!fact || typeof fact !== 'object') return null;
    const key = this.normalizeDynamicKey(fact.key);
    const value = this.cleanDynamicValue(fact.value);
    const confidence = typeof fact.confidence === 'number'
      ? Math.max(0, Math.min(1, fact.confidence))
      : 0.5;

    if (!key || !this.isMeaningful(value) || confidence < 0.65) return null;

    const profileClass = this.normalizeProfileClass(fact.profileClass);
    return {
      key,
      value,
      valueLabel: this.cleanValueLabel(fact.valueLabel),
      source: 'user',
      confidence,
      profileClass,
      isPii: Boolean(fact.isPii) || this.isPiiKey(key),
    };
  }

  private normalizeDynamicKey(value: unknown): string {
    const raw = String(value || '').trim();
    if (!raw) return '';
    return raw
      .toLowerCase()
      .replace(/[^\p{L}\p{N}._\s-]/gu, ' ')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^\.+|\.+$/g, '')
      .trim();
  }

  private cleanDynamicValue(value: unknown): string {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  private cleanValueLabel(value: unknown): string | undefined {
    const cleaned = String(value || '').trim();
    return cleaned && cleaned !== 'default' ? cleaned : undefined;
  }

  private normalizeProfileClass(value: unknown): ProfileClass {
    const normalized = String(value || '').trim();
    return ['identity', 'tenant', 'preference', 'behavior', 'safety'].includes(normalized)
      ? normalized as ProfileClass
      : 'preference';
  }

  private isPiiKey(key: string): boolean {
    return /email|phone|name|employee|relationship|partner/i.test(key);
  }

  private isMeaningful(value: unknown): boolean {
    return value !== undefined && value !== null && String(value).trim() !== '';
  }

  private mask(value: string): string {
    const text = String(value || '');
    if (text.includes('@')) {
      const [name, domain] = text.split('@');
      return `${name.slice(0, 2)}***@${domain}`;
    }
    if (text.length > 5) return `${text.slice(0, 2)}***${text.slice(-2)}`;
    return '***';
  }

  private splitKeyLabel(key: string, valueLabel?: string): { key: string; valueLabel?: string } {
    if (valueLabel) return { key, valueLabel };
    for (const prefix of ['contact.email', 'contact.phone', 'relationship.partner']) {
      if (key.startsWith(`${prefix}.`)) {
        return { key: prefix, valueLabel: key.slice(prefix.length + 1) };
      }
    }
    return { key };
  }

  private buildProfileParamCandidateKeys(paramName: string): Set<string> {
    const raw = String(paramName || '').trim();
    const normalized = normalizeProfileKey(raw).key;
    const snake = raw
      .toLowerCase()
      .replace(/[^\p{L}\p{N}._\s-]/gu, ' ')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .trim();

    return new Set(
      [
        raw,
        normalized,
        snake,
        snake.replace(/\./g, '_'),
        snake.replace(/_/g, '.'),
      ].filter(Boolean)
    );
  }
}

export const userProfileService = new UserProfileService();
