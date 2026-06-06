// ============================================================
// Tool Repository Service
// ============================================================
// Dynamic tool lookup by agent ID
// Replaces hardcoded tool lists for better scalability
// ============================================================

import { intentRegistry } from './intent-registry.service';
import { appLogger } from '../utils/logger.util';

// ============================================================
// Types
// ============================================================

export interface ToolInfo {
  slug: string;
  name: string;
  description?: string;
}

export interface ToolCache {
  tools: ToolInfo[];
  cachedAt: number;
  agentId: string;
}

// ============================================================
// Configuration
// ============================================================

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CACHE_PREFIX = 'tool_cache:';

// In-memory cache: key = agentId, value = cached tools
const toolCache = new Map<string, ToolCache>();

// ============================================================
// Tool Repository Service
// ============================================================

class ToolRepositoryService {

  /**
   * Get all tools available for an agent
   * Uses cache with 5-minute TTL for performance
   *
   * @param agentId - Agent ID to get tools for
   * @returns Array of tool info
   */
  async getByAgentId(agentId: string): Promise<ToolInfo[]> {
    // Check cache first
    const cachedTools = this.getCachedTools(agentId);
    if (cachedTools) {
      appLogger.debug('[ToolRepository] Cache hit', {
        agentId,
        toolCount: cachedTools.length
      });
      return cachedTools;
    }

    // Fetch from registry
    appLogger.debug('[ToolRepository] Cache miss, fetching from registry', {
      agentId
    });

    const tools = this.fetchToolsFromRegistry(agentId);

    // Cache the result
    this.cacheTools(agentId, tools);

    return tools;
  }

  /**
   * Get tool slugs for an agent (convenience method)
   *
   * @param agentId - Agent ID
   * @returns Array of tool slugs
   */
  async getSlugsByAgentId(agentId: string): Promise<string[]> {
    const tools = await this.getByAgentId(agentId);
    return tools.map(t => t.slug);
  }

  /**
   * Check if a tool exists for an agent
   *
   * @param agentId - Agent ID
   * @param toolSlug - Tool slug to check
   * @returns True if tool exists
   */
  async toolExists(agentId: string, toolSlug: string): Promise<boolean> {
    const tools = await this.getByAgentId(agentId);
    return tools.some(t => t.slug === toolSlug);
  }

  /**
   * Clear cache for specific agent
   *
   * @param agentId - Agent ID to clear cache for
   */
  clearCache(agentId: string): void {
    const key = `${CACHE_PREFIX}${agentId}`;
    toolCache.delete(key);
    appLogger.info('[ToolRepository] Cache cleared', { agentId });
  }

  /**
   * Clear all caches
   */
  clearAllCache(): void {
    toolCache.clear();
    appLogger.info('[ToolRepository] All caches cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    totalCachedAgents: number;
    cachedAgents: string[];
  } {
    const cachedAgents = Array.from(toolCache.keys())
      .map(key => key.replace(CACHE_PREFIX, ''));

    return {
      totalCachedAgents: toolCache.size,
      cachedAgents
    };
  }

  /**
   * Get cached tools if valid
   */
  private getCachedTools(agentId: string): ToolInfo[] | null {
    const key = `${CACHE_PREFIX}${agentId}`;
    const cached = toolCache.get(key);

    if (!cached) {
      return null;
    }

    // Check if cache is still valid
    const age = Date.now() - cached.cachedAt;
    if (age > CACHE_TTL_MS) {
      appLogger.debug('[ToolRepository] Cache expired', {
        agentId,
        age: Math.round(age / 1000) + 's'
      });
      toolCache.delete(key);
      return null;
    }

    return cached.tools;
  }

  /**
   * Fetch tools from intent registry
   */
  private fetchToolsFromRegistry(agentId: string): ToolInfo[] {
    const intents = intentRegistry.getAll({ agentId });

    const tools: ToolInfo[] = [];

    for (const intent of intents) {
      // Extract tools from intent mapping
      if (intent.tools && intent.tools.length > 0) {
        for (const toolWrapper of intent.tools) {
          const tool = toolWrapper.tool || toolWrapper;
          if (tool && tool.slug) {
            tools.push({
              slug: tool.slug,
              name: tool.name || tool.slug,
              description: tool.description || undefined
            });
          }
        }
      }
    }

    // Deduplicate by slug
    const uniqueTools = tools.filter(
      (tool, index, self) =>
        index === self.findIndex(t => t.slug === tool.slug)
    );

    appLogger.debug('[ToolRepository] Fetched tools from registry', {
      agentId,
      toolCount: uniqueTools.length
    });

    return uniqueTools;
  }

  /**
   * Cache tools for agent
   */
  private cacheTools(agentId: string, tools: ToolInfo[]): void {
    const key = `${CACHE_PREFIX}${agentId}`;
    const cache: ToolCache = {
      tools,
      cachedAt: Date.now(),
      agentId
    };

    toolCache.set(key, cache);

    appLogger.debug('[ToolRepository] Tools cached', {
      agentId,
      toolCount: tools.length,
      ttl: CACHE_TTL_MS / 1000 + 's'
    });
  }
}

// Singleton instance
export const toolRepository = new ToolRepositoryService();
