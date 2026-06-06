import type { InternalSkillMetadata } from '../types/internal-skill.types';
import { skillsRegistry } from './skills-registry.service';

export interface SkillSignalCandidate {
  slug: string;
  name: string;
  confidence: number;
  matchedBy: string[];
  matchedText: string[];
  category?: string;
}

export interface SkillSignal {
  hasStrongSignal: boolean;
  recommendedSkill?: string;
  candidates: SkillSignalCandidate[];
}

class SkillSignalService {
  detect(text: string): SkillSignal {
    const normalizedText = this.normalize(text);
    const candidates = skillsRegistry
      .getAllSkills({ includeHidden: false })
      .map(skill => this.scoreSkill(skill, normalizedText))
      .filter((candidate): candidate is SkillSignalCandidate => !!candidate && candidate.confidence >= 0.35)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5);

    const top = candidates[0];
    const second = candidates[1];
    const hasStrongSignal = !!top && top.confidence >= 0.72 && (!second || top.confidence - second.confidence >= 0.12);

    return {
      hasStrongSignal,
      recommendedSkill: hasStrongSignal ? top.slug : undefined,
      candidates
    };
  }

  private scoreSkill(skill: InternalSkillMetadata, normalizedText: string): SkillSignalCandidate | null {
    const matchedBy: string[] = [];
    const matchedText: string[] = [];
    let score = 0;

    const normalizedName = this.normalize(skill.name);
    if (this.containsPhrase(normalizedText, normalizedName)) {
      score += 0.46;
      matchedBy.push('skill_name');
      matchedText.push(skill.name);
    }

    const normalizedSlug = this.normalize(skill.slug);
    if (this.containsPhrase(normalizedText, normalizedSlug)) {
      score += 0.46;
      matchedBy.push('skill_slug');
      matchedText.push(skill.slug);
    }

    for (const trigger of skill.capabilities?.triggers || []) {
      const normalized = this.normalize(trigger);
      if (this.containsPhrase(normalizedText, normalized)) {
        score += 0.34;
        matchedBy.push('trigger');
        matchedText.push(trigger);
      }
    }

    for (const actionType of skill.capabilities?.actionTypes || []) {
      const normalized = this.normalize(actionType);
      if (this.containsPhrase(normalizedText, normalized)) {
        score += 0.24;
        matchedBy.push('action_type');
        matchedText.push(actionType);
      }
    }

    for (const context of skill.capabilities?.context || []) {
      const normalized = this.normalize(context);
      if (this.containsPhrase(normalizedText, normalized)) {
        score += 0.18;
        matchedBy.push('context');
        matchedText.push(context);
      }
    }

    for (const tag of skill.tags || []) {
      const normalized = this.normalize(tag);
      if (this.containsPhrase(normalizedText, normalized)) {
        score += 0.12;
        matchedBy.push('tag');
        matchedText.push(tag);
      }
    }

    for (const param of skill.paramSchema || []) {
      for (const option of param.config?.options || []) {
        const optionValue = String(option.value || '');
        const optionLabel = String(option.label || '');
        if (this.containsPhrase(normalizedText, this.normalize(optionValue))) {
          score += 0.28;
          matchedBy.push(`param_option:${param.name}`);
          matchedText.push(optionValue);
        }
        if (this.containsPhrase(normalizedText, this.normalize(optionLabel))) {
          score += 0.28;
          matchedBy.push(`param_option:${param.name}`);
          matchedText.push(optionLabel);
        }
      }
    }

    if (score <= 0) return null;

    const priorityBoost = Math.max(0, (skill.capabilities?.priority || 5) - 5) * 0.02;
    const confidence = Math.min(1, score + priorityBoost);

    return {
      slug: skill.slug,
      name: skill.name,
      category: skill.category,
      confidence,
      matchedBy: [...new Set(matchedBy)],
      matchedText: [...new Set(matchedText)].slice(0, 8)
    };
  }

  private normalize(value: string): string {
    return String(value || '')
      .toLowerCase()
      .replace(/[\/_-]+/g, ' ')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private containsPhrase(normalizedText: string, normalizedPhrase: string): boolean {
    if (!normalizedText || !normalizedPhrase || normalizedPhrase.length < 3) return false;
    const pattern = new RegExp(`(^|\\s)${this.escapeRegex(normalizedPhrase)}(\\s|$)`, 'i');
    return pattern.test(normalizedText);
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

export const skillSignalService = new SkillSignalService();
