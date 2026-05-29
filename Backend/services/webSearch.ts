import axios from 'axios';

const SERPAPI_KEY = process.env.WEB_SEARCH_API_KEY;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function searchWeb(query, numResults = 5) {
  const results = { query, sources: [], snippets: [] };

  if (SERPAPI_KEY) {
    try {
      const serpRes = await axios.get('https://serpapi.com/search', {
        params: {
          q: query,
          api_key: SERPAPI_KEY,
          num: numResults,
          engine: 'google',
          hl: 'en',
        },
        timeout: 8000,
      });

      const organic = serpRes.data?.organic_results || [];
      for (const item of organic.slice(0, numResults)) {
        results.sources.push({
          title: item.title,
          url: item.link,
          snippet: item.snippet,
        });
        if (item.snippet) results.snippets.push(item.snippet);
      }
      return results;
    } catch (err) {
      console.warn('[WebSearch] SerpAPI failed:', err.message);
    }
  }

  // Fallback: DuckDuckGo Lite API (no key needed)
  try {
    const ddgRes = await axios.get('https://api.duckduckgo.com/', {
      params: { q: query, format: 'json', no_html: 1, skip_disambig: 1 },
      timeout: 5000,
    });
    const abstract = ddgRes.data?.Abstract;
    if (abstract) {
      results.sources.push({ title: ddgRes.data.Heading || 'Result', url: ddgRes.data.AbstractURL, snippet: abstract });
      results.snippets.push(abstract);
    }
    const related = ddgRes.data?.RelatedTopics || [];
    for (const item of related.slice(0, numResults)) {
      const text = item.Text || item.Result;
      if (text) {
        results.sources.push({ title: item.Text || 'Result', url: item.FirstURL, snippet: text });
        results.snippets.push(text);
      }
    }
    if (results.snippets.length > 0) return results;
  } catch (err) {
    console.warn('[WebSearch] DuckDuckGo fallback failed:', err.message);
  }

  // Last resort: scrape Google via axios
  try {
    const htmlRes = await axios.get('https://www.google.com/search', {
      params: { q: query, hl: 'en', num: numResults },
      headers: { 'User-Agent': USER_AGENT },
      timeout: 6000,
    });
    const snippetMatches = htmlRes.data.match(/<span[^>]*class="[^"]*aCOpRe[^"]*"[^>]*>(.*?)<\/span>/g);
    if (snippetMatches) {
      for (const match of snippetMatches.slice(0, numResults)) {
        const clean = match.replace(/<[^>]+>/g, '').trim();
        if (clean) results.snippets.push(clean);
      }
    }
  } catch (err) {
    console.warn('[WebSearch] Google scrape failed:', err.message);
  }

  return results;
}

async function fetchPageContent(url, maxChars = 2000) {
  try {
    const res = await axios.get(url, {
      headers: { 'User-Agent': USER_AGENT },
      timeout: 5000,
      maxRedirects: 3,
    });
    const html = res.data;
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[^;]+;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return text.slice(0, maxChars);
  } catch {
    return null;
  }
}

export { searchWeb, fetchPageContent };
