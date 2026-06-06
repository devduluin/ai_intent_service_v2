import type { ToolParameterType, ToolParameterConfig } from '../database/models/Tools-parameter.model';

// ============================================================
// INTERNAL SKILL METADATA
// ============================================================

/**
 * Metadata untuk Internal Skill/Tool
 * Digunakan untuk auto-discovery dan documentation
 */
export interface InternalSkillMetadata {
  /** Display name */
  name: string;
  
  /** Unique slug identifier */
  slug: string;
  
  /** Description untuk user */
  description: string;
  
  /** Handler function key */
  handlerKey: string;

  capabilities?: {
    actionTypes: string[];      // ['export', 'detail', 'analyze', 'generate']
    outputFormats: string[];    // ['xlsx', 'csv', 'insight', 'analysis']
    triggers: string[];         // ['export', 'analisa', 'download']
    context?: string[];         // ['data_analysis', 'file_generation']
    priority?: number;          // 1-10, higher = more preferred
    requiresData?: boolean;     // Does this skill need previous result?
  };
  
  /** Parameter schema */
  paramSchema: InternalSkillParam[];
  
  /** Version (semver) */
  version?: string;
  
  /** Tags untuk filtering */
  tags?: string[];
  
  /** Category untuk grouping */
  category?: string;
  
  /** Hide from user-facing lists */
  isHidden?: boolean;
}

// ============================================================
// INTERNAL SKILL PARAMETER
// ============================================================

/**
 * Parameter schema untuk Internal Skill
 * Mengikuti pattern ToolParameterModel untuk konsistensi
 */
export interface InternalSkillParam {
  /** Parameter name */
  name: string;
  
  /** Parameter type */
  type: ToolParameterType;
  
  /** Parameter description */
  description: string;
  
  /** Required or optional */
  isRequired: boolean;
  
  /** Default value */
  defaultValue?: any;
  
  /** Display label */
  label?: string;
  
  /** Config for validation/UI */
  config?: ToolParameterConfig;
  
  /** Display order */
  order?: number;
}

// ============================================================
// SKILL MODULE EXPORT
// ============================================================

/**
 * Default export format untuk auto-discovery
 * Setiap skill file harus export format ini
 */
export interface InternalSkillModule {
  metadata: InternalSkillMetadata;
  handler: ApiHandlerFn;
}

// ============================================================
// API HANDLER TYPE
// ============================================================

/**
 * Handler function signature
 * Menerima params dan context, mengembalikan Promise<any>
 */
export type ApiHandlerFn = (
  params: Record<string, any>,
  context?: any,
  data?: unknown
) => Promise<any>;
