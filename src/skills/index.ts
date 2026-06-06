// ============================================================
// SKILLS INITIALIZATION
// ============================================================
// Auto-discovery and registration of internal skills
// ============================================================

import { discoverInternalSkills } from './discovery';
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
    const skills = await discoverInternalSkills();
    
    if (skills.length === 0) {
      appLogger.warn('[Skills] No skills discovered');
      return;
    }
    
    // Register all discovered skills
    for (const skill of skills) {
      // Import handler from skill file
      // Try to find the actual filename (slug might differ from filename)
      let skillModule: any;
      
      try {
        skillModule = await import(`./${skill.slug}.skill`);
      } catch {
        try {
          skillModule = await import(`./${skill.slug}.skill.js`);
        } catch {
          const filename = skill.slug.replace('_generator', '').replace('_analyzer', '');
          try {
            skillModule = await import(`./${filename}.skill`);
          } catch {
            skillModule = null;
          }
        }
      }
      
      const handler = skillModule.default?.handler || skillModule[`handle${capitalize(skill.slug)}`];

      if (handler) {
        skillsRegistry.registerSkill(skill, handler);
      } else {
        appLogger.error('[Skills] Failed to load handler', {
          slug: skill.slug,
          handlerKey: skill.handlerKey
        });
      }
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

// ============================================================
// HELPERS
// ============================================================

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
