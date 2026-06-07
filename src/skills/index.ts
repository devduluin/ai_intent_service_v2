// ============================================================
// SKILLS INITIALIZATION
// ============================================================
// Auto-discovery and registration of internal skills
// ============================================================

import { discoverInternalSkillModules } from './discovery';
import { skillsRegistry } from '../services/skills-registry.service';
import { appLogger } from '../utils/logger.util';

// ============================================================
// INITIALIZATION FUNCTION
// ============================================================

/**
 * Initialize all internal skills
 * Auto-discovers skills from skills/ folder and registers them
 */
export async function initializeInternalSkills(): Promise<void> {
  appLogger.info('[Skills] Starting initialization...');
  
  try {
    // Auto-discover skills
    const discoveredSkills = await discoverInternalSkillModules();
    
    if (discoveredSkills.length === 0) {
      appLogger.warn('[Skills] No skills discovered');
      return;
    }
    
    // Register all discovered skills
    for (const skill of discoveredSkills) {
      skillsRegistry.registerSkill(skill.metadata, skill.handler);
    }
    
    appLogger.info('[Skills] Initialization completed', {
      totalSkills: skillsRegistry.getSkillCount(),
      skills: skillsRegistry.listSkillSlugs()
    });
    
  } catch (error) {
    appLogger.error('[Skills] Initialization failed', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    throw error;
  }
}

// ============================================================
// EXPORTS
// ============================================================

export { skillsRegistry };
