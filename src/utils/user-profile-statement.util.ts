import type { ProfileClass, ProfileUpsertInput } from '../types/user-profile.types';

export interface UserProfileFieldDefinition {
  key: string;
  profileClass: ProfileClass;
  isPii?: boolean;
  labels: string[];
  valueLabels?: Record<string, string[]>;
  valuePattern?: string;
  confidence?: number;
}

export interface UserProfileStatementParseResult {
  isStatement: boolean;
  facts: Array<ProfileUpsertInput & { confidence?: number }>;
}

const VALUE_PATTERN_DEFAULT = String.raw`(.{1,160})`;
const VALUE_PATTERN_EMAIL = String.raw`([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})`;
const VALUE_PATTERN_ID = String.raw`([A-Za-z0-9_-]{3,120})`;

export const BASE_PROFILE_FIELDS: UserProfileFieldDefinition[] = [
  {
    key: 'name',
    profileClass: 'identity',
    isPii: true,
    labels: ['nama', 'name'],
    valuePattern: String.raw`([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s.'-]{1,80})`,
    confidence: 0.95,
  },
  {
    key: 'contact.email',
    profileClass: 'identity',
    isPii: true,
    labels: ['email', 'e-mail', 'e mail', 'mail', 'emal', 'imel', 'gmail', 'surel', 'alamat surel', 'mailku'],
    valuePattern: VALUE_PATTERN_EMAIL,
    valueLabels: {
      work: ['kantor', 'kerja', 'work', 'office'],
      personal: ['pribadi', 'personal'],
    },
    confidence: 0.96,
  },
  {
    key: 'contact.phone',
    profileClass: 'identity',
    isPii: true,
    labels: ['nomor telepon', 'nomor hp', 'nomor wa', 'telepon', 'phone', 'whatsapp', 'wa', 'nomor'],
    valuePattern: String.raw`([+0-9][0-9\s-]{5,24})`,
    confidence: 0.94,
  },
  {
    key: 'company_id',
    profileClass: 'tenant',
    labels: ['company_id', 'company id', 'id perusahaan'],
    valuePattern: VALUE_PATTERN_ID,
    confidence: 0.94,
  },
  {
    key: 'relationship.partner',
    profileClass: 'identity',
    isPii: true,
    labels: ['pacar', 'pasangan', 'partner'],
    valuePattern: String.raw`([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s.'-]{1,80})`,
    confidence: 0.9,
  },
  {
    key: 'preference.music.favorite_genre',
    profileClass: 'preference',
    labels: ['musik favorit', 'genre musik', 'favorite music', 'music genre'],
    valuePattern: VALUE_PATTERN_DEFAULT,
    confidence: 0.86,
  },
  {
    key: 'preference.hobby',
    profileClass: 'preference',
    labels: ['hobi', 'hoby', 'hobby'],
    valuePattern: VALUE_PATTERN_DEFAULT,
    confidence: 0.86,
  },
  {
    key: 'preference.favorite_color',
    profileClass: 'preference',
    labels: ['warna favorit', 'warna kesukaan', 'favorite color', 'warna faforit', 'warna'],
    valuePattern: VALUE_PATTERN_DEFAULT,
    confidence: 0.85,
  },
  {
    key: 'timezone',
    profileClass: 'preference',
    labels: ['timezone', 'zona waktu'],
    valuePattern: String.raw`([A-Za-z_/+-]{2,80})`,
    confidence: 0.88,
  },
  {
    key: 'preferred_language',
    profileClass: 'preference',
    labels: ['bahasa', 'language'],
    valuePattern: String.raw`([A-Za-zÀ-ÿ\s-]{2,40})`,
    confidence: 0.88,
  },
];

const OWNER_PATTERNS = [String.raw`saya`, String.raw`aku`, String.raw`ku`, String.raw`my`];
const COPULA_PATTERN = String.raw`(?:adalah|namanya|is|=|:)?`;

export function isExplicitProfileStatementText(text: string): boolean {
  return parseUserProfileStatement(text).isStatement;
}

export function isUserProfileQuestionText(
  text: string,
  fields: UserProfileFieldDefinition[] = BASE_PROFILE_FIELDS
): boolean {
  const normalized = normalizeText(text);
  if (!normalized) return false;

  const hasOwnerSignal = containsAnyPhrase(normalized, ['saya', 'aku', 'ku', 'my', 'profil', 'profile']) ||
    /\b\p{L}{3,}ku\b/u.test(normalized);
  if (!hasOwnerSignal) return false;

  const hasQuestionSignal = containsAnyPhrase(normalized, [
    'apa',
    'siapa',
    'berapa',
    'berapa lama',
    'sejak kapan',
    'tahu',
    'what',
    'who',
    'when',
    'how long',
  ]);
  if (!hasQuestionSignal && !containsAnyPhrase(normalized, ['profil saya', 'profile saya', 'my profile'])) {
    return false;
  }

  const profileLabels = fields.flatMap(field => [
    ...field.labels,
    ...Object.values(field.valueLabels || {}).flat(),
  ]);

  if (containsAnyPhrase(normalized, ['siapa saya', 'siapa aku', 'who am i'])) {
    return true;
  }

  return containsAnyPhrase(normalized, profileLabels) ||
    containsAnyPhrase(normalized, ['profil saya', 'profile saya', 'data saya', 'my profile']);
}

export function isPotentialDynamicProfileStatementText(text: string): boolean {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  if (isUserProfileQuestionText(text)) return false;
  if (/\b(cek|tampilkan|lihat|buat|hapus|jalankan|bandingkan|analisa|export|download|ingatkan|jadwalkan)\b/i.test(normalized)) {
    return false;
  }

  return [
    /\b[\p{L}\p{N}\s]{3,60}\s+(?:saya|aku|ku|my)\s+(?:adalah|is|=|:)?\s*[\p{L}\p{N}@._+\-\s]{2,120}$/u,
    /\b(?:saya|aku|my)\s+(?:punya|memiliki|have|has)\s+[\p{L}\p{N}\s]{3,60}\s+(?:adalah|is|=|:)?\s*[\p{L}\p{N}@._+\-\s]{2,120}$/u,
  ].some(pattern => pattern.test(normalized));
}

export function parseUserProfileStatement(
  text: string,
  fields: UserProfileFieldDefinition[] = BASE_PROFILE_FIELDS
): UserProfileStatementParseResult {
  const value = String(text || '').trim();
  const facts: Array<ProfileUpsertInput & { confidence?: number }> = [];

  if (!value) return { isStatement: false, facts };

  for (const field of fields) {
    facts.push(...parseField(value, field));
  }

  const deduped = dedupeFacts(facts).filter(fact => isMeaningful(fact.value));
  return { isStatement: deduped.length > 0, facts: deduped };
}

function parseField(text: string, field: UserProfileFieldDefinition): Array<ProfileUpsertInput & { confidence?: number }> {
  const facts: Array<ProfileUpsertInput & { confidence?: number }> = [];
  const labelPattern = buildLabelPattern(field);
  const ownerPattern = OWNER_PATTERNS.join('|');
  const valuePattern = field.valuePattern || VALUE_PATTERN_DEFAULT;
  const valueLabelPattern = buildValueLabelPattern(field);
  const optionalValueLabel = valueLabelPattern ? String.raw`(?:\s+(?<valueLabel>${valueLabelPattern}))?` : '';

  const patterns = [
    new RegExp(String.raw`\b(?:${labelPattern})${optionalValueLabel}\s+(?:${ownerPattern})\s+${COPULA_PATTERN}\s*${valuePattern}`, 'giu'),
    new RegExp(String.raw`\b(?:${ownerPattern})\s+(?:punya|memiliki|have|has)?\s*(?:${labelPattern})${optionalValueLabel}\s+${COPULA_PATTERN}\s*${valuePattern}`, 'giu'),
    field.key === 'name'
      ? new RegExp(String.raw`\b(?:${ownerPattern})\s+(?:bernama|dipanggil)\s+${valuePattern}`, 'giu')
      : null,
  ].filter((pattern): pattern is RegExp => !!pattern);

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const rawValue = findCapturedValue(match);
      if (!rawValue) continue;

      const rawValueLabel = (match.groups?.valueLabel || '').toLowerCase();
      const valueLabel = resolveValueLabel(field, rawValueLabel, text, match.index || 0);

      facts.push({
        key: field.key,
        valueLabel,
        value: cleanValue(rawValue),
        source: 'user',
        confidence: field.confidence || 0.9,
        profileClass: field.profileClass,
        isPii: field.isPii || false,
        validFrom: field.key === 'relationship.partner' ? new Date() : undefined,
      });
    }
  }

  return dedupeFacts(facts);
}

function buildLabelPattern(field: UserProfileFieldDefinition): string {
  return field.labels.map(escapeRegex).sort((a, b) => b.length - a.length).join('|');
}

function buildValueLabelPattern(field: UserProfileFieldDefinition): string {
  const labels = Object.values(field.valueLabels || {}).flat();
  return labels.length > 0
    ? labels.map(escapeRegex).sort((a, b) => b.length - a.length).join('|')
    : '';
}

function resolveValueLabel(field: UserProfileFieldDefinition, matchedLabel: string, text: string, matchIndex: number): string | undefined {
  for (const [valueLabel, aliases] of Object.entries(field.valueLabels || {})) {
    if (matchedLabel && aliases.some(alias => alias.toLowerCase() === matchedLabel)) return valueLabel;
  }

  const nearby = text.slice(Math.max(0, matchIndex - 40), matchIndex + 80).toLowerCase();
  for (const [valueLabel, aliases] of Object.entries(field.valueLabels || {})) {
    if (aliases.some(alias => nearby.includes(alias.toLowerCase()))) return valueLabel;
  }

  return undefined;
}

function findCapturedValue(match: RegExpMatchArray): string | null {
  for (let i = match.length - 1; i >= 1; i--) {
    const value = match[i];
    if (isMeaningful(value) && !isKnownNonValue(value)) return value;
  }
  return null;
}

function isKnownNonValue(value: string): boolean {
  const normalized = value.toLowerCase().trim();
  if (OWNER_PATTERNS.includes(normalized)) return true;
  const valueLabels = BASE_PROFILE_FIELDS.flatMap(field => Object.values(field.valueLabels || {}).flat());
  return valueLabels.some(label => label.toLowerCase() === normalized);
}

function dedupeFacts(facts: Array<ProfileUpsertInput & { confidence?: number }>): Array<ProfileUpsertInput & { confidence?: number }> {
  const map = new Map<string, ProfileUpsertInput & { confidence?: number }>();
  for (const fact of facts) map.set(`${fact.key}:${fact.valueLabel || 'default'}:${fact.value}`, fact);
  return [...map.values()];
}

function cleanValue(value: string): string {
  return String(value || '').replace(/[?.!,;:]+$/g, '').replace(/\s+/g, ' ').trim();
}

function isMeaningful(value: unknown): boolean {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, String.raw`\s+`);
}

function normalizeText(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[\/_-]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsAnyPhrase(normalizedText: string, phrases: string[]): boolean {
  return phrases.some(phrase => containsPhrase(normalizedText, phrase));
}

function containsPhrase(normalizedText: string, phrase: string): boolean {
  const normalizedPhrase = normalizeText(phrase);
  if (!normalizedText || !normalizedPhrase || normalizedPhrase.length < 2) return false;
  const pattern = new RegExp(`(^|\\s)${escapeRegex(normalizedPhrase)}(\\s|$)`, 'i');
  return pattern.test(normalizedText);
}
