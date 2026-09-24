export async function searchWeb(env, query, options = {}) {
  if (!env.TAVILY_API_KEY) {
    throw new Error('TAVILY_API_KEY is not configured.');
  }

  const body = {
    query,
    search_depth: options.search_depth || 'advanced',
    topic: options.topic || 'general',
    max_results: options.max_results || 8,
    include_answer: false,
    include_raw_content: true,
    include_images: false
...(options.include_domains?.length
    ? { include_domains: options.include_domains }
    : {})
  };

  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.TAVILY_API_KEY}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Tavily search failed (${response.status}): ${errorText}`
    );
  }

  const data = await response.json();

  return {
    query,
    provider: 'tavily',
    results: (data.results || []).map(result => ({
      title: result.title || '',
      url: result.url || '',
      snippet: result.content || '',
      raw_content: result.raw_content || '',
      search_score: result.score ?? null
    }))
  };
}