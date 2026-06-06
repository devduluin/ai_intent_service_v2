import { skillsRegistry } from '../src/services/skills-registry.service';
import memoryRecallSkillModule from '../src/skills/memory_recall.skill';
import { skillSignalService } from '../src/services/skill-signal.service';

skillsRegistry.registerSkill(memoryRecallSkillModule.metadata, memoryRecallSkillModule.handler);

const signal = skillSignalService.detect('coba memory recall');

if (!signal.hasStrongSignal || signal.recommendedSkill !== 'memory_recall') {
  throw new Error(`Expected strong memory_recall signal, got ${JSON.stringify(signal)}`);
}

const candidate = signal.candidates.find(item => item.slug === 'memory_recall');
if (!candidate?.matchedBy.includes('skill_name') && !candidate?.matchedBy.includes('skill_slug')) {
  throw new Error(`Expected explicit skill match, got ${JSON.stringify(candidate)}`);
}

console.log('[skill-signal-explicit-smoke] PASS', signal);

