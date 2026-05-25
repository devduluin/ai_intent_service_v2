/**
 * Core Stages - Barrel Export
 * 
 * Stages are the main pipeline processing units, each with single responsibility:
 * - PreProcessing: Query decomposition and signal extraction
 * - Embedding: Text embedding generation with caching
 * - IntentMatching: Vector similarity search and ranking
 * - Planner: Execution plan determination
 * - Execution: Tool/handler/knowledge execution
 * - Naturalization: API result to natural language conversion
 * - Continuation: Continuation detection and execution
 * - SlotFilling: Slot filling for missing parameters
 * - Chat: Pure chat conversation handling
 */

export { PreProcessingStage, type PreProcessingResult, type PreProcessingOptions } from './pre-processing.stage';
export { EmbeddingStage, type EmbeddingOptions } from './embedding.stage';
export { IntentMatchingStage, type IntentMatchingOptions } from './intent-matching.stage';
export { PlannerStage, type PlannerStageOptions } from './planner.stage';
export { ExecutionStage, type ExecutionStageOptions, type ExecutionResult } from './execution.stage';
export { NaturalizationStage, type NaturalizationStageOptions } from './naturalization.stage';
export { ContinuationStage, type ContinuationStageOptions, type ContinuationStageResult } from './continuation.stage';
export { SlotFillingStage, type SlotFillingStageOptions, type SlotFillingStageResult } from './slot-filling.stage';
export { ChatStage } from './chat.stage';
