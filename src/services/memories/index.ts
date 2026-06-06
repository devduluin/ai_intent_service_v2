/**
 * Memory Services - Barrel Export
 * 
 * Memory services for managing conversation context and user state:
 * - Episodic Memory: Long-term conversation summaries and context
 * - Working Memory: Short-term session state for slot filling and workflows
 */

// New modular memory managers (Phase 1.5)
export { EpisodicMemoryManager } from './episodic.memory';
export { WorkingMemoryManager, type WorkingMemoryData, type WorkingMemoryOptions, type WorkingMemoryResult } from './working.memory';

// Legacy service instances (for backward compatibility during migration)
export { episodicMemoryService } from '../episodic-memory.service';
export { workingMemoryService } from '../workingMemory.service';

// Re-export types for convenience
export type { WorkingMemoryData as WorkingMemoryDataType } from '../../types/working-memory.type';
