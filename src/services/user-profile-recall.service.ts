import type { UserProfileEntry, UserProfileRecallQuery, UserProfileRecallResult } from '../types/user-profile.types';
import { userProfileRepository } from '../repositories/user-profile.repository';

export class UserProfileRecallService {
  async recall(
    userId: string,
    appName: string,
    query: UserProfileRecallQuery
  ): Promise<UserProfileRecallResult> {
    const byRequestedKeys = query.requestedKeys?.length
      ? await userProfileRepository.findByKeys(userId, appName, query.requestedKeys)
      : [];

    if (byRequestedKeys.length > 0) {
      return this.buildResult(query.userText, byRequestedKeys.filter(fact => fact.status === 'active'));
    }

    if (this.isSelfIdentityQuestion(query.userText)) {
      const identityFacts = await userProfileRepository.findByKeys(userId, appName, ['name']);
      const activeIdentityFacts = identityFacts.filter(fact => fact.status === 'active');
      if (activeIdentityFacts.length > 0) {
        return this.buildResult(query.userText, activeIdentityFacts);
      }
    }

    // Extract search phrases from user question
    const phrases = this.extractSearchPhrases(query.userText);

    // Dynamic: search DB across evidence_text, profile_value, profile_key
    const facts = phrases.length > 0
      ? await userProfileRepository.searchByPhrases(userId, appName, phrases, 10)
      : [];

    const activeFacts = facts.filter(fact => fact.status === 'active');
    return this.buildResult(query.userText, activeFacts);
  }

  private buildResult(userText: string, activeFacts: UserProfileEntry[]): UserProfileRecallResult {
    if (activeFacts.length === 0) {
      return {
        found: false,
        answerable: false,
        facts: [],
        missingReason: 'Tidak ada data profil yang cocok.',
      };
    }

    if (this.isDurationQuestion(userText)) {
      const withStart = activeFacts.filter(fact => fact.validFrom);
      return {
        found: true,
        answerable: withStart.length > 0,
        facts: activeFacts,
        missingReason: withStart.length > 0 ? undefined : 'Tanggal mulai belum tersimpan.',
      };
    }

    return {
      found: true,
      answerable: true,
      facts: activeFacts,
    };
  }

  format(result: UserProfileRecallResult): string {
    if (!result.found) {
      return 'Saya belum menemukan data itu di profil Anda.';
    }

    if (!result.answerable && result.missingReason) {
      const facts = this.formatFacts(result.facts);
      return facts
        ? `${facts}\n\nNamun, ${result.missingReason.toLowerCase()}`
        : result.missingReason;
    }

    return this.formatFacts(result.facts) || 'Saya menemukan datanya, tetapi belum bisa menampilkannya dengan aman.';
  }

  /**
   * Extract search phrases from user question text.
   * "apakah anda tahu warna favorit saya?" → ["warna favorit"]
   * "email saya apa?" → ["email"]
   * "apa hobi saya?" → ["hobi"]
   */
  private extractSearchPhrases(text: string): string[] {
    const normalized = this.normalize(text);
    const phrases: string[] = [];

    if (this.isSelfIdentityQuestion(normalized)) {
      phrases.push('name', 'nama');
    }

    // Pattern: "tahu/tentang [phrase] saya/ku?"
    const knowMatch = normalized.match(/(?:tahu|tentang|tau|know|about)\s+(.+?)(?:\s+(?:saya|aku|ku|my))?\s*[?.!]*$/);
    if (knowMatch?.[1]) {
      const cleaned = this.cleanPhrase(knowMatch[1]);
      if (cleaned) phrases.push(cleaned);
    }

    // Pattern: "[key] saya apa/siapa?"
    const keyMatch = normalized.match(/^(.+?)\s+(?:saya|aku|ku|my)\s+(?:apa|siapa|gimana|bagaimana)\s*[?.!]*$/);
    if (keyMatch?.[1]) {
      const cleaned = this.cleanPhrase(keyMatch[1]);
      if (cleaned) phrases.push(cleaned);
    }

    // Pattern: "apa/siapa [phrase] saya?"
    const whatMatch = normalized.match(/(?:apa|siapa|what|who|gimana|bagaimana)\s+(.+?)(?:\s+(?:saya|aku|ku|my))?\s*[?.!]*$/);
    if (whatMatch?.[1]) {
      const cleaned = this.cleanPhrase(whatMatch[1]);
      if (cleaned) phrases.push(cleaned);
    }

    // Pattern: "[phrase] saya?"
    const possessiveMatch = normalized.match(/^(.+?)\s+(?:saya|aku|ku|my)\s*[?.!]*$/);
    if (possessiveMatch?.[1]) {
      const cleaned = this.cleanPhrase(possessiveMatch[1]);
      if (cleaned && cleaned.split(/\s+/).length <= 4) phrases.push(cleaned);
    }

    return [...new Set(phrases)];
  }

  private isSelfIdentityQuestion(text: string): boolean {
    const normalized = this.normalize(text);
    return /^(siapa\s+(saya|aku)|who\s+am\s+i)$/i.test(normalized);
  }

  private cleanPhrase(raw: string): string {
    return raw
      .replace(/\b(apa|apakah|anda|kamu|yang|itu|ini|adalah|dari|saya|aku|ku|my)\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private normalize(text: string): string {
    return String(text || '')
      .toLowerCase()
      .replace(/[\/_-]+/g, ' ')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private formatFacts(facts: UserProfileEntry[]): string {
    if (facts.length === 1) {
      const fact = facts[0];
      return `${this.label(fact)}: ${fact.profileValue}`;
    }

    return [
      'Saya menemukan beberapa data profil:',
      '',
      ...facts.map((fact, index) => `${index + 1}. ${this.label(fact)}: ${fact.profileValue}`),
    ].join('\n');
  }

  private label(fact: UserProfileEntry): string {
    const base = fact.profileKey
      .replace(/^contact\./, '')
      .replace(/^relationship\./, '')
      .replace(/^preference\./, '')
      .replace(/[._-]+/g, ' ');
    return fact.valueLabel && fact.valueLabel !== 'default'
      ? `${this.title(base)} (${fact.valueLabel})`
      : this.title(base);
  }

  private title(value: string): string {
    return value
      .split(/\s+/)
      .filter(Boolean)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  private isDurationQuestion(text: string): boolean {
    return /\b(berapa lama|sejak kapan|how long|since when)\b/i.test(text);
  }
}

export const userProfileRecallService = new UserProfileRecallService();
