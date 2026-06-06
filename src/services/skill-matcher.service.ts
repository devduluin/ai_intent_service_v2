// src/services/skill-matcher.service.ts
import { skillsRegistry } from './skills-registry.service';
import { appLogger } from '../utils/logger.util';
import type { InternalSkillMetadata } from '../types/internal-skill.types';

export interface SkillMatchResult {
  skill: InternalSkillMetadata;
  score: number;
  matchedBy: string[];
  reasoning: string;
}

class SkillMatcherService {
  /**
   * Find best skill for continuation type and user query
   */
  matchByContinuationType(
    continuationType: 'export' | 'refine' | 'detail' | 'action' | 'clarify' | 'workflow' | 'new' | 'comparison',
    userQuery: string,
    options?: {
      hasData?: boolean;
      previousSkill?: string;
      previousTool?: string;
    }
  ): SkillMatchResult | null {
    
    const allSkills = skillsRegistry.getAllSkills();
    const candidates: SkillMatchResult[] = [];
    
    for (const skill of allSkills) {
      const result = this.scoreSkill(skill, continuationType, userQuery, options);
      if (result && result.score > 0) {
        candidates.push(result);
      }
    }
    
    // Sort by score descending
    candidates.sort((a, b) => b.score - a.score);
    
    if (candidates.length > 0 && candidates[0].score >= 0.5) {
      appLogger.debug('[SkillMatcher] Matched skill', {
        continuationType,
        userQuery: userQuery.substring(0, 50),
        selected: candidates[0].skill.slug,
        score: candidates[0].score,
        matchedBy: candidates[0].matchedBy,
        alternatives: candidates.slice(1, 3).map(c => c.skill.slug)
      });
      
      return candidates[0];
    }
    
    return null;
  }
  
  private scoreSkill(
    skill: InternalSkillMetadata,
    continuationType: string,
    userQuery: string,
    options?: { hasData?: boolean; previousSkill?: string; previousTool?: string }
  ): SkillMatchResult | null {
    
    let score = 0;
    const matchedBy: string[] = [];
    const capabilities = skill.capabilities;
    
    if (!capabilities) return null;
    
    // 1. Action type match (highest weight)
    if (capabilities.actionTypes.includes(continuationType)) {
      score += 0.8;
      matchedBy.push(`action_type:${continuationType}`);
    }
    
    // 2. Special mapping: 'detail' often means analyze
    if (continuationType === 'detail' && capabilities.actionTypes.includes('analyze')) {
      score += 0.5;
      matchedBy.push('detail_to_analyze');
    }
    
    // 3. Special mapping: 'export' for generation
    if (continuationType === 'export' && capabilities.actionTypes.includes('generate')) {
      score += 0.4;
      matchedBy.push('export_to_generate');
    }
    
    // 4. Trigger word matches
    const matchedTriggers = capabilities.triggers.filter(trigger =>
      userQuery.toLowerCase().includes(trigger.toLowerCase())
    );
    
    if (matchedTriggers.length > 0) {
      score += Math.min(0.6, matchedTriggers.length * 0.15);
      matchedBy.push(`triggers:${matchedTriggers.slice(0, 2).join(',')}`);
    }
    
    // 5. Output format matches
    const matchedFormats = capabilities.outputFormats.filter(format =>
      userQuery.toLowerCase().includes(format.toLowerCase())
    );
    
    if (matchedFormats.length > 0) {
      score += 0.3;
      matchedBy.push(`formats:${matchedFormats[0]}`);
    }
    
    // 6. Context match (previous skill reuse)
    if (options?.previousSkill === skill.slug) {
      score += 0.3;
      matchedBy.push('same_as_previous');
    }
    
    // 7. Priority boost
    if (capabilities.priority) {
      score += (capabilities.priority - 5) * 0.05;
    }
    
    // 8. Data requirement check
    if (capabilities.requiresData && !options?.hasData) {
      score -= 0.4; // Penalty if skill needs data but none available
      matchedBy.push('needs_data_but_none');
    }
    
    // 9. Context-based boost for post-execution analysis
    if (continuationType === 'detail' && capabilities.context?.includes('post_execution')) {
      score += 0.2;
      matchedBy.push('post_execution_context');
    }
    
    // Cap score at 1.0
    score = Math.min(score, 1.0);
    
    if (score === 0) return null;
    
    return {
      skill,
      score,
      matchedBy,
      reasoning: `Score ${score.toFixed(2)} via ${matchedBy.join(', ')}`
    };
  }
  
  /**
   * Get skills by action type (for workflow detection)
   */
  getSkillsByActionType(actionType: string): InternalSkillMetadata[] {
    return skillsRegistry.getAllSkills().filter(skill =>
      skill.capabilities?.actionTypes?.includes(actionType)
    );
  }
  
  /**
   * Get default fallback skill for a continuation type
   */
  getDefaultSkill(continuationType: string): InternalSkillMetadata | null {
    const skills = this.getSkillsByActionType(continuationType);
    
    if (skills.length === 0) {
      // Fallback: 'detail' -> data_analyzer, 'export' -> xls_generator
      if (continuationType === 'detail') {
        return skillsRegistry.getSkillBySlug('data_analyzer');
      }
      if (continuationType === 'export') {
        return skillsRegistry.getSkillBySlug('xls_generator');
      }
      return null;
    }
    
    return skills.sort((a, b) => 
      (b.capabilities?.priority || 0) - (a.capabilities?.priority || 0)
    )[0];
  }
}

export const skillMatcher = new SkillMatcherService();