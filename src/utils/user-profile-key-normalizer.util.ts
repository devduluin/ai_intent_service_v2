const ALIASES: Array<{ patterns: RegExp[]; key: string; label?: string }> = [
  {
    key: 'name',
    patterns: [/nama\s+saya/i, /\bnama\b/i],
  },
  {
    key: 'contact.email',
    label: 'work',
    patterns: [/email\s+kantor/i, /email\s+kerja/i],
  },
  {
    key: 'contact.email',
    label: 'personal',
    patterns: [/email\s+pribadi/i, /email\s+personal/i],
  },
  {
    key: 'contact.email',
    patterns: [/\bemail\b/i, /\be\s*mail\b/i, /\bemal\b/i, /\bimel\b/i, /surat\s+elektronik/i],
  },
  {
    key: 'company_id',
    patterns: [/\bcompany\s*id\b/i, /\bcompany_id\b/i, /\bid\s+perusahaan\b/i],
  },
  {
    key: 'preference.hobby',
    patterns: [/\bhobi\b/i, /\bhoby\b/i, /\bhobby\b/i],
  },
  {
    key: 'contact.phone',
    patterns: [/\bnomor\b/i, /\btelepon\b/i, /\bphone\b/i, /\bwhatsapp\b/i, /\bwa\b/i],
  },
  {
    key: 'relationship.partner',
    patterns: [/\bpacar\b/i, /\bpasangan\b/i, /\bpartner\b/i],
  },
  {
    key: 'preferred_language',
    patterns: [/\bbahasa\b/i, /language/i],
  },
  {
    key: 'timezone',
    patterns: [/\btimezone\b/i, /zona\s+waktu/i],
  },
];

export interface NormalizedProfileKey {
  key: string;
  valueLabel?: string;
}

export function normalizeProfileKey(textOrKey: string): NormalizedProfileKey {
  const value = String(textOrKey || '').trim();
  const normalized = value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}._\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (normalized.includes('.')) {
    return { key: normalized.replace(/\s+/g, '_') };
  }

  for (const alias of ALIASES) {
    if (alias.patterns.some(pattern => pattern.test(normalized))) {
      return { key: alias.key, valueLabel: alias.label };
    }
  }

  return {
    key: normalized
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
  };
}

export function compactProfileDisplayKey(key: string, valueLabel = 'default'): string {
  return valueLabel && valueLabel !== 'default'
    ? `${key}.${valueLabel}`
    : key;
}
