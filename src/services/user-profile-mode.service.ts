import type { PipelineInput, PipelineResult } from '../types';
import type { UserProfileEntry } from '../types/user-profile.types';
import { globalCache } from '../utils/cache-helper.util';
import { PipelineFormatter } from '../utils/pipeline-formatter.util';
import { isExitModeText } from '../utils/text-intent-cleanup.util';
import { userProfileService } from './user-profile.service';
import { normalizeProfileKey } from '../utils/user-profile-key-normalizer.util';

const TTL_MS = 5 * 60 * 1000;

export interface UserProfileModeState {
  active: true;
  enteredAt: number;
  deleteCandidates?: Array<{
    key: string;
    valueLabel?: string;
    displayKey: string;
  }>;
}

class UserProfileModeService {
  async get(userId: string, appName: string): Promise<UserProfileModeState | null> {
    return globalCache.get<UserProfileModeState>(this.key(userId, appName), {
      redisKey: this.key(userId, appName)
    });
  }

  async enter(userId: string, appName: string): Promise<void> {
    const existing = await this.get(userId, appName);
    await globalCache.set(this.key(userId, appName), {
      active: true,
      enteredAt: existing?.enteredAt || Date.now(),
      deleteCandidates: existing?.deleteCandidates
    }, {
      ttl: TTL_MS,
      redisKey: this.key(userId, appName)
    });
  }

  async exit(userId: string, appName: string): Promise<void> {
    await globalCache.del(this.key(userId, appName), {
      redisKey: this.key(userId, appName)
    });
  }

  isEnterIntent(text: string): boolean {
    const normalized = this.normalize(text);
    return normalized === '/user profile' ||
      normalized === '/me' ||
      normalized === '/profile' ||
      normalized === '/profile' ||
      normalized === '/profil';
  }

  isExitIntent(text: string): boolean {
    return isExitModeText(text, ['user profile', 'profile', 'profil']);
  }

  async handle(input: PipelineInput, startTotal: number): Promise<PipelineResult> {
    if (this.isExitIntent(input.text)) {
      await this.exit(input.user_id, input.app_name);
      return PipelineFormatter.buildEarly({
        intent: 'user_profile_mode_exit',
        score: 1,
        message: 'Mode user profile sudah ditutup.'
      }, startTotal);
    }

    await this.enter(input.user_id, input.app_name);

    const action = this.parseAction(input.text);
    if (action.kind === 'forget') {
      const count = await userProfileService.forgetMe(input.user_id, input.app_name);
      return PipelineFormatter.buildEarly({
        intent: 'user_profile_forget',
        score: 1,
        message: `Saya sudah menghapus ${count} data profil Anda untuk aplikasi ini.\n\nKetik "exit" atau "kluar" untuk keluar dari mode user profile.`
      }, startTotal);
    }

    if (action.kind === 'delete') {
      const target = await this.resolveDeleteTarget(input, action);
      if (!target) {
        return PipelineFormatter.buildEarly({
          intent: 'user_profile_delete_not_found',
          score: 0.7,
          message: [
            'Nomor atau key profil tidak valid.',
            '',
            await this.buildProfileList(input.user_id, input.app_name)
          ].join('\n')
        }, startTotal);
      }

      const count = await userProfileService.delete(input.user_id, input.app_name, target.displayKey);
      return PipelineFormatter.buildEarly({
        intent: 'user_profile_delete',
        score: 1,
        message: count > 0
          ? `Data profil "${target.displayKey}" sudah saya hapus.\n\n${await this.buildProfileList(input.user_id, input.app_name)}`
          : `Saya tidak menemukan data profil "${target.displayKey}".\n\n${await this.buildProfileList(input.user_id, input.app_name)}`
      }, startTotal);
    }

    if (userProfileService.isExplicitProfileStatement(input.text)) {
      const saved = await userProfileService.extractAndUpsert(input);
      return PipelineFormatter.buildEarly({
        intent: 'user_profile_saved',
        score: 1,
        message: `${userProfileService.formatSavedMessage(saved)}\n\n${await this.buildProfileList(input.user_id, input.app_name)}`
      }, startTotal);
    }

    return PipelineFormatter.buildEarly({
      intent: 'user_profile_mode',
      score: 1,
      message: await this.buildProfileList(input.user_id, input.app_name)
    }, startTotal);
  }

  private async buildProfileList(userId: string, appName: string): Promise<string> {
    const profiles = await userProfileService.getAll(userId, appName);
    await this.setDeleteCandidates(userId, appName, profiles);

    if (profiles.length === 0) {
      return [
        'Mode user profile aktif.',
        '',
        'Belum ada data profil yang tersimpan.',
        '',
        'Perintah:',
        '- "hapus <nomor/key>" untuk menghapus data tertentu, contoh: "hapus 1"',
        '- "lupakan saya" untuk menghapus semua profil di aplikasi ini',
        '- "exit" atau "kluar" untuk keluar'
      ].join('\n');
    }

    return [
      'Mode user profile aktif.',
      '',
      'Profil yang tersimpan:',
      '',
      this.formatProfileTable(profiles),
      '',
      'Perintah:',
      '- "hapus <nomor/key>" untuk menghapus data tertentu, contoh: "hapus 2" atau "hapus contact.email.work"',
      '- "lupakan saya" untuk menghapus semua profil di aplikasi ini',
      '- "exit" atau "kluar" untuk keluar'
    ].join('\n');
  }

  private parseAction(text: string): { kind: 'list' | 'delete' | 'forget'; target?: string; index?: number } {
    const normalized = this.normalize(text);
    if (/^(lupakan saya|hapus semua|forget me)$/.test(normalized)) {
      return { kind: 'forget' };
    }

    const deleteMatch = normalized.match(/^(?:hapus|delete|remove)\s+(.+)$/);
    if (deleteMatch?.[1]) {
      const rawTarget = deleteMatch[1].trim();
      const index = this.extractSelectionNumber(rawTarget);
      if (index) return { kind: 'delete', index };
      const normalizedTarget = normalizeProfileKey(rawTarget);
      const target = normalizedTarget.valueLabel
        ? `${normalizedTarget.key}.${normalizedTarget.valueLabel}`
        : normalizedTarget.key;
      return { kind: 'delete', target };
    }

    return { kind: 'list' };
  }

  private async resolveDeleteTarget(
    input: PipelineInput,
    action: { target?: string; index?: number }
  ): Promise<{ key: string; valueLabel?: string; displayKey: string } | null> {
    if (action.index) {
      const state = await this.get(input.user_id, input.app_name);
      let candidate = state?.deleteCandidates?.[action.index - 1];

      if (!candidate) {
        const profiles = await userProfileService.getAll(input.user_id, input.app_name);
        candidate = this.toDeleteCandidates(profiles)[action.index - 1];
      }

      return candidate || null;
    }

    if (!action.target) return null;
    const normalized = normalizeProfileKey(action.target);
    const displayKey = normalized.valueLabel
      ? `${normalized.key}.${normalized.valueLabel}`
      : normalized.key;
    return {
      key: normalized.key,
      valueLabel: normalized.valueLabel,
      displayKey
    };
  }

  private async setDeleteCandidates(userId: string, appName: string, profiles: UserProfileEntry[]): Promise<void> {
    const existing = await this.get(userId, appName);
    await globalCache.set(this.key(userId, appName), {
      active: true,
      enteredAt: existing?.enteredAt || Date.now(),
      deleteCandidates: this.toDeleteCandidates(profiles)
    }, {
      ttl: TTL_MS,
      redisKey: this.key(userId, appName)
    });
  }

  private toDeleteCandidates(profiles: UserProfileEntry[]): Array<{ key: string; valueLabel?: string; displayKey: string }> {
    return profiles.map(profile => ({
      key: profile.profileKey,
      valueLabel: profile.valueLabel && profile.valueLabel !== 'default' ? profile.valueLabel : undefined,
      displayKey: this.displayKey(profile)
    }));
  }

  private formatProfileTable(profiles: UserProfileEntry[]): string {
    const rows = profiles.map((profile, index) => [
      String(index + 1),
      this.tableCell(this.displayKey(profile), 34),
      this.tableCell(profile.isPii ? this.mask(profile.profileValue) : profile.profileValue, 42),
      this.tableCell(profile.profileClass, 14),
      this.tableCell(profile.source, 12),
      String(profile.confidence)
    ]);

    return [
      '| No | Key | Value | Class | Source | Confidence |',
      '|---:|---|---|---|---|---:|',
      ...rows.map(row => `| ${row.join(' | ')} |`)
    ].join('\n');
  }

  private displayKey(profile: UserProfileEntry): string {
    return profile.valueLabel && profile.valueLabel !== 'default'
      ? `${profile.profileKey}.${profile.valueLabel}`
      : profile.profileKey;
  }

  private tableCell(value: unknown, maxLength: number): string {
    const text = String(value ?? '-')
      .replace(/\|/g, '\\|')
      .replace(/\s+/g, ' ')
      .trim() || '-';
    return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 3))}...` : text;
  }

  private extractSelectionNumber(text: string): number | null {
    const match = String(text || '').trim().match(/^(?:hapus\s+)?(\d{1,3})$/i);
    if (!match) return null;
    const value = Number(match[1]);
    return Number.isInteger(value) && value > 0 ? value : null;
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

  private normalize(text: string): string {
    return String(text || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}/\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private key(userId: string, appName: string): string {
    return `user-profile-mode:${appName}:${userId}`;
  }
}

export const userProfileModeService = new UserProfileModeService();
