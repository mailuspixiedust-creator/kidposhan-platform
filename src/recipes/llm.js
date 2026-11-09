// One way to ask a model: Claude through the Anthropic API when the owner has added the ANTHROPIC_API_KEY secret (the best translations by far),
// otherwise the Worker's own AI binding (free, but weaker in Bengali and Gujarati).
export const CLAUDE_DEFAULT = 'claude-sonnet-5-5';
export const claudeModel = (env) => (env.ANTHROPIC_API_KEY ? String(env.TRANSLATE_CLAUDE_MODEL || CLAUDE_DEFAULT) : null);
export const usingClaude = (env) => !!env.ANTHROPIC_API_KEY;

// messages: [{ role: 'system', content }, { role: 'user', content }] -> the model's text
export async function ask(env, model, messages, maxTokens = 4000) {
  if (String(model).startsWith('claude')) {
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: Math.min(maxTokens, 8000), temperature: 0, system, messages: messages.filter((m) => m.role !== 'system') }),
    });
    if (!res.ok) throw new Error(`Anthropic API ${res.status}`);
    const j = await res.json();
    return (j.content || []).map((c) => c.text || '').join('');
  }
  const r = await env.AI.run(model, { messages, max_tokens: maxTokens, temperature: 0 });
  return typeof r === 'string' ? r : r && (r.response ?? r.result ?? '');
}

// the models to try, best first
export const modelsFor = (env, free) => [claudeModel(env), ...free].filter(Boolean);
