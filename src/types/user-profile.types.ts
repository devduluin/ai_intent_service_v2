export const STANDARD_PROFILE_KEYS = [
  'name',
  'email',
  'phone',
  'company_id',
  'department',
  'role',
  'employee_id',
  'timezone',
  'language',
  'format_preference',
  'contact.email',
  'contact.phone',
  'relationship.partner',
] as const;

export type ProfileKey = typeof STANDARD_PROFILE_KEYS[number] | string;
export type ProfileSource = 'user' | 'attributes' | 'inferred' | 'system';
export type ProfileClass = 'identity' | 'tenant' | 'preference' | 'behavior' | 'safety';
export type ProfileStatus = 'active' | 'replaced' | 'deleted' | 'disputed';
export type ProfileValueType = 'string' | 'number' | 'boolean' | 'json' | 'date';

export interface UserProfileEntry {
  id: string;
  userId: string;
  appName: string;
  profileKey: ProfileKey;
  valueLabel: string;
  profileValue: string;
  valueType: ProfileValueType;
  confidence: number;
  source: ProfileSource;
  profileClass: ProfileClass;
  status: ProfileStatus;
  evidenceHash?: string | null;
  evidenceText?: string | null;
  lastConfirmedAt?: Date | null;
  validFrom?: Date | null;
  validTo?: Date | null;
  expiresAt?: Date | null;
  isPii: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProfileUpsertInput {
  key: ProfileKey;
  value: string;
  valueLabel?: string;
  valueType?: ProfileValueType;
  confidence: number;
  source: ProfileSource;
  profileClass?: ProfileClass;
  status?: ProfileStatus;
  evidenceText?: string;
  evidenceHash?: string;
  lastConfirmedAt?: Date;
  validFrom?: Date;
  validTo?: Date;
  ttlDays?: number;
  expiresAt?: Date;
  isPii?: boolean;
}

export interface UserProfileContext {
  identity: Record<string, string>;
  tenant: Record<string, string>;
  preferences: Record<string, string>;
  behaviorHints: Record<string, string>;
  safety: Record<string, string>;
}

export interface UserProfileRecallQuery {
  userText: string;
  requestedKeys?: string[];
  includeHistory?: boolean;
  includeEvidence?: boolean;
}

export interface UserProfileRecallResult {
  found: boolean;
  answerable: boolean;
  facts: UserProfileEntry[];
  missingReason?: string;
}
