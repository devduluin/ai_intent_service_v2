// services/param-cache.service.ts
import { globalCache } from '../utils/cache-helper.util';
import { toolService } from '../services/tools.service'
import { PipelineValidator } from '../utils/pipeline-validator.util'
import type { ToolParam } from '../types';

class ParamCacheService {
  private readonly DEFINITION_TTL = 10 * 60 * 1000; // 10 minutes
  private readonly EXTRACTION_TTL = 5 * 60 * 1000; // 5 minutes
  
  /**
   * Get parameter definitions for tools (cached)
   */
  async getParamDefinitions(toolSlugs: string[]): Promise<{
    allParams: ToolParam[];
    paramsMap: Map<string, ToolParam>;
  }> {
    if (!toolSlugs.length) {
      return { allParams: [], paramsMap: new Map() };
    }
    
    const cacheKey = `params:def:${toolSlugs.slice().sort().join('|')}`;
    
    const cached = await globalCache.get<{
      allParams: ToolParam[];
      paramsMap: [string, ToolParam][];
    }>(cacheKey);
    
    if (cached) {
      return {
        allParams: cached.allParams,
        paramsMap: new Map(cached.paramsMap)
      };
    }
    
    // Fetch from database
    const allTools = await toolService.getToolsBySlugs(toolSlugs);
    
    if (!allTools.length) {
      return { allParams: [], paramsMap: new Map() };
    }
    
    const allParams: ToolParam[] = [];
    const paramsMap = new Map<string, ToolParam>();
    
    for (const tool of allTools) {
      const toolParams = toolService.getToolParams(tool);
      for (const param of toolParams) {
        if (!paramsMap.has(param.name)) {
          paramsMap.set(param.name, param);
          allParams.push(param);
        }
      }
    }
    
    // Store in cache
    await globalCache.set(cacheKey, {
      allParams,
      paramsMap: Array.from(paramsMap.entries())
    }, { ttl: this.DEFINITION_TTL });
    
    return { allParams, paramsMap };
  }
  
  /**
   * Get or compute extraction result (with cache)
   */
  async getOrExtract(
    text: string,
    toolSlugs: string[],
    extractor: (text: string, params: ToolParam[]) => Promise<Record<string, unknown>>
  ): Promise<Record<string, unknown>> {
    // Get parameter definitions
    const { allParams, paramsMap } = await this.getParamDefinitions(toolSlugs);
    
    if (!allParams.length) {
      return {};
    }
    
    // Check if we have cached extraction result
    const textHash = this.hashText(text);
    const toolKey = toolSlugs.slice().sort().join('|');
    const extractionCacheKey = `params:extract:${toolKey}:${textHash}`;
    
    const cachedResult = await globalCache.get<Record<string, unknown>>(extractionCacheKey);
    if (cachedResult) {
      console.log('[ParamCache] Using cached extraction result');
      return cachedResult;
    }
    
    // Perform extraction
    const extracted = await extractor(text, allParams);
    
    // Clean and validate
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(extracted)) {
      if (value !== undefined && value !== null && value !== 'null') {
        const paramDef = paramsMap.get(key);
        if (!paramDef || PipelineValidator.validateParamValue(paramDef, value)) {
          cleaned[key] = value;
        }
      }
    }
    
    // Cache the result
    await globalCache.set(extractionCacheKey, cleaned, {
      ttl: this.EXTRACTION_TTL
    });
    
    return cleaned;
  }
  
  private hashText(text: string): string {
    const normalized = text.toLowerCase().trim().replace(/\s+/g, ' ');
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
      const char = normalized.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }
  
  /**
   * Invalidate cache for specific tools
   */
  async invalidate(toolSlugs: string[]): Promise<void> {
    const cacheKey = `params:def:${toolSlugs.slice().sort().join('|')}`;
    await globalCache.del(cacheKey);
    console.log(`[ParamCache] Invalidated cache for tools: ${toolSlugs.join(', ')}`);
  }
}

export const paramCacheService = new ParamCacheService();