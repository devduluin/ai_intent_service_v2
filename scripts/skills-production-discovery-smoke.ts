import { initializeInternalSkills, skillsRegistry } from '../src/skills';

async function main(): Promise<void> {
  await initializeInternalSkills();

  const slugs = skillsRegistry.listSkillSlugs();
  const required = [
    'memory_recall',
    'user_profile_recall',
    'automation_manager',
    'greeting'
  ];

  for (const slug of required) {
    if (!slugs.includes(slug)) {
      throw new Error(`Missing required skill registration: ${slug}. Registered: ${slugs.join(', ')}`);
    }
  }

  console.log('[skills-production-discovery-smoke] PASS', {
    total: skillsRegistry.getSkillCount(),
    skills: slugs
  });
}

main().catch(error => {
  console.error('[skills-production-discovery-smoke] FAIL', error);
  process.exit(1);
});

