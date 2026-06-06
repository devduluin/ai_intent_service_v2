import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

function read(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8');
}

function assertIncludes(source: string, needle: string, message: string) {
  assert.ok(source.includes(needle), message);
}

function assertOrder(source: string, first: string, second: string, message: string) {
  const firstIndex = source.indexOf(first);
  const secondIndex = source.indexOf(second);
  assert.ok(firstIndex >= 0, `Missing first marker: ${first}`);
  assert.ok(secondIndex >= 0, `Missing second marker: ${second}`);
  assert.ok(firstIndex < secondIndex, message);
}

type TestCase = {
  name: string;
  run: () => void;
};

const tests: TestCase[] = [
  {
    name: 'PipelineCore runs PerceptionStage before embedding/matching',
    run: () => {
      const source = read('src/services/cores/pipeline-core.ts');
      assertOrder(
        source,
        'perceptionStage.execute',
        'executeMatchingBranch',
        'PerceptionStage must run before vector matching branch'
      );
    }
  },
  {
    name: 'PipelineCore passes perceptionFrame into PlannerStage',
    run: () => {
      const source = read('src/services/cores/pipeline-core.ts');
      assertIncludes(source, 'perceptionFrame', 'Expected perceptionFrame variable in PipelineCore');
      assertIncludes(
        source,
        '{ usePlan: true, timeout: this.config.plannerTimeout, skillSignal: signals.skill, perceptionFrame }',
        'Expected PipelineCore to pass perceptionFrame into PlannerStage options'
      );
    }
  },
  {
    name: 'PlannerStage forwards perceptionFrame to ToolPlanner',
    run: () => {
      const planner = read('src/services/cores/stages/planner.stage.ts');
      const toolPlanner = read('src/services/toolPlanner.service.ts');

      assertIncludes(planner, 'options?.perceptionFrame', 'PlannerStage must read options.perceptionFrame');
      assertIncludes(planner, 'perceptionFrame', 'PlannerStage must keep perceptionFrame in callPlanner');
      assertIncludes(toolPlanner, 'perception_frame=', 'ToolPlanner prompt must include perception_frame');
      assertIncludes(toolPlanner, 'cognitive_guidance=', 'ToolPlanner prompt must include cognitive guidance');
    }
  },
  {
    name: 'Comparison stage can intercept standalone comparison before normal fallback',
    run: () => {
      const source = read('src/services/cores/pipeline-core.ts');
      assertOrder(
        source,
        'Standalone comparison candidate detected',
        'Fallback to chat decision',
        'Standalone comparison must be checked before chat fallback'
      );
      assertIncludes(source, 'comparisonStage.tryExecuteStandalone', 'Expected standalone comparison stage execution');
      assertIncludes(source, "analyzerSkill: 'trend_analyzer'", 'Expected trend analyzer for standalone comparison');
    }
  },
  {
    name: 'Slot filling and confirmation are resolved before main pipeline perception',
    run: () => {
      const source = read('src/services/pipeline.service.ts');
      assertOrder(
        source,
        'const pending = conversationStateService.get',
        'this.executeMainPipeline',
        'Pending slot state must be checked before main pipeline'
      );
      assertOrder(
        source,
        'const pendingConfirmation = await confirmationStateService.get',
        'this.executeMainPipeline',
        'Pending confirmation must be checked before main pipeline'
      );
      assertIncludes(source, 'resolveConfirmationIfAny', 'Expected confirmation resolver path');
      assertIncludes(source, 'slotFillingStage.resume', 'Expected slot filling resume path');
    }
  },
  {
    name: 'Active offer and continuation are resolved before main pipeline perception',
    run: () => {
      const source = read('src/services/pipeline.service.ts');
      assertOrder(
        source,
        'resolveActiveOfferIfAny',
        'this.executeMainPipeline',
        'Active offer resolver must run before main pipeline'
      );
      assertOrder(
        source,
        'continuationStage.execute',
        'this.executeMainPipeline',
        'Continuation resolver must run before main pipeline'
      );
    }
  },
  {
    name: 'Automation capture uses executionInput with working memory context',
    run: () => {
      const source = read('src/services/pipeline.service.ts');
      assertIncludes(source, 'const executionInput = this.withWorkingMemoryContext(input, workingMemory)', 'Expected executionInput with working memory context');
      assertIncludes(source, 'captureAutomationClarificationIfNeeded(executionInput, result)', 'Automation capture should use executionInput');
      assertIncludes(source, 'captureConfirmationIfNeeded(executionInput, result, startTotal)', 'Confirmation capture should use executionInput');
    }
  },
  {
    name: 'Memory replay uses replay params and naturalizes execution results',
    run: () => {
      const source = read('src/services/cores/pipeline-core.ts');
      assertIncludes(source, 'const replayParams = this.buildReplayParams', 'Expected memory replay params builder');
      assertIncludes(source, 'executionStage.execute(replayedPlan, orchestrationInput, replayParams)', 'Expected replay execution to use replayParams');
      assertIncludes(source, 'naturalizationStage.execute(replayedExecution.results', 'Expected replay naturalization to use results');
    }
  }
];

async function main() {
  console.log('\nPipeline Perception Tier 2 Core Smoke\n');
  let passed = 0;

  for (const test of tests) {
    test.run();
    passed++;
    console.log(`  ok ${test.name}`);
  }

  console.log(`\n${passed} passed, 0 failed, ${tests.length} total`);
}

main().catch(error => {
  console.error('\nPipeline Perception Tier 2 Core Smoke failed');
  console.error(error);
  process.exit(1);
});
