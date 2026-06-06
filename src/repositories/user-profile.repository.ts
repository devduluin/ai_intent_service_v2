import { Op } from 'sequelize';
import { createHash } from 'crypto';
import { UserProfileModel } from '../database/models/user-profile.model';
import type {
  ProfileClass,
  ProfileSource,
  ProfileStatus,
  ProfileUpsertInput,
  ProfileValueType,
  UserProfileContext,
  UserProfileEntry,
} from '../types/user-profile.types';
import { appLogger } from '../utils/logger.util';

const SOURCE_PRIORITY: Record<ProfileSource, number> = {
  inferred: 1,
  attributes: 2,
  system: 3,
  user: 4,
};

export class UserProfileRepository {
  async upsert(userId: string, appName: string, input: ProfileUpsertInput): Promise<UserProfileEntry | null> {
    const key = input.key;
    const valueLabel = input.valueLabel || 'default';
    const existing = await UserProfileModel.findOne({
      where: {
        user_id: userId,
        app_name: appName,
        profile_key: key,
        value_label: valueLabel,
      },
    });

    if (existing && !this.canOverwrite(existing, input)) {
      appLogger.debug('[UserProfileRepository] Upsert skipped by confidence/source policy', {
        userId,
        appName,
        profileKey: key,
        valueLabel,
        existingSource: existing.source,
        incomingSource: input.source,
      });
      return null;
    }

    const expiresAt = input.expiresAt || (input.ttlDays
      ? new Date(Date.now() + input.ttlDays * 24 * 60 * 60 * 1000)
      : null);

    const payload = {
      user_id: userId,
      app_name: appName,
      profile_key: key,
      value_label: valueLabel,
      profile_value: input.value,
      value_type: input.valueType || 'string',
      confidence: input.confidence,
      source: input.source,
      profile_class: input.profileClass || 'identity',
      status: input.status || 'active',
      evidence_hash: input.evidenceHash || this.hash(input.evidenceText || input.value),
      evidence_text: input.evidenceText || null,
      last_confirmed_at: input.lastConfirmedAt || (input.source === 'user' ? new Date() : null),
      valid_from: input.validFrom || null,
      valid_to: input.validTo || null,
      expires_at: expiresAt,
      is_pii: input.isPii ?? false,
    };

    const record = existing
      ? await existing.update(payload)
      : await UserProfileModel.create(payload);

    return this.toEntry(record);
  }

  async get(
    userId: string,
    appName: string,
    key: string,
    valueLabel?: string
  ): Promise<UserProfileEntry | null> {
    const where: any = this.activeWhere(userId, appName);
    where.profile_key = key;
    if (valueLabel) where.value_label = valueLabel;

    const record = await UserProfileModel.findOne({
      where,
      order: [['confidence', 'DESC'], ['updated_at', 'DESC']],
    });

    return record ? this.toEntry(record) : null;
  }

  async findByKeys(userId: string, appName: string, keys: string[]): Promise<UserProfileEntry[]> {
    if (keys.length === 0) return [];
    const rows = await UserProfileModel.findAll({
      where: {
        ...this.activeWhere(userId, appName),
        profile_key: { [Op.in]: keys },
      },
      order: [['profile_key', 'ASC'], ['value_label', 'ASC'], ['confidence', 'DESC']],
    });
    return rows.map(row => this.toEntry(row));
  }

  async search(userId: string, appName: string, text: string, limit = 20): Promise<UserProfileEntry[]> {
    const normalized = String(text || '').trim();
    // Also generate a normalized key variant for matching:
    // "warna favorit" → "favorite_color" for matching "preference.favorite_color"
    const normalizedKey = normalized
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^\p{L}\p{N}_]/gu, '');
    const rows = await UserProfileModel.findAll({
      where: {
        ...this.activeWhere(userId, appName),
        [Op.or]: [
          { profile_key: { [Op.iLike]: `%${normalized}%` } },
          { profile_key: { [Op.iLike]: `%${normalizedKey}%` } },
          { value_label: { [Op.iLike]: `%${normalized}%` } },
          { profile_value: { [Op.iLike]: `%${normalized}%` } },
        ],
      },
      order: [['confidence', 'DESC'], ['updated_at', 'DESC']],
      limit,
    });
    return rows.map(row => this.toEntry(row));
  }

  /**
   * Search across evidence_text, profile_value, and profile_key using phrases.
   * Fully dynamic — no dependency on hardcoded field definitions.
   * "warna favorit" matches evidence_text "warna favorite saya merah".
   */
  async searchByPhrases(userId: string, appName: string, phrases: string[], limit = 10): Promise<UserProfileEntry[]> {
    if (phrases.length === 0) return [];

    const orConditions: any[] = [];
    for (const phrase of phrases) {
      const normalized = String(phrase || '').trim().toLowerCase();
      if (!normalized) continue;

      const keyVariant = normalized
        .replace(/\s+/g, '_')
        .replace(/[^\p{L}\p{N}_]/gu, '');

      orConditions.push(
        { evidence_text: { [Op.iLike]: `%${normalized}%` } },
        { profile_value: { [Op.iLike]: `%${normalized}%` } },
        { profile_key: { [Op.iLike]: `%${keyVariant}%` } },
        { profile_key: { [Op.iLike]: `%${normalized}%` } },
      );
    }

    const rows = await UserProfileModel.findAll({
      where: {
        ...this.activeWhere(userId, appName),
        [Op.or]: orConditions,
      },
      order: [['confidence', 'DESC'], ['updated_at', 'DESC']],
      limit,
    });

    return rows.map(row => this.toEntry(row));
  }

  async getAll(userId: string, appName: string, limit = 50): Promise<UserProfileEntry[]> {
    const rows = await UserProfileModel.findAll({
      where: this.activeWhere(userId, appName),
      order: [['profile_class', 'ASC'], ['profile_key', 'ASC'], ['value_label', 'ASC']],
      limit,
    });
    return rows.map(row => this.toEntry(row));
  }

  async getContext(userId: string, appName: string): Promise<UserProfileContext> {
    const rows = await UserProfileModel.findAll({
      where: {
        ...this.activeWhere(userId, appName),
        confidence: { [Op.gte]: 0.6 },
      },
      order: [['confidence', 'DESC'], ['updated_at', 'DESC']],
      limit: 24,
    });

    const context: UserProfileContext = {
      identity: {},
      tenant: {},
      preferences: {},
      behaviorHints: {},
      safety: {},
    };

    for (const row of rows) {
      const key = row.value_label && row.value_label !== 'default'
        ? `${row.profile_key}.${row.value_label}`
        : row.profile_key;
      const value = this.shouldMaskForContext(row)
        ? '[redacted]'
        : row.profile_value;

      switch (row.profile_class as ProfileClass) {
        case 'tenant':
          context.tenant[key] = value;
          break;
        case 'preference':
          context.preferences[key] = value;
          break;
        case 'behavior':
          context.behaviorHints[key] = value;
          break;
        case 'safety':
          context.safety[key] = value;
          break;
        default:
          context.identity[key] = value;
      }
    }

    return context;
  }

  async delete(userId: string, appName: string, key: string, valueLabel?: string): Promise<number> {
    const where: any = { user_id: userId, app_name: appName, profile_key: key };
    if (valueLabel) where.value_label = valueLabel;
    return UserProfileModel.destroy({ where });
  }

  async forgetMe(userId: string, appName: string): Promise<number> {
    return UserProfileModel.destroy({
      where: {
        user_id: userId,
        app_name: appName,
      },
    });
  }

  private activeWhere(userId: string, appName: string): Record<string, unknown> {
    return {
      user_id: userId,
      app_name: appName,
      status: 'active',
      [Op.or]: [
        { expires_at: null },
        { expires_at: { [Op.gt]: new Date() } },
      ],
    };
  }

  private canOverwrite(existing: UserProfileModel, input: ProfileUpsertInput): boolean {
    if (input.status && input.status !== 'active') return true;

    const existingSourcePriority = SOURCE_PRIORITY[(existing.source || 'inferred') as ProfileSource] || 0;
    const incomingSourcePriority = SOURCE_PRIORITY[input.source] || 0;

    if (incomingSourcePriority > existingSourcePriority) return true;
    if (incomingSourcePriority < existingSourcePriority) return false;

    return input.confidence >= Number(existing.confidence || 0);
  }

  /**
   * Never mask PII in conversational context.
   * User is seeing their own data — no need to hide it.
   * Masking only applies to logging/monitoring layers.
   */
  private shouldMaskForContext(_row: UserProfileModel): boolean {
    return false;
  }

  private toEntry(row: UserProfileModel): UserProfileEntry {
    return {
      id: row.id,
      userId: row.user_id,
      appName: row.app_name,
      profileKey: row.profile_key,
      valueLabel: row.value_label || 'default',
      profileValue: row.profile_value,
      valueType: (row.value_type || 'string') as ProfileValueType,
      confidence: Number(row.confidence || 0),
      source: (row.source || 'user') as ProfileSource,
      profileClass: (row.profile_class || 'identity') as ProfileClass,
      status: (row.status || 'active') as ProfileStatus,
      evidenceHash: row.evidence_hash,
      evidenceText: row.evidence_text,
      lastConfirmedAt: row.last_confirmed_at,
      validFrom: row.valid_from,
      validTo: row.valid_to,
      expiresAt: row.expires_at,
      isPii: !!row.is_pii,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private hash(value: string): string {
    return createHash('sha256').update(String(value || '')).digest('hex');
  }
}

export const userProfileRepository = new UserProfileRepository();
