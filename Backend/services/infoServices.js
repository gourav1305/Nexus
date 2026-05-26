const OPENWEATHER_KEY = process.env.OPENWEATHER_API_KEY;
const NEWS_API_KEY = process.env.NEWS_API_KEY;
const WEB_SEARCH_KEY = process.env.WEB_SEARCH_API_KEY;

const INDIAN_CITIES = {
    delhi: 'Delhi,IN',
    'new delhi': 'Delhi,IN',
    mumbai: 'Mumbai,IN',
    bombay: 'Mumbai,IN',
    bengaluru: 'Bengaluru,IN',
    bangalore: 'Bengaluru,IN',
    chennai: 'Chennai,IN',
    kolkata: 'Kolkata,IN',
    hyderabad: 'Hyderabad,IN',
    pune: 'Pune,IN',
    jaipur: 'Jaipur,IN',
    ahmedabad: 'Ahmedabad,IN',
    lucknow: 'Lucknow,IN',
    chandigarh: 'Chandigarh,IN',
    surat: 'Surat,IN',
    indore: 'Indore,IN',
    nagpur: 'Nagpur,IN',
    patna: 'Patna,IN',
    bhopal: 'Bhopal,IN',
    kochi: 'Kochi,IN',
    cochin: 'Kochi,IN',
    goa: 'Goa,IN',
    noida: 'Noida,IN',
    gurgaon: 'Gurugram,IN',
    gurugram: 'Gurugram,IN',
};

const fetchJson = async (url, options = {}) => {
    const response = await fetch(url, {
        ...options,
        headers: {
            Accept: 'application/json',
            ...(options.headers || {}),
        },
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const message = data?.message || data?.error || data?.errors?.[0] || response.statusText;
        throw new Error(message || `Request failed (${response.status})`);
    }
    return data;
};

const extractCity = (text) => {
    const normalized = text.toLowerCase();
    for (const [key, value] of Object.entries(INDIAN_CITIES)) {
        if (normalized.includes(key)) return value;
    }

    const match = text.match(
        /\b(?:in|at|for|of|ka|ki|ke|me|mein|par)\s+([A-Za-z][A-Za-z\s]{1,24}?)(?:\s+(?:ka|ki|ke|me|mein|par|weather|mausam|temperature|temp|rain|aaj|today|abhi|now)\b|$)/i,
    );
    if (match?.[1]) {
        const city = match[1].trim().replace(/\s+/g, ' ');
        return `${city},IN`;
    }

    return 'Delhi,IN';
};

const extractNewsCategory = (text) => {
    const normalized = text.toLowerCase();
    if (/\b(tech|technology|it|ai|startup)\b/.test(normalized)) return 'technology';
    if (/\b(sport|sports|cricket|football|ipl)\b/.test(normalized)) return 'sports';
    if (/\b(business|finance|market|stock|economy)\b/.test(normalized)) return 'business';
    if (/\b(health|medical|science)\b/.test(normalized)) return 'health';
    if (/\b(entertainment|bollywood|movie|film)\b/.test(normalized)) return 'entertainment';
    return 'general';
};

const extractTopic = (text) => {
    const whoMatch = text.match(/(?:who is|kaun hai)\s+(.+?)(?:\?|$)/i);
    if (whoMatch?.[1]) return whoMatch[1].trim();

    const keBaareMatch = text.match(/(.+?)\s+ke\s+baare\s+me\b/i);
    if (keBaareMatch?.[1]) return keBaareMatch[1].trim();

    const bareMeMatch = text.match(/(.+?)\s+bare\s+me\b/i);
    if (bareMeMatch?.[1]) return bareMeMatch[1].trim();

    const aboutMatch = text.match(/(?:about|regarding)\s+(.+?)(?:\?|$)/i);
    if (aboutMatch?.[1]) return aboutMatch[1].trim();

    const wikiMatch = text.match(/(?:wikipedia|wiki)\s+(?:par\s+)?(.+?)(?:\?|$)/i);
    if (wikiMatch?.[1]) return wikiMatch[1].trim();

    const bataoMatch = text.match(/(.+?)\s+(?:batao|bata|bataye|bataiye|explain)\s*$/i);
    if (bataoMatch?.[1] && bataoMatch[1].length > 2) return bataoMatch[1].trim();

    return text
        .replace(
            /\b(please|mujhe|mujhko|tell me|batao|bata|bataye|explain|information|info)\b/gi,
            ' ',
        )
        .replace(/\s+/g, ' ')
        .trim();
};

const extractSearchQuery = (text) => {
    const patterns = [
        /(?:search(?:\s+for)?|google|find|lookup|dhundo|khojo|web search)\s+(.+?)(?:\?|$)/i,
        /(.+?)\s+(?:search karo|google karo|dhundo)/i,
    ];

    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match?.[1]) return match[1].trim();
    }

    return extractTopic(text);
};

const getWeatherWttr = async (cityQuery) => {
    const cityName = (cityQuery || 'Delhi').split(',')[0].trim();
    const url = `https://wttr.in/${encodeURIComponent(cityName)}?format=j1`;
    const data = await fetchJson(url);
    const current = data.current_condition?.[0] || {};
    const area = data.nearest_area?.[0];
    const place = area?.areaName?.[0]?.value || cityName;

    const temp = current.temp_C ?? 'N/A';
    const feels = current.FeelsLikeC ?? temp;
    const humidity = current.humidity ?? 'N/A';
    const wind = current.windspeedKmph ?? 'N/A';
    const description = current.weatherDesc?.[0]?.value || 'unknown';

    return (
        `${place} ka weather: ${description}, temperature ${temp}°C, feels like ${feels}°C. `
        + `Humidity ${humidity}% aur wind ${wind} km/h.`
    );
};

const getWeatherOpenWeather = async (cityQuery) => {
    const query = cityQuery || 'Delhi,IN';
    const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(query)}&appid=${OPENWEATHER_KEY}&units=metric`;
    const data = await fetchJson(url);

    const temp = Math.round(data.main?.temp ?? 0);
    const feels = Math.round(data.main?.feels_like ?? temp);
    const humidity = data.main?.humidity ?? 'N/A';
    const wind = data.wind?.speed ?? 0;
    const description = data.weather?.[0]?.description || 'unknown';
    const cityName = data.name || query.split(',')[0];

    return (
        `${cityName} ka weather: ${description}, temperature ${temp}°C, feels like ${feels}°C. `
        + `Humidity ${humidity}% aur wind speed ${wind} m/s.`
    );
};

const getWeather = async (cityQuery) => {
    if (OPENWEATHER_KEY) {
        try {
            return await getWeatherOpenWeather(cityQuery);
        } catch (error) {
            console.warn('[NEXUS Info] OpenWeather failed, using wttr.in:', error.message);
        }
    }
    return getWeatherWttr(cityQuery);
};

const getNews = async (category = 'general') => {
    if (!NEWS_API_KEY) {
        throw new Error('NEWS_API_KEY is not configured in Backend/.env');
    }

    const categoryQuery = {
        technology: 'technology India OR tech news OR artificial intelligence India',
        sports: 'sports OR cricket OR football',
        business: 'business OR stock market OR economy',
        health: 'health OR medical',
        entertainment: 'entertainment OR bollywood OR movies',
        general: 'India news',
    };

    let articles = [];

    if (category === 'general') {
        const headlinesUrl = `https://newsapi.org/v2/top-headlines?country=in&pageSize=5&apiKey=${NEWS_API_KEY}`;
        const headlines = await fetchJson(headlinesUrl);
        articles = headlines.articles || [];
    }

    if (!articles.length) {
        const query = categoryQuery[category] || categoryQuery.general;
        const everythingUrl = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&language=en&sortBy=publishedAt&pageSize=5&apiKey=${NEWS_API_KEY}`;
        const everything = await fetchJson(everythingUrl);
        articles = everything.articles || [];
    }

    if (!articles.length) {
        return `Abhi ${category} category me koi headlines nahi mili.`;
    }

    const validArticles = articles.filter((article) => {
        if (!article?.title || article.title === '[Removed]') return false;
        const url = (article.url || '').toLowerCase();
        return !url.includes('pypi.org');
    });
    const lines = validArticles.slice(0, 5).map((article, index) => {
        const source = article.source?.name || 'News';
        const title = article.title || 'Untitled';
        return `${index + 1}. ${title} — ${source}`;
    });

    const label = category === 'general' ? 'top' : category;
    return `Latest ${label} news:\n${lines.join('\n')}`;
};

const getWikipediaSummary = async (query) => {
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=1&namespace=0&format=json`;
    const searchData = await fetchJson(searchUrl);
    const title = searchData?.[1]?.[0];

    if (!title) {
        throw new Error(`Wikipedia par "${query}" ke liye koi article nahi mila.`);
    }

    const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
    const summary = await fetchJson(summaryUrl);

    const extract = summary.extract || summary.description || 'Summary available nahi hai.';
    const short = extract.length > 520 ? `${extract.slice(0, 517)}...` : extract;

    return `${title}: ${short}`;
};

const getBraveSearch = async (query) => {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`;
    const data = await fetchJson(url, {
        headers: { 'X-Subscription-Token': WEB_SEARCH_KEY },
    });
    const results = data?.web?.results || [];
    if (!results.length) throw new Error('No Brave results');

    const lines = results.slice(0, 5).map((item, index) => {
        const title = item.title || 'Result';
        const desc = (item.description || '').slice(0, 120);
        return `${index + 1}. ${title}${desc ? ` — ${desc}` : ''}`;
    });
    return `Web search results for "${query}":\n${lines.join('\n')}`;
};

const getSerperSearch = async (query) => {
    const data = await fetchJson('https://google.serper.dev/search', {
        method: 'POST',
        headers: {
            'X-API-KEY': WEB_SEARCH_KEY,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ q: query, num: 5 }),
    });

    const results = data?.organic || [];
    if (!results.length) throw new Error('No Serper results');

    const lines = results.slice(0, 5).map((item, index) => {
        const title = item.title || 'Result';
        const snippet = (item.snippet || '').slice(0, 120);
        return `${index + 1}. ${title}${snippet ? ` — ${snippet}` : ''}`;
    });
    return `Web search results for "${query}":\n${lines.join('\n')}`;
};

const getDuckDuckGoSearch = async (query) => {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1`;
    const data = await fetchJson(url);

    if (data.AbstractText) {
        const heading = data.Heading || query;
        return `${heading}: ${data.AbstractText}`;
    }

    const related = (data.RelatedTopics || [])
        .flatMap((topic) => (topic.Topics ? topic.Topics : [topic]))
        .filter((topic) => topic.Text)
        .slice(0, 5);

    if (!related.length) {
        return `"${query}" ke liye web par limited info mili. Wikipedia ya specific news try karein.`;
    }

    const lines = related.map((topic, index) => `${index + 1}. ${topic.Text}`);
    return `Web search summary for "${query}":\n${lines.join('\n')}`;
};

const getWebSearch = async (query) => {
    if (WEB_SEARCH_KEY) {
        try {
            return await getBraveSearch(query);
        } catch (braveError) {
            console.warn('[NEXUS Info] Brave search failed:', braveError.message);
            try {
                return await getSerperSearch(query);
            } catch (serperError) {
                console.warn('[NEXUS Info] Serper search failed:', serperError.message);
            }
        }
    }
    return getDuckDuckGoSearch(query);
};

const detectInfoQuery = (message) => {
    const text = message
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s.?!,-]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (
        /\b(weather|mausam|temperature|temp|rain|barish|garmi|sardi|humidity|forecast)\b/.test(text)
        || /\bweather\s+kya\s+hai\b/.test(text)
        || /\bmausam\s+kya\s+hai\b/.test(text)
    ) {
        return { type: 'weather', city: extractCity(message) };
    }

    if (
        /\b(search|google|find|lookup|dhundo|khojo|web\s+search)\b/.test(text)
        || /\bsearch\s+karo\b/.test(text)
    ) {
        const query = extractSearchQuery(message);
        if (query.length >= 2) {
            return { type: 'web_search', query };
        }
    }

    if (
        /\b(news|headlines|samachar|khabar|breaking)\b/.test(text)
        || /\btech\s+news\b/.test(text)
        || /\blatest\s+.*\bnews\b/.test(text)
    ) {
        return { type: 'news', category: extractNewsCategory(text) };
    }

    if (
        /\b(wikipedia|wiki)\b/.test(text)
        || /\bke\s+baare\s+me\b/.test(text)
        || /\bbare\s+me\b/.test(text)
        || /\bwho\s+is\b/.test(text)
        || /\bkaun\s+hai\b/.test(text)
        || (/\b(batao|bata|bataye|tell\s+me|explain|information|info)\b/.test(text)
            && !/\b(weather|mausam|news|headlines|search|google)\b/.test(text))
    ) {
        const topic = extractTopic(message);
        if (topic.length >= 2) {
            return { type: 'wikipedia', query: topic };
        }
    }

    return null;
};

const handleInfoQuery = async (infoQuery) => {
    switch (infoQuery.type) {
    case 'weather':
        return getWeather(infoQuery.city);
    case 'news':
        return getNews(infoQuery.category);
    case 'wikipedia':
        return getWikipediaSummary(infoQuery.query);
    case 'web_search':
        return getWebSearch(infoQuery.query);
    default:
        throw new Error('Unknown info query type');
    }
};

const getInfoApiStatus = () => ({
    openWeather: Boolean(OPENWEATHER_KEY),
    openWeatherFallback: 'wttr.in',
    newsApi: Boolean(NEWS_API_KEY),
    webSearch: Boolean(WEB_SEARCH_KEY),
    webSearchFallback: 'duckduckgo',
    wikipedia: true,
});

module.exports = {
    detectInfoQuery,
    handleInfoQuery,
    getInfoApiStatus,
};
