// ============================================================
// SKILLS AUTO-DISCOVERY SYSTEM
// ============================================================
// Automatically discovers and registers skills from skills/ folder
// ============================================================

import { readdir } from 'fs/promises';
import { join } from 'path';
import type { InternalSkillMetadata, InternalSkillModule, ApiHandlerFn } from '../types/internal-skill.types';
import { appLogger } from '../utils/logger.util';

// ============================================================
// DISCOVERY FUNCTION
// ============================================================

/**
 * Discover all skills from skills/ folder
 * Scans for *.skill.ts files and extracts metadata + handler
 */
export async function discoverInternalSkills(): Promise<InternalSkillMetadata[]> {
  const skillsDir = join(__dirname);
  
  try {
    const files = await readdir(skillsDir);
    
    appLogger.debug('[SkillsDiscovery] Scanning directory', {
      directory: skillsDir,
      fileCount: files.length
    });
    
    const skills: InternalSkillMetadata[] = [];
    
    for (const file of files) {
      // Skip non-skill files
      if (!file.endsWith('.skill.ts') || file.startsWith('index.')) {
        continue;
      }
      
      appLogger.debug('[SkillsDiscovery] Processing file', { file });
      
      try {
        // Import module
        const module = await import(`./${file}`);
        
        // Extract metadata and handler
        const metadata = extractMetadata(module);
        const handler = extractHandler(module);
        
        if (metadata && handler) {
          skills.push(metadata);
          
          appLogger.info('[SkillsDiscovery] Discovered skill', {
            name: metadata.name,
            slug: metadata.slug,
            handlerKey: metadata.handlerKey,
            paramCount: metadata.paramSchema?.length || 0
          });
        } else {
          appLogger.warn('[SkillsDiscovery] Invalid skill module', {
            file,
            hasMetadata: !!metadata,
            hasHandler: !!handler
          });
        }
        
      } catch (importError) {
        appLogger.error('[SkillsDiscovery] Failed to import module', {
          file,
          error: importError instanceof Error ? importError.message : 'Unknown error'
        });
      }
    }
    
    appLogger.info('[SkillsDiscovery] Discovery completed', {
      totalSkills: skills.length,
      skills: skills.map(s => `${s.name} (${s.slug})`)
    });
    
    return skills;
    
  } catch (error) {
    appLogger.error('[SkillsDiscovery] Discovery failed', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    
    return [];
  }
}

// ============================================================
// EXTRACTION HELPERS
// ============================================================

/**
 * Extract metadata from module
 * Looks for exported metadata object with required fields
 */
function extractMetadata(module: any): InternalSkillMetadata | null {
  // Try default export first (recommended pattern)
  if (module.default?.metadata) {
    return validateMetadata(module.default.metadata);
  }
  
  // Try named exports (fallback)
  const exports = Object.values(module);
  
  for (const exported of exports) {
    if (isMetadataObject(exported)) {
      return validateMetadata(exported);
    }
  }
  
  return null;
}

/**
 * Extract handler from module
 * Looks for exported handler function
 */
function extractHandler(module: any): ApiHandlerFn | null {
  // Try default export first (recommended pattern)
  if (module.default?.handler) {
    return module.default.handler;
  }
  
  // Try named exports (fallback)
  const exports = Object.values(module);
  
  for (const exported of exports) {
    if (isHandlerFunction(exported)) {
      return exported;
    }
  }
  
  return null;
}

/**
 * Check if object looks like metadata
 */
function isMetadataObject(obj: any): obj is InternalSkillMetadata {
  return (
    obj &&
    typeof obj === 'object' &&
    typeof obj.name === 'string' &&
    typeof obj.slug === 'string' &&
    typeof obj.description === 'string' &&
    typeof obj.handlerKey === 'string' &&
    Array.isArray(obj.paramSchema)
  );
}

/**
 * Check if object looks like handler function
 */
function isHandlerFunction(obj: any): obj is ApiHandlerFn {
  return typeof obj === 'function' && obj.constructor.name === 'AsyncFunction';
}

/**
 * Validate metadata object has all required fields
 */
function validateMetadata(metadata: any): InternalSkillMetadata | null {
  if (!isMetadataObject(metadata)) {
    return null;
  }
  
  // Additional validation
  if (!metadata.slug.match(/^[a-z_]+$/)) {
    appLogger.warn('[SkillsDiscovery] Invalid slug format', {
      slug: metadata.slug,
      expected: 'lowercase with underscores only'
    });
    return null;
  }
  
  return metadata;
}

// ============================================================
// EXPORTS
// ============================================================

export {
  extractMetadata,
  extractHandler,
  isMetadataObject,
  isHandlerFunction,
  validateMetadata
};
