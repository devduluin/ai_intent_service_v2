import { PipelineInput } from '../../types';
import { ExecutionStrategy } from '../../types/execution.types';
import { skillsRegistry } from '../../services/skills-registry.service';

export class SkillExecutionStrategy implements ExecutionStrategy {
  async execute(
    skills: string[],
    params: Record<string, any>,
    context: PipelineInput,
    data?: unknown
  ): Promise<Record<string, unknown>> {
    const results: Record<string, unknown> = {};

    for (const skillSlug of skills) {
      try {
        const skill = skillsRegistry.getSkillBySlug(skillSlug);
        if (!skill) {
          throw new Error(`Skill "${skillSlug}" tidak ditemukan`);
        }

        if (!skillsRegistry.hasHandler(skill.handlerKey)) {
          throw new Error(`Handler skill "${skill.handlerKey}" tidak terdaftar`);
        }

        const handler = skillsRegistry.getHandler(skill.handlerKey);
        if (!handler) {
          throw new Error(`Handler skill "${skill.handlerKey}" tidak ditemukan`);
        }

        results[skillSlug] = await handler(params, context, data);
      } catch (error) {
        results[skillSlug] = {
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }

    return results;
  }
}
