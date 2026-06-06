// ============================================================
// SKILLS REGISTRY SERVICE
// ============================================================
// Registry for internal skills with auto-discovery support
// ============================================================

import type { InternalSkillMetadata, ApiHandlerFn } from '../types/internal-skill.types';
import { appLogger } from '../utils/logger.util';

// ============================================================
// SKILLS REGISTRY CLASS
// ============================================================

class SkillsRegistryService {
  private skills: Map<string, InternalSkillMetadata> = new Map();
  private handlers: Map<string, ApiHandlerFn> = new Map();
  
  // ============================================================
  // REGISTRATION
  // ============================================================
  
  /**
   * Register a skill with metadata and handler
   */
  registerSkill(skill: InternalSkillMetadata, handler: ApiHandlerFn): void {
    // Validate skill
    if (!skill || !skill.slug) {
      throw new Error('[SkillsRegistry] Invalid skill: missing slug');
    }
    
    if (!handler || typeof handler !== 'function') {
      throw new Error(`[SkillsRegistry] Invalid handler for skill: ${skill.slug}`);
    }
    
    // Check for duplicates
    if (this.skills.has(skill.slug)) {
      appLogger.warn('[SkillsRegistry] Skill already registered, overwriting', {
        slug: skill.slug,
        handlerKey: skill.handlerKey
      });
    }
    
    // Register
    this.skills.set(skill.slug, skill);
    this.handlers.set(skill.handlerKey, handler);
    
    appLogger.debug('[SkillsRegistry] Skill registered', {
      slug: skill.slug,
      name: skill.name,
      handlerKey: skill.handlerKey,
      paramCount: skill.paramSchema?.length || 0
    });
  }
  
  /**
   * Register multiple skills at once
   */
  registerMany(skills: Array<{ metadata: InternalSkillMetadata; handler: ApiHandlerFn }>): void {
    for (const skill of skills) {
      this.registerSkill(skill.metadata, skill.handler);
    }
  }
  
  // ============================================================
  // RETRIEVAL
  // ============================================================
  
  /**
   * Get skill metadata by slug
   */
  getSkillBySlug(slug: string): InternalSkillMetadata | null {
    return this.skills.get(slug) || null;
  }
  
  /**
   * Get handler by handlerKey
   */
  getHandler(handlerKey: string): ApiHandlerFn | null {
    return this.handlers.get(handlerKey) || null;
  }
  
  /**
   * Get all skills (optionally filtered)
   */
  getAllSkills(filters?: {
    category?: string;
    tags?: string[];
    includeHidden?: boolean;
  }): InternalSkillMetadata[] {
    let skills = Array.from(this.skills.values());
    
    // Filter by category
    if (filters?.category) {
      skills = skills.filter(s => s.category === filters.category);
    }
    
    // Filter by tags
    if (filters?.tags && filters.tags.length > 0) {
      skills = skills.filter(s =>
        s.tags && s.tags.some(tag => filters.tags!.includes(tag))
      );
    }
    
    // Filter hidden skills
    if (!filters?.includeHidden) {
      skills = skills.filter(s => !s.isHidden);
    }
    
    return skills;
  }
  
  /**
   * Get skill count
   */
  getSkillCount(): number {
    return this.skills.size;
  }
  
  /**
   * Check if skill exists
   */
  hasSkill(slug: string): boolean {
    return this.skills.has(slug);
  }
  
  /**
   * Check if handler exists
   */
  hasHandler(handlerKey: string): boolean {
    return this.handlers.has(handlerKey);
  }
  
  // ============================================================
  // LISTING
  // ============================================================
  
  /**
   * List all skill slugs
   */
  listSkillSlugs(): string[] {
    return Array.from(this.skills.keys());
  }
  
  /**
   * List all handler keys
   */
  listHandlerKeys(): string[] {
    return Array.from(this.handlers.keys());
  }
  
  /**
   * List skills by category
   */
  listByCategory(): Record<string, string[]> {
    const categories: Record<string, string[]> = {};
    
    for (const [slug, skill] of this.skills) {
      const category = skill.category || 'uncategorized';
      
      if (!categories[category]) {
        categories[category] = [];
      }
      
      categories[category].push(slug);
    }
    
    return categories;
  }
  
  // ============================================================
  // CLEAR
  // ============================================================
  
  /**
   * Clear all registered skills
   */
  clear(): void {
    this.skills.clear();
    this.handlers.clear();
    
    appLogger.info('[SkillsRegistry] All skills cleared');
  }
}

// ============================================================
// SINGLETON INSTANCE
// ============================================================

export const skillsRegistry = new SkillsRegistryService();

// ============================================================
// EXPORTS
// ============================================================

export { SkillsRegistryService };
