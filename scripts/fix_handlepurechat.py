import re

with open('src/services/pipeline.service.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Pattern to match handlePureChat method
pattern = r'  private async handlePureChat\(\s*agent: Agent,\s*input: PipelineInput,\s*startTotal: number\s*\): Promise<PipelineResult> \{.*?\n  \}'

# New implementation
replacement = '''  private async handlePureChat(
    agent: Agent,
    input: PipelineInput,
    startTotal: number
  ): Promise<PipelineResult> {
    const chatStage = this.getChatStage();
    return await chatStage.execute(input, agent, startTotal);
  }'''

# Replace using regex with DOTALL flag
new_content = re.sub(pattern, replacement, content, flags=re.DOTALL)

if new_content != content:
    with open('src/services/pipeline.service.ts', 'w', encoding='utf-8') as f:
        f.write(new_content)
    print('handlePureChat replaced successfully')
else:
    print('Pattern not found or no change made')
    # Debug: show what we're looking for
    match = re.search(r'private async handlePureChat', content)
    if match:
        print(f'Found handlePureChat at position {match.start()}')
        print('Context:', content[match.start():match.start()+100])
