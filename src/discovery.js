import { searchWeb } from './web-search.js';

function makeId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function now() {
  return Math.floor(Date.now() / 1000);
}

function getDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function guessSourceType(url, title = '') {
  const text = `${url} ${title}`.toLowerCase();

  if (
    text.includes('amazon.') ||
    text.includes('flipkart.') ||
    text.includes('blinkit.') ||
    text.includes('zepto.') ||
    text.includes('bigbasket.') ||
    text.includes('swiggy.')
  ) {
    return 'retailer';
  }

  if (
    text.includes('recipe') ||
    text.includes('allrecipes') ||
    text.includes('bbcgoodfood') ||
    text.includes('foodnetwork')
  ) {
    return 'recipe_site';
  }

  return 'other';
}

export async function runWebDiscovery(env, options = {}) {
  const query = String(options.query || '').trim();

  if (!query) {
    throw new Error('Search query is required.');
  }

  const discoveryType = options.discovery_type || 'product';

  const search = await searchWeb(env, query, {
    search_depth: options.search_depth || 'advanced',
    topic: options.topic || 'general',
    max_results: options.max_results || 8
  });

  const runId = makeId('discovery');

  await env.DB.prepare(`
    INSERT INTO discovery_runs
    (
      id,
      user_id,
      query_text,
      discovery_type,
      age,
      meal,
      season,
      preference,
      provider,
      status,
      result_count,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    runId,
    options.user_id || null,
    query,
    discoveryType,
    options.age ? Number(options.age) : null,
    options.meal || null,
    options.season || null,
    options.preference || null,
    'tavily',
    'completed',
    search.results.length,
    now()
  ).run();

  for (const result of search.results) {
    if (!result.url) continue;

    await env.DB.prepare(`
      INSERT INTO discovery_sources
      (
        id,
        run_id,
        url,
        domain,
        title,
        snippet,
        content,
        source_type,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      makeId('source'),
      runId,
      result.url,
      getDomain(result.url),
      result.title || '',
      result.snippet || '',
      result.raw_content || '',
      guessSourceType(result.url, result.title),
      now()
    ).run();
  }

  return {
    run_id: runId,
    query,
    discovery_type: discoveryType,
    provider: 'tavily',
    result_count: search.results.length,
    results: search.results
  };
}