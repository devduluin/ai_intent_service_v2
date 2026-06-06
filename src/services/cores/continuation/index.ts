// ============================================================
// Continuation Module - Main Entry Point
// ============================================================

// Analyzers
export {
  EntityAnalyzer,
  entityAnalyzer,
  ContextAnalyzer,
  contextAnalyzer,
  WorkflowAnalyzer,
  workflowAnalyzer,
  SemanticAnalyzer,
  semanticAnalyzer,
} from './analyzers';

export type {
  EntityType,
  EntityDetection,
  EntityAnalysisResult,
  ReferenceType,
  ContextDetection,
  ContextAnalysisResult,
  WorkflowStep,
  WorkflowDetection,
  WorkflowAnalysisResult,
} from './analyzers';

// Memory
export {
  QuerySnapshotManager,
  querySnapshotManager,
} from './memory';

export type {
  QuerySnapshot,
  SnapshotAnalysisResult,
} from './memory';

// Aggregators
export {
  ConfidenceAggregator,
  confidenceAggregator,
} from './aggregators';

export type {
  ContinuationScores,
  AggregatedResult,
  AggregatorConfig,
} from './aggregators';
