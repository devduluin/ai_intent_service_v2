import type { InternalSkillMetadata, InternalSkillParam } from '../types/internal-skill.types';
import type { ResourceParamOwner, Tool, ToolParam } from '../types';

export function normalizeSkillParamToToolParam(param: InternalSkillParam): ToolParam {
  return {
    name: param.name,
    type: param.type,
    description: param.description,
    isRequired: param.isRequired,
    defaultValue: param.defaultValue,
    extractPrompt: param.description || `Ambil nilai ${param.name} dari input user`,
    label: param.label,
    config: param.config,
    order: param.order ?? 0,
    isHidden: false
  };
}

export function normalizeSkillParamsToToolParams(
  params: InternalSkillParam[] = []
): ToolParam[] {
  return params.map(normalizeSkillParamToToolParam);
}

export function buildToolParamOwner(tool: Tool, params: ToolParam[]): ResourceParamOwner {
  return {
    resource: 'tool',
    key: tool.slug,
    name: tool.name,
    description: tool.description,
    params
  };
}

export function buildSkillParamOwner(skill: InternalSkillMetadata): ResourceParamOwner {
  return {
    resource: 'skill',
    key: skill.slug,
    name: skill.name,
    description: skill.description,
    params: normalizeSkillParamsToToolParams(skill.paramSchema)
  };
}
