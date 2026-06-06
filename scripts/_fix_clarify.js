const fs = require('fs');
let f = fs.readFileSync('src/services/clarification.service.ts', 'utf8');

// Replace ollama-dependent generate method
const oldGenerate = f.substring(f.indexOf('private async generate'), f.indexOf('private async generate') + 800);

// Find the method boundaries
const start = f.indexOf('private async generate');
let braceCount = 0;
let end = start;
let found = false;
for (let i = start; i < f.length; i++) {
  if (f[i] === '{') braceCount++;
  if (f[i] === '}') {
    braceCount--;
    if (braceCount === 0) { end = i + 1; break; }
  }
}

const newGenerate = `private async generate(provider: string, llmModel: string, prompt: string, options?: { num_predict?: number }) {
    const response = await openAiService.chat(provider, llmModel, prompt, {
      temperature: provider === 'qwen' ? 0.1 : 0.4,
      num_predict: options?.num_predict ?? 64,
    });
    return response.trim();
  }`;

f = f.substring(0, start) + newGenerate + f.substring(end);
fs.writeFileSync('src/services/clarification.service.ts', f, 'utf8');
console.log('DONE');