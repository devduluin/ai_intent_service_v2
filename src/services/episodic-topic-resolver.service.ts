import { intentRepository } from '../repositories/intent.repository';
import type { PipelineExecutedTaskDetail, PipelineResult } from '../types';
import type { Agent } from '../types/agent.types';
import type { PlannerOutput, PlannerTask } from '../types/planner.types';
import type { WorkingMemoryData } from '../types/working-memory.type';
import type {
  EpisodicFlowStage,
  EpisodicFlowTraceItem,
  EpisodicMemoryWriteContext
} from '../types/episodic-memory-write.types';
import type { ActiveOffer } from '../types/active-offer.types';
import { skillsRegistry } from './skills-registry.service';

interface ResolveInput {
  result: PipelineResult;
  agent?: Agent | null;
  workingMemory?: WorkingMemoryData | null;
}

class EpisodicTopicResolverService {
  async resolve(input: ResolveInput): Promise<EpisodicMemoryWriteContext> {
    const metadata = input.result.metadata || {};
    const plan = (metadata.activePlan || metadata.originalPlan || undefined) as PlannerOutput | undefined;
    const acceptedOffer = metadata.acceptedOffer as ActiveOffer | undefined;
    const executedTasks = (metadata.executedTasksDetails || []) as PipelineExecutedTaskDetail[];
    const flowStage = this.resolveFlowStage(input.result.intent, metadata, acceptedOffer);
    const topic = await this.resolveTopic({
      resultIntent: input.result.intent,
      plan,
      acceptedOffer,
      executedTasks,
      agent: input.agent,
      workingMemory: input.workingMemory
    });

    return {
      topicKey: topic.topicKey,
      topicLabel: topic.topicLabel,
      flowStage,
      taskPlan: plan || null,
      flowTrace: this.buildFlowTrace(flowStage, plan, acceptedOffer, metadata.resolvedParams as Record<string, unknown> | undefined),
      memoryMeta: {
        resultIntent: input.result.intent,
        acceptedOfferType: acceptedOffer?.type,
        executedTasks: metadata.executedTasks,
        totalTasks: metadata.totalTasks
      }
    };
  }

  private resolveFlowStage(
    resultIntent: string,
    metadata: PipelineResult['metadata'],
    acceptedOffer?: ActiveOffer
  ): EpisodicFlowStage {
    if (acceptedOffer) return 'offer_accepted';
    if (metadata?.comparison) return 'comparison';
    if (resultIntent === 'slot_filling') return 'slot_filling';
    if (resultIntent === 'general_chat') return 'general_chat';
    if (resultIntent === 'error') return 'error';
    if (resultIntent?.startsWith('continuation:') || metadata?.continuationType) return 'continuation';
    return 'main_pipeline';
  }

  private async resolveTopic(input: {
    resultIntent: string;
    plan?: PlannerOutput;
    acceptedOffer?: ActiveOffer;
    executedTasks: PipelineExecutedTaskDetail[];
    agent?: Agent | null;
    workingMemory?: WorkingMemoryData | null;
  }): Promise<{ topicKey: string; topicLabel?: string }> {
    const planTool = input.plan?.tasks?.find(task => task.resource === 'tool');
    const offerTool = input.acceptedOffer?.target.resource === 'tool'
      ? input.acceptedOffer.target.key
      : undefined;
    const executedTool = input.executedTasks.find(task => task.resource === 'tool')?.key;
    const toolSlug = offerTool || planTool?.key || executedTool;

    if (toolSlug) {
      const topic = await this.resolveToolTopic(toolSlug, input.agent?.id);
      if (topic) return topic;
      return { topicKey: `tool:${toolSlug}`, topicLabel: toolSlug };
    }

    const skillTask = input.plan?.tasks?.find(task => task.resource === 'skill');
    const offerSkill = input.acceptedOffer?.target.resource === 'skill'
      ? input.acceptedOffer.target.key
      : undefined;
    const skillSlug = offerSkill || skillTask?.key || input.executedTasks.find(task => task.resource === 'skill')?.key;

    if (skillSlug) {
      if (this.skillShouldInheritPreviousTopic(skillSlug, input.acceptedOffer)) {
        const activeTopic = this.cleanTopicKey(input.workingMemory?.activeIntent);
        if (activeTopic) return { topicKey: activeTopic, topicLabel: activeTopic };
      }

      const skill = skillsRegistry.getSkillBySlug(skillSlug);
      return {
        topicKey: `internal_skill:${skillSlug}`,
        topicLabel: skill?.name || skillSlug
      };
    }

    const cleanIntent = this.cleanTopicKey(input.resultIntent);
    return {
      topicKey: cleanIntent || 'general_chat',
      topicLabel: cleanIntent || 'General Chat'
    };
  }

  private async resolveToolTopic(
    toolSlug: string,
    agentId?: string
  ): Promise<{ topicKey: string; topicLabel?: string } | null> {
    try {
      const intent = await intentRepository.findByToolSlug(toolSlug, agentId);
      if (!intent?.slug) return null;
      return {
        topicKey: intent.slug,
        topicLabel: intent.name || intent.slug
      };
    } catch {
      return null;
    }
  }

  private cleanTopicKey(value?: string | null): string | null {
    if (!value) return null;
    if (value.startsWith('offer:')) return null;
    if (value.startsWith('continuation:')) return null;
    if (['slot_filling', 'continuation_fallback', 'continuation_error', 'error', 'comparison'].includes(value)) {
      return null;
    }
    return value;
  }

  private skillShouldInheritPreviousTopic(skillSlug: string, acceptedOffer?: ActiveOffer): boolean {
    if (acceptedOffer?.target.dependsOnLastResult) return true;
    return ['data_analyzer', 'xls_generator'].includes(skillSlug);
  }

  private buildFlowTrace(
    flowStage: EpisodicFlowStage,
    plan?: PlannerOutput,
    acceptedOffer?: ActiveOffer,
    params?: Record<string, unknown>
  ): EpisodicFlowTraceItem[] {
    const now = Date.now();
    const trace: EpisodicFlowTraceItem[] = [];

    if (acceptedOffer) {
      trace.push({
        stage: 'offer_accepted',
        resource: acceptedOffer.target.resource,
        key: acceptedOffer.target.key,
        type: acceptedOffer.type,
        timestamp: now,
        params: acceptedOffer.target.paramsPatch
      });
    }

    for (const task of plan?.tasks || []) {
      trace.push(this.taskToTrace(flowStage, task, now, params));
    }

    if (trace.length === 0) {
      trace.push({ stage: flowStage, timestamp: now, params });
    }

    return trace;
  }

  private taskToTrace(
    stage: EpisodicFlowStage,
    task: PlannerTask,
    timestamp: number,
    params?: Record<string, unknown>
  ): EpisodicFlowTraceItem {
    return {
      stage,
      resource: task.resource,
      key: task.key,
      timestamp,
      params
    };
  }
}

export const episodicTopicResolverService = new EpisodicTopicResolverService();
export { EpisodicTopicResolverService };
