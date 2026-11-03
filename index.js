const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cron = require('node-cron');
const app = express();

const PORT = process.env.PORT || 3000;

app.use(express.json());

// 1. Anti-Bot Configurations
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:126.0) Gecko/20100101 Firefox/126.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0',
];

function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// 2. Scraping Engine
async function scrapeUrl(targetUrl) {
  try {
    const userAgent = getRandomUserAgent();
    console.log(`[Scraper] Fetching: ${targetUrl}`);

    const response = await axios.get(targetUrl, {
      timeout: 25000,
      headers: {
        'User-Agent': userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'Sec-Ch-Ua': '"Google Chrome";v="125", "Chromium";v="125", "Not.A/Brand";v="24"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
      },
    });

    const $ = cheerio.load(response.data);
    const ogTitle = $('meta[property="og:title"]').attr('content');
    const twitterTitle = $('meta[name="twitter:title"]').attr('content');
    const docTitle = $('title').text();
    const h1Title = $('h1').first().text();
    const title = (ogTitle || twitterTitle || h1Title || docTitle || 'Unknown Title').trim();

    const ogPrice = $('meta[property="product:price:amount"]').attr('content');
    const schemaPrice = $('[itemprop="price"]').attr('content') || $('[itemprop="price"]').text();

    const priceSelectors = ['.a-price .a-offscreen', '#priceblock_ourprice', '#priceblock_dealprice', '.product-price', '.price', '[data-testid="product-price"]'];
    
    let detectedPrice = ogPrice || schemaPrice || null;
    if (!detectedPrice) {
      for (const selector of priceSelectors) {
        const text = $(selector).first().text().trim();
        if (text) {
          detectedPrice = text;
          break;
        }
      }
    }

    const ogAvailability = $('meta[property="product:availability"]').attr('content');
    const isOut = /out of stock|sold out|unavailable/i.test(response.data);
    const availability = ogAvailability || (isOut ? 'Out of Stock' : 'In Stock / Available');

    return {
      url: targetUrl,
      title: title.slice(0, 150),
      price: detectedPrice ? detectedPrice.trim() : 'Price not detected',
      availability,
      status: 'success',
      scrapedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.error(`[Scraper] Failed to fetch ${targetUrl}:`, err.message);
    return {
      url: targetUrl,
      error: err.message,
      status: 'failed',
      scrapedAt: new Date().toISOString(),
    };
  }
}

// 3. Orchestration
let monitoredUrls = ['https://news.ycombinator.com'];
let latestScrapeResults = [];
let isScrapeRunning = false;

async function executeScrapeJob() {
  if (isScrapeRunning) return;
  isScrapeRunning = true;
  console.log(`\n======================================================`);
  console.log(`[Job Started] Checking ${monitoredUrls.length} URLs at ${new Date().toISOString()}`);
  console.log(`======================================================`);

  const results = [];

  for (let i = 0; i < monitoredUrls.length; i++) {
    const url = monitoredUrls[i];
    const data = await scrapeUrl(url);
    results.push(data);

    if (i < monitoredUrls.length - 1) {
      const delaySeconds = Math.floor(Math.random() * (45 - 15 + 1) + 15);
      console.log(`[Throttle] Waiting ${delaySeconds} seconds before requesting the next URL...`);
      await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1000));
    }
  }

  latestScrapeResults = results;
  isScrapeRunning = false;
  console.log(`[Job Finished] Completed cycle at ${new Date().toISOString()}\n`);
}

// 4. Scheduler: Runs every 5 hours
cron.schedule('0 */5 * * *', () => {
  executeScrapeJob().catch(console.error);
});

// 5. REST API Endpoints
app.get('/', (req, res) => {
  res.json({
    service: 'Wishlist Scraper Backend',
    status: 'online',
    schedule: 'Runs every 5 hours',
    itemCount: monitoredUrls.length,
    monitoredUrls,
    isScrapingNow: isScrapeRunning,
    lastResults: latestScrapeResults,
  });
});

app.post('/urls', (req, res) => {
  const { urls } = req.body;
  if (!Array.isArray(urls)) return res.status(400).json({ error: 'Body must be an array' });
  monitoredUrls = urls;
  res.json({ message: 'Monitored URLs updated', count: monitoredUrls.length, urls: monitoredUrls });
});

app.post('/scrape-now', (req, res) => {
  if (isScrapeRunning) return res.status(409).json({ message: 'Scrape already running' });
  executeScrapeJob().catch(console.error);
  res.json({ message: 'Scrape triggered in background' });
});

// 6. Start Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
});