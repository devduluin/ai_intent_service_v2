import type { PlannerTask } from '../types/planner.types';
import type { ResourceParamOwner } from '../types';
import { toolService } from './tools.service';
import { skillsRegistry } from './skills-registry.service';
import {
  buildSkillParamOwner,
  buildToolParamOwner
} from '../utils/resource-param-normalizer.util';
import { appLogger } from '../utils/logger.util';

const CACHE_TTL_MS = 60 * 1000 // 1 minute

interface CacheEntry<T> {
  data: T
  expiresAt: number
}

class ResourceParamSchemaService {
  private toolCache = new Map<string, CacheEntry<ResourceParamOwner[]>>()

  async collectOwners(tasks: PlannerTask[] = []): Promise<ResourceParamOwner[]> {
    const owners: ResourceParamOwner[] = [];
    const toolKeys = this.uniqueKeys(tasks, 'tool');
    const skillKeys = this.uniqueKeys(tasks, 'skill');

    if (toolKeys.length > 0) {
      const cacheKey = toolKeys.sort().join(',')
      const cached = this.toolCache.get(cacheKey)
      if (cached && Date.now() < cached.expiresAt) {
        owners.push(...cached.data)
      } else {
        const tools = await toolService.getToolsBySlugs(toolKeys);
        const toolOwners: ResourceParamOwner[] = []
        for (const tool of tools) {
          toolOwners.push(buildToolParamOwner(tool, toolService.getToolParams(tool)));
        }
        this.toolCache.set(cacheKey, { data: toolOwners, expiresAt: Date.now() + CACHE_TTL_MS })
        owners.push(...toolOwners)
      }
    }

    for (const skillKey of skillKeys) {
      const skill = skillsRegistry.getSkillBySlug(skillKey);
      if (!skill) {
        appLogger.warn('[ResourceParamSchema] Skill not found', { skillKey });
        continue;
      }

      owners.push(buildSkillParamOwner(skill));
    }

    appLogger.debug('[ResourceParamSchema] Owners collected', {
      taskCount: tasks.length,
      ownerCount: owners.length,
      toolCount: owners.filter(owner => owner.resource === 'tool').length,
      skillCount: owners.filter(owner => owner.resource === 'skill').length,
      paramCount: owners.reduce((total, owner) => total + owner.params.length, 0)
    });

    return owners;
  }

  private uniqueKeys(tasks: PlannerTask[], resource: 'tool' | 'skill'): string[] {
    return [...new Set(
      tasks
        .filter(task => task.resource === resource)
        .map(task => task.key)
        .filter(Boolean)
    )];
  }
}

export const resourceParamSchemaService = new ResourceParamSchemaService();
export { ResourceParamSchemaService };
