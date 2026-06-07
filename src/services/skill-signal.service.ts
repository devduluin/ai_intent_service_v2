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
  private readonly GENERIC_TRIGGER_WORDS = new Set([
    'jelaskan',
    'jelasin',
    'detail',
    'ringkas',
    'rangkum',
    'summary',
    'summarize',
    'lihat',
    'tampilkan'
  ]);

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
        if (skill.capabilities?.requiresData && this.isGenericTrigger(normalized) && !this.hasDataAnalysisContext(normalizedText)) {
          matchedBy.push('ignored_generic_trigger');
          matchedText.push(trigger);
          continue;
        }

        const exactTrigger = normalizedText === normalized;
        const highSignalTrigger = this.isHighSignalTrigger(normalized);
        const specificPhraseTrigger = this.isSpecificPhraseTrigger(normalized);
        const triggerScore = (exactTrigger && highSignalTrigger) || specificPhraseTrigger ? 0.74 : 0.34;
        score += triggerScore;
        matchedBy.push(triggerScore >= 0.74 ? 'trigger_high_signal' : 'trigger');
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

    if (skill.capabilities?.requiresData && !this.hasDataAnalysisContext(normalizedText)) {
      const hasExplicitSkillName = matchedBy.includes('skill_name') || matchedBy.includes('skill_slug');
      if (!hasExplicitSkillName) {
        score = Math.min(score, 0.34);
      }
    }

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

  private isGenericTrigger(normalizedTrigger: string): boolean {
    return this.GENERIC_TRIGGER_WORDS.has(normalizedTrigger);
  }

  private isHighSignalTrigger(normalizedTrigger: string): boolean {
    return /\b(siapa anda|siapa kamu|who are you|identitas|identity|tentang viper|arsitektur viper|kamu bisa apa|bisa bantu apa|what can you do|show capabilities|lihat kemampuan|kemampuan lengkap)\b/i.test(normalizedTrigger);
  }

  private isSpecificPhraseTrigger(normalizedTrigger: string): boolean {
    if (this.isGenericTrigger(normalizedTrigger)) return false;
    return normalizedTrigger.split(/\s+/).length >= 3;
  }

  private hasDataAnalysisContext(normalizedText: string): boolean {
    return /\b(data|dataset|json|array|object|hasil|result|analisa|analisis|analysis|analyze|insight|trend|pola|metric|metrik|statistik|summary|ringkasan)\b/i.test(normalizedText);
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

export const skillSignalService = new SkillSignalService();
