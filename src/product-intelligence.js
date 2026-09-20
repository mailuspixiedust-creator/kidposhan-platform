/* KidPoshan Product Intelligence — Gemini connection test
 *
 * Temporary diagnostic build. It intentionally calls Gemini WITHOUT
 * Google Search or URL Context so we can isolate basic model/API access
 * from tool-specific quota or availability.
 *
 * No product recommendation or KidPoshan Score is produced by this test.
 */

const GEMINI_DEFAULT_MODEL = 'gemini-3.8-flash';

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function error(code, message, extra = {}) {
  const e = new Error(message);
  e.code = code;
  Object.assign(e, extra);
  return e;
}

function extractInteractionText(data) {
  if (typeof data?.output_text === 'string') return data.output_text;
  if (Array.isArray(data?.steps)) {
    for (const step of data.steps) {
      if (step?.type !== 'model_output') continue;
      if (typeof step?.text === 'string') return step.text;
      if (Array.isArray(step?.content)) {
        for (const c of step.content) {
          if (typeof c?.text === 'string') return c.text;
        }
      }
    }
  }
  if (Array.isArray(data?.outputs)) {
    for (const item of data.outputs) {
      if (typeof item?.text === 'string') return item.text;
      if (Array.isArray(item?.content)) {
        for (const c of item.content) if (typeof c?.text === 'string') return c.text;
      }
    }
  }
  if (Array.isArray(data?.output)) {
    for (const item of data.output) {
      if (typeof item?.text === 'string') return item.text;
      if (Array.isArray(item?.content)) {
        for (const c of item.content) if (typeof c?.text === 'string') return c.text;
      }
    }
  }
  return '';
}

async function callGeminiPlain(env, prompt) {
  const key = clean(env?.GEMINI_API_KEY);
  if (!key) {
    throw error(
      'SECRET_MISSING',
      'SECRET_MISSING: GEMINI_API_KEY is not reaching the active Worker runtime.'
    );
  }

  const model = clean(env?.GEMINI_MODEL) || GEMINI_DEFAULT_MODEL;
  const url = 'https://generativelanguage.googleapis.com/v1beta/interactions';
  const body = {
    model,
    input: prompt,
    response_format: {
      type: 'text',
      mime_type: 'application/json',
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          message: { type: 'string' }
        },
        required: ['ok', 'message']
      }
    }
  };

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'x-goog-api-key': key,
        'content-type': 'application/json'
      },
      body: JSON.stringify(body)
    });
  } catch (e) {
    throw error('GEMINI_NETWORK_ERROR', `Gemini network request failed: ${e?.message || e}`);
  }

  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch {}

  if (!response.ok) {
    const providerMessage = data?.error?.message || raw.slice(0, 700) || 'Unknown Gemini error';
    const status = response.status;
    let code = 'GEMINI_API_ERROR';
    if (status === 401 || status === 403) code = 'GEMINI_AUTH_FAILED';
    else if (status === 404) code = 'GEMINI_MODEL_OR_ENDPOINT_ERROR';
    else if (status === 429) code = 'GEMINI_RATE_LIMITED';
    throw error(`${code}: ${providerMessage}`.slice(0, 1200), `${code}: ${providerMessage}`, { status });
  }

  return { model, data, text: extractInteractionText(data) };
}

export async function researchProducts(env, input = {}) {
  const query = clean(input.query) || 'connection test';
  const model = clean(env?.GEMINI_MODEL) || GEMINI_DEFAULT_MODEL;

  const prompt = `Return JSON only. Set ok to true and message to "Gemini connection is working". This is a connection test for the KidPoshan application. Do not search the web and do not provide product recommendations.`;

  const result = await callGeminiPlain(env, prompt);

  return {
    ok: true,
    provider: 'gemini',
    model: result.model,
    diagnostic: {
      test: 'plain_model_no_tools',
      secret_present: true,
      api_response_received: true,
      response_id: result.data?.id || null,
      message: 'Gemini basic API connection succeeded without Google Search or URL Context.'
    },
    query,
    products: []
  };
}

export function geminiRuntimeStatus(env) {
  const present = typeof env?.GEMINI_API_KEY === 'string' && env.GEMINI_API_KEY.trim().length > 0;
  return {
    provider: 'gemini',
    model: clean(env?.GEMINI_MODEL) || GEMINI_DEFAULT_MODEL,
    secret_present: present
  };
}
