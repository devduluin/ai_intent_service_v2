import type { PipelineInput } from '../types';
import { userProfileService } from '../services/user-profile.service';

export function getDisplayNameFromInput(input?: PipelineInput | null): string {
  const attrs = (input?.attributes || {}) as Record<string, any>;
  const profileContext = attrs.userProfileContext as any;

  const profileName = typeof profileContext?.identity?.name === 'string'
    ? profileContext.identity.name.trim()
    : '';
  if (profileName) return profileName;

  const attrName = typeof attrs.name === 'string' ? attrs.name.trim() : '';
  if (attrName) return attrName;

  const paramName = typeof attrs.params?.name === 'string' ? attrs.params.name.trim() : '';
  if (paramName) return paramName;

  return '';
}

export async function resolveDisplayName(input: PipelineInput): Promise<string> {
  try {
    const profile = await userProfileService.getContext(input.user_id, input.app_name);
    if (profile?.identity?.name) {
      return profile.identity.name;
    }
  } catch {
    // Non-blocking fallback below.
  }

  return getDisplayNameFromInput(input);
}

export function getFirstName(name: string): string {
  return String(name || '').trim().split(/\s+/)[0] || '';
}

