const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const HTML_FILE = path.join(__dirname, 'top-gainer-loser.html');

const PORT = 3001;

const URLS = {
    usa_gainers: 'https://finance.yahoo.com/markets/stocks/gainers/',
    usa_losers:  'https://finance.yahoo.com/markets/stocks/losers/',
    twn_gainers: 'https://tw.tradingview.com/markets/stocks-taiwan/market-movers-gainers/',
    twn_losers:  'https://tw.tradingview.com/markets/stocks-taiwan/market-movers-losers/',
};

const ETF_SYMBOLS = {
    '0050': { yahoo: '0050.TW', name: '元大台灣50' },
    '0052': { yahoo: '0052.TW', name: '富邦台50' },
};

const FUTURE_SYMBOLS = {
    WTX: {
        symbol: 'WTX&',
        name: '台指夜期',
        url: 'https://tw.stock.yahoo.com/future/WTX%26',
    },
};

// ==================== IMPROVED: Fetch Logoids (Tries NASDAQ + NYSE) from TradingView ====================

const TRADINGVIEW_CHART_BASE_US = 'https://www.tradingview.com/chart/pLzimNtz/?symbol=';
const TRADINGVIEW_CHART_BASE_TW = 'https://tw.tradingview.com/chart/pLzimNtz/?symbol=';

async function fetchLogoids(symbols) {
    if (!symbols || symbols.length === 0) return new Map();

    const tickers = symbols.flatMap(s => [
        `NASDAQ:${s.toUpperCase()}`,
        `NYSE:${s.toUpperCase()}`
    ]);

    const body = {
        filter: [],
        options: { lang: 'zh_TW' },
        markets: ['america'],
        symbols: { query: { types: [] }, tickers },
        columns: ['logoid'],
        range: [0, tickers.length + 5],
    };

    try {
        const json = await fetchPost('https://scanner.tradingview.com/america/scan', body);
        const data = JSON.parse(json).data || [];
        
        const infoMap = new Map();   // symbol -> {logoid, exchange}

        for (const row of data) {
            if (row.s && row.d && row.d[0]) {
                const fullSymbol = row.s;
                const logoid = row.d[0];
                const [exchange, cleanSymbol] = fullSymbol.split(':');
                
                if (cleanSymbol) {
                    infoMap.set(cleanSymbol.toUpperCase(), {
                        logoid: logoid,
                        exchange: exchange || 'NASDAQ'
                    });
                }
            }
        }
        
        console.log(` Fetched ${infoMap.size} stock info (logoid + exchange)`);
        return infoMap;
    } catch (e) {
        console.error('Failed to fetch logoids:', e.message);
        return new Map();
    }
}



function getTradingViewChartUrl(symbol, isTaiwan = false, exchangeInfo = null) {
    if (!symbol) return '#';

    const upper = symbol.toUpperCase().trim();

    let exchange = null;
    if (typeof exchangeInfo === 'string' && exchangeInfo.trim()) {
        exchange = exchangeInfo.trim().toUpperCase();
    } else if (exchangeInfo && typeof exchangeInfo.get === 'function') {
        const info = exchangeInfo.get(upper);
        exchange = info && typeof info === 'object' ? info.exchange : null;
    } else if (exchangeInfo && typeof exchangeInfo === 'object' && exchangeInfo.exchange) {
        exchange = String(exchangeInfo.exchange).toUpperCase();
    }

    if (isTaiwan) {
        return `${TRADINGVIEW_CHART_BASE_TW}${encodeURIComponent(`${exchange || 'TWSE'}:${upper}`)}`;
    }

    if (exchange) {
        return `${TRADINGVIEW_CHART_BASE_US}${encodeURIComponent(`${exchange}:${upper}`)}`;
    }

    return `${TRADINGVIEW_CHART_BASE_US}${encodeURIComponent(`NASDAQ:${upper}`)}`;
}

// ==================== Core Functions ====================


async function fetchData(url, redirectCount = 0) {
    if (redirectCount > 5) throw new Error('Exceeded max redirect limit');
    return new Promise((resolve, reject) => {
        const options = {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8',
            },
            timeout: 20000,
            maxHeaderSize: 128 * 1024,
        };

        https.get(url, options, res => {
            if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
                const next = res.headers.location.startsWith('http')
                    ? res.headers.location
                    : new URL(res.headers.location, url).href;
                return resolve(fetchData(next, redirectCount + 1));
            }
            if (res.statusCode !== 200) {
                return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

async function fetchPost(url, body) {
    const payload = JSON.stringify(body);
    const parsed = new URL(url);
    return new Promise((resolve, reject) => {
        const req = https.request({
            hostname: parsed.hostname,
            path: parsed.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Content-Length': Buffer.byteLength(payload),
            },
            timeout: 20000,
        }, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
                }
                resolve(data);
            });
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}

function formatVolume(value) {
    if (value == null || Number.isNaN(Number(value))) return 'N/A';
    const n = Number(value);
    if (n >= 1e9) return (n / 1e9).toFixed(3).replace(/\.?0+$/, '') + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(3).replace(/\.?0+$/, '') + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
    return n.toLocaleString('en-US');
}

function formatPercent(value) {
    if (value == null || Number.isNaN(Number(value))) return 'N/A';
    const n = Number(value);
    const sign = n > 0 ? '+' : '';
    return sign + n.toFixed(2) + '%';
}

function decodeHtmlText(value) {
    return String(value || '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
}

function htmlToTextLines(html) {
    return decodeHtmlText(html)
        .replace(/<script[\s\S]*?<\/script>/gi, '\n')
        .replace(/<style[\s\S]*?<\/style>/gi, '\n')
        .replace(/<[^>]+>/g, '\n')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);
}

function getLineValue(lines, label) {
    const idx = lines.findIndex(line => line === label || line.startsWith(label + ' '));
    if (idx === -1) return null;
    if (lines[idx] !== label) return lines[idx].slice(label.length).trim();
    return lines[idx + 1] || null;
}

// Parse Yahoo Finance HTML table (matches page volume e.g. 21.257M, not API rounded 22.29M)
function parseUSPage(html, logoMap = new Map()) {
    try {
        const stocks = [];
        const rowRegex = /<tr[^>]*data-testid-row[^>]*>([\s\S]*?)<\/tr>/gi;
        let rowMatch;

        while ((rowMatch = rowRegex.exec(html)) !== null && stocks.length < 10) {
            const row = rowMatch[1];
            const symMatch = row.match(/class="symbol[^"]*"[^>]*>([A-Z0-9.]+)/);
            if (!symMatch) continue;

			const symbol = symMatch[1].trim().toUpperCase();   // Force uppercase

            const nameMatch = row.match(/data-testid-cell="companyshortname\.raw"[^>]*>[\s\S]*?<div[^>]*>([^<]+)/);
            const priceMatch = row.match(/data-testid-cell="intradayprice"[^>]*>[\s\S]*?>([\d,.]+)/);
            const pctMatch = row.match(/data-testid-cell="percentchange"[^>]*>[\s\S]*?>([-+]?\d+\.\d+)%/);
            const volMatch = row.match(/data-testid-cell="dayvolume"[^>]*>[\s\S]*?>([\d,.]+[KMB]?)\s*</);

            let percent = pctMatch ? pctMatch[1] + '%' : 'N/A';
            if (percent !== 'N/A' && !percent.startsWith('+') && !percent.startsWith('-')) {
                percent = '+' + percent;
            }
		
			const logoInfo = logoMap.get(symbol);
			const logoid = logoInfo && typeof logoInfo === 'object' ? logoInfo.logoid : logoInfo;
			let icon = '';

			if (logoid) {
				icon = `https://s3-symbol-logo.tradingview.com/${logoid}--big.svg`;
			} else {
			// Try common slug patterns as final fallback
				const slug = symbol.toLowerCase()
					.replace(/[^a-z0-9]/g, '-')
					.replace(/-+/g, '-');
				icon = `https://s3-symbol-logo.tradingview.com/${slug}--big.svg`;
			}
 
			stocks.push({
                symbol,
                name: nameMatch ? nameMatch[1].trim() : 'N/A',
                price: priceMatch ? priceMatch[1].replace(/,/g, '') : 'N/A',
                percent_change: percent,
                volume: volMatch ? volMatch[1].trim() : 'N/A',
                icon,
				chart_url: getTradingViewChartUrl(symbol, false, logoMap)
            });
        }

        console.log(`✅Parsed ${stocks.length} US stocks from Yahoo with icons`);
        if (stocks.length === 0) {
            return [{ symbol: 'N/A', name: '解析失敗', price: 'N/A', percent_change: 'N/A', volume: 'N/A', icon: '' }];
        }
        return stocks;
    } catch (e) {
        console.error('US parse error:', e.message);
        return [];
    }
}

// Same data source as https://tw.tradingview.com/screener/ (scanner API)
// need: (2330,2454,2308,2317,3711,2383,2303,3037) sort by market capitalization/市場資本 desc
async function fetchTaiwanScreener(count = 8) {
const json = await fetchPost('https://scanner.tradingview.com/taiwan/scan', {
        filter: [],
        options: { lang: 'zh_TW' },
        markets: ['taiwan'],
        symbols: { query: { types: [] }, tickers: [] },
        columns: ['name', 'description', 'close', 'change', 'volume', 'logoid', 'market_cap_basic' ],
        sort: { sortBy: 'market_cap_basic', sortOrder: 'desc' },
        range: [0, count + 10],
    });

    const skipSymbols = new Set(['0050', '0052']);
    const stocks = [];
    for (const row of JSON.parse(json).data || []) {
        const [symbol, nameZh, price, changePct, volume, logoid, marketCap] = row.d;
        const code = String(symbol);
        if (skipSymbols.has(code)) continue;
        const exchange = row.s && row.s.includes(':') ? row.s.split(':')[0] : null;

        stocks.push({
            symbol: code,
            name: nameZh || 'N/A',
            price: price != null ? Number(price).toFixed(2) : 'N/A',
            percent_change: formatPercent(changePct),
            volume: formatVolume(volume),
            icon: logoid ? `https://s3-symbol-logo.tradingview.com/${logoid}--big.svg` : '',
			chart_url: getTradingViewChartUrl(code, true, exchange)
        });
        if (stocks.length >= count) break;
    }

    console.log(`✅Parsed ${stocks.length} Taiwan screener stocks (zh_TW names + logoid icons)`);
    return stocks;
}

async function fetchUSAScreener(count = 10) {
const json = await fetchPost('https://scanner.tradingview.com/america/scan', {
        filter: [],
        options: { lang: 'zh_TW' },
        markets: ['america'],
        symbols: { query: { types: [] }, tickers: [] },
        columns: ['name', 'description', 'close', 'change', 'volume', 'logoid', 'market_cap_basic' ],
        sort: { sortBy: 'market_cap_basic', sortOrder: 'desc' },
        range: [0, count + 10],
    });

    const skipSymbols = new Set(['GOOG', 'BRK.A', 'GGLBP']);
    const stocks = [];
    for (const row of JSON.parse(json).data || []) {
        const [symbol, nameZh, price, changePct, volume, logoid, marketCap] = row.d;
        const code = String(symbol);
        if (skipSymbols.has(code)) continue;
        const exchange = row.s && row.s.includes(':') ? row.s.split(':')[0] : null;

        stocks.push({
            symbol: code,
            name: nameZh || 'N/A',
            price: price != null ? Number(price).toFixed(2) : 'N/A',
            percent_change: formatPercent(changePct),
            volume: formatVolume(volume),
            icon: logoid ? `https://s3-symbol-logo.tradingview.com/${logoid}--big.svg` : '',
			chart_url: getTradingViewChartUrl(code, false, exchange)
        });
        if (stocks.length >= count) break;
    }

    console.log(`✅Parsed ${stocks.length} USA screener stocks (zh_TW names + logoid icons)`);
    return stocks;
}

async function fetchYahooETF(yahooSymbol, displaySymbol, displayName) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=1d&range=2d`;
    const json = await fetchData(url);
    const meta = JSON.parse(json)?.chart?.result?.[0]?.meta;
    if (!meta) {
        return { symbol: displaySymbol, 
		name: displayName, 
		price: 'N/A', 
		percent_change: 'N/A', 
		volume: 'N/A', 
		icon: '', 
		chart_url: getTradingViewChartUrl(displaySymbol, true)
		};
    }

    const price = meta.regularMarketPrice;
    const prev = meta.chartPreviousClose;
    const changePct = prev ? ((price - prev) / prev) * 100 : null;

    return {
        symbol: displaySymbol,
        name: displayName,
        price: price != null ? Number(price).toFixed(2) : 'N/A',
        percent_change: formatPercent(changePct),
        volume: formatVolume(meta.regularMarketVolume),
        icon: '', // 0050/0052: blank icon slot in HTML
		chart_url: getTradingViewChartUrl(displaySymbol, true)
    };
}

async function fetchYahooFuture(future) {
    const fallback = {
        symbol: future.symbol,
        name: future.name,
        price: 'N/A',
        percent_change: 'N/A',
        volume: 'N/A',
        icon: '',
        chart_url: future.url,
    };

    try {
        const html = await fetchData(future.url);
        const quoteMatch = html.match(/<span class="[^"]*C\(\$c-trend-(up|down)\)[^"]*"[^>]*>([\d,.]+(?:\.\d+)?)<\/span><div class="[^"]*"><span class="[^"]*C\(\$c-trend-\1\)[^"]*"[^>]*>[\s\S]*?([+-]?\d{1,3}(?:,\d{3})*(?:\.\d+)?)<\/span><span class="[^"]*C\(\$c-trend-\1\)[^"]*"[^>]*>\(([+-]?\d+(?:\.\d+)?)%\)<\/span>/);
        const trendMatch = html.match(/C\(\$c-trend-(up|down)\)/);
        const lines = htmlToTextLines(html);
        const symbolIdx = lines.findIndex(line => line === future.symbol);
        const searchLines = symbolIdx >= 0 ? lines.slice(symbolIdx + 1) : lines;

        const price = searchLines.find(line => /^-?\d{1,3}(,\d{3})*(\.\d+)?$/.test(line));
        const changeLine = searchLines.find(line => /^[-+]?\d{1,3}(,\d{3})*(\.\d+)?\([-+]?\d+(\.\d+)?%\)$/.test(line));
        const changeMatch = changeLine && changeLine.match(/^([-+]?\d{1,3}(?:,\d{3})*(?:\.\d+)?)\(([-+]?\d+(?:\.\d+)?)%\)$/);
        const percentLine = searchLines.find(line => /^\([-+]?\d+(\.\d+)?%\)$/.test(line));
        const percentLineMatch = percentLine && percentLine.match(/^\(([-+]?\d+(?:\.\d+)?)%\)$/);
        const volume = getLineValue(lines, '總量');

        let percent = 'N/A';
        if (quoteMatch) {
            const trend = quoteMatch[1];
            const percentValue = Math.abs(Number(quoteMatch[4]));
            const sign = trend === 'down' ? '-' : '+';
            percent = `${sign}${percentValue.toFixed(2)}%`;
        } else if (changeMatch) {
            const changeValue = Number(changeMatch[1].replace(/,/g, ''));
            const percentValue = Number(changeMatch[2]);
            const sign = changeValue > 0 || percentValue > 0 ? '+' : '';
            percent = `${sign}${percentValue.toFixed(2)}%`;
        } else if (percentLineMatch) {
            const percentValue = Math.abs(Number(percentLineMatch[1]));
            const sign = trendMatch?.[1] === 'down' ? '-' : (trendMatch?.[1] === 'up' ? '+' : '');
            percent = `${sign}${percentValue.toFixed(2)}%`;
        }

        return {
            ...fallback,
            price: quoteMatch ? quoteMatch[2].replace(/,/g, '') : (price ? price.replace(/,/g, '') : fallback.price),
            percent_change: percent,
            volume: volume || fallback.volume,
        };
    } catch (e) {
        console.error(`${future.symbol} fetch error:`, e.message);
        return fallback;
    }
}

// ==================== RESTORED/NOT USE: HTML Parser for TW Gainers/Losers ====================
function parseTradingView(html, isLoser = false) {
    try {
		// Try new method first - look for data in script tags or JSON
        // const dataMatch = html.match(/window\.__INITIAL_STATE__.*?=\s*({[\s\S]*?});/);
        // if (dataMatch) {
            // Advanced parsing if needed in future
        // }

        // Current working method (updated regex)
        const symMatch = html.match(/"symbols":\[([^\]]+)\]/);
        if (!symMatch) {
            console.warn("TradingView symbols not found, trying fallback...");
            return [];
        }

        const symbols = JSON.parse('[' + symMatch[1] + ']');

        const getSection = (id) => {
            const marker = `"id":"${id}","rawValues":`;
            const idx = html.indexOf(marker);
            if (idx === -1) return [];
            const start = html.indexOf('[', idx);
            let end = start, depth = 0;
            for (let i = start; i < html.length; i++) {
                if (html[i] === '[' || html[i] === '{') depth++;
                if (html[i] === ']' || html[i] === '}') depth--;
                if (depth === 0) { end = i + 1; break; }
            }
            try { return JSON.parse(html.substring(start, end)); } catch { return []; }
        };

        const tickers = getSection('TickerUniversal');
        const prices = getSection('Price');
        const changes = getSection('Change');
        const volumes = getSection('Volume');

        const stocks = symbols.slice(0, 10).map((sym, i) => {
            const t = tickers[i] || {};
            return {
                symbol: t.name || sym.split(':')[1] || sym,
                name: t.description || 'N/A',
                price: prices[i] !== undefined ? Number(prices[i]).toFixed(2) : 'N/A',
                percent_change: changes[i] !== undefined ? formatPercent(changes[i]) : 'N/A',
                volume: volumes[i] !== undefined ? formatVolume(volumes[i]) : 'N/A',
                icon: t.logoid ? `https://s3-symbol-logo.tradingview.com/${t.logoid}--big.svg` : '',
            };
        });

        console.log(`✅Parsed ${stocks.length} Taiwan stocks from HTML`);
        return stocks;
    } catch (e) {
        console.error('TradingView parse error:', e.message);
        return [];
    }
}

// Use TradingView Scanner API - Much more reliable
async function fetchTaiwanLosers(count = 10) {
    const body = {
filter: [
            { "left": "change", "operation": "eless", "right": -3 },
            { "left": "volume", "operation": "egreater", "right": 10000 },
            { "left": "close", "operation": "egreater", "right": 5 },
			{ "left": "market_cap_basic", "operation": "egreater", "right": 500000000 } // >500M TWD
        ],
        options: { lang: 'zh_TW' },
        markets: ['taiwan'],
        symbols: { query: { types: [] }, tickers: [] },
        columns: ['name', 'description', 'close', 'change', 'volume', 'logoid'],
        sort: { sortBy: 'change', sortOrder: 'asc' },
        range: [0, count],
    };

    try {
        const json = await fetchPost('https://scanner.tradingview.com/taiwan/scan', body);
        const data = JSON.parse(json).data || [];

        const stocks = data.map(row => {
            const [symbol, nameZh, price, changePct, volume, logoid] = row.d;
            const exchange = row.s && row.s.includes(':') ? row.s.split(':')[0] : null;
            return {
                symbol: String(symbol),
                name: nameZh || 'N/A',
                price: price != null ? Number(price).toFixed(2) : 'N/A',
                percent_change: formatPercent(changePct),
                volume: formatVolume(volume),
                icon: logoid ? `https://s3-symbol-logo.tradingview.com/${logoid}--big.svg` : '',
				chart_url: getTradingViewChartUrl(String(symbol), true, exchange)
            };
        });

        console.log(`✅Parsed ${stocks.length} Taiwan Losers from Scanner API`);
        return stocks;
    } catch (e) {
        console.error('Taiwan Losers fetch error:', e.message);
        return [];
    }
}

async function fetchTaiwanGainers(count = 10) {
    const body = {
filter: [
            { "left": "change", "operation": "egreater", "right": 3 },           // stronger change
            { "left": "volume", "operation": "egreater", "right": 10000 },      // decent volume
            { "left": "close", "operation": "egreater", "right": 5 },
            { "left": "market_cap_basic", "operation": "egreater", "right": 500000000 } // >500M TWD
        ],
        options: { lang: 'zh_TW' },
        markets: ['taiwan'],
        symbols: { query: { types: [] }, tickers: [] },
        columns: ['name', 'description', 'close', 'change', 'volume', 'logoid'],
        sort: { sortBy: 'change', sortOrder: 'desc' },
        range: [0, count],
    };

    try {
        const json = await fetchPost('https://scanner.tradingview.com/taiwan/scan', body);
        const data = JSON.parse(json).data || [];

        const stocks = data.map(row => {
            const [symbol, nameZh, price, changePct, volume, logoid] = row.d;
            const exchange = row.s && row.s.includes(':') ? row.s.split(':')[0] : null;
            return {
                symbol: String(symbol),
                name: nameZh || 'N/A',
                price: price != null ? Number(price).toFixed(2) : 'N/A',
                percent_change: formatPercent(changePct),
                volume: formatVolume(volume),
                icon: logoid ? `https://s3-symbol-logo.tradingview.com/${logoid}--big.svg` : '',
				chart_url: getTradingViewChartUrl(String(symbol), true, exchange)
            };
        });

        console.log(`✅Parsed ${stocks.length} Taiwan Gainers from Scanner API`);
        return stocks;
    } catch (e) {
        console.error('Taiwan Gainers fetch error:', e.message);
        return [];
    }
}

function normalizePath(url) {
    let p = decodeURIComponent((url || '/').split('?')[0]);
    if (!p || p === '') p = '/';
    if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
    return p;
}

function serveHtml(res) {
    fs.readFile(HTML_FILE, (err, data) => {
        if (err) {
            res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Cannot read top-gainer-loser.html: ' + err.message);
            return;
        }
        res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0',
        });
        res.end(data);
    });
}

async function handleApiStocks(res) {
//    console.log('Fetching stock data...');
    const [screenerTop10, usaGHtml, usaLHtml, twnG, twnL, screenerTop8, etf0050, etf0052, futureWTX] = await Promise.all([
	    fetchUSAScreener(10),
        fetchData(URLS.usa_gainers),
        fetchData(URLS.usa_losers),
        fetchData(URLS.twn_gainers),
        fetchData(URLS.twn_losers),
        fetchTaiwanScreener(8),
        fetchYahooETF(ETF_SYMBOLS['0050'].yahoo, '0050', ETF_SYMBOLS['0050'].name),
        fetchYahooETF(ETF_SYMBOLS['0052'].yahoo, '0052', ETF_SYMBOLS['0052'].name),
        fetchYahooFuture(FUTURE_SYMBOLS.WTX),
    ]);

// US Gainers/Losers with icons
    const tempGainers = parseUSPage(usaGHtml);
    const tempLosers = parseUSPage(usaLHtml);
    const [gainerLogos, loserLogos] = await Promise.all([
        fetchLogoids(tempGainers.map(s => s.symbol)),
        fetchLogoids(tempLosers.map(s => s.symbol))
    ]);

    // Final parse with icons
    const usaGainers = parseUSPage(usaGHtml, gainerLogos);
    const usaLosers = parseUSPage(usaLHtml, loserLogos);
	
    const data = {
		usa_screener: [...screenerTop10],
        usa_gainers: usaGainers,
        usa_losers:  usaLosers,
        twn_gainers: await fetchTaiwanGainers(10),     
        twn_losers:  await fetchTaiwanLosers(10),
        twn_screener: [...screenerTop8, etf0050, etf0052, futureWTX],
    };

    res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
    });
    res.end(JSON.stringify(data));
    console.log('✅Data sent successfully');
}

const server = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.writeHead(204);
        return res.end();
    }

    const urlPath = normalizePath(req.url);
    const htmlPaths = ['/', '/index.html', '/top-gainer-loser.html'];

    if (htmlPaths.includes(urlPath)) {
        return serveHtml(res);
    }

    if (urlPath === '/favicon.ico') {
        res.writeHead(204);
        return res.end();
    }

    if (urlPath === '/api/stocks' || urlPath === '/api-stocks') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        handleApiStocks(res).catch(error => {
            console.error('API Error:', error.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error.message }));
        });
        return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found', path: urlPath }));
});

server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}/api/stocks`);
    console.log('Local test: keep this running, then open top-gainer-loser.html in your browser');
}).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use (another server.js may still be running).`);
        console.error('Windows: netstat -ano | findstr :' + PORT);
        console.error('Then:   taskkill /PID <pid> /F');
    } else {
        console.error(err);
    }
    process.exit(1);
});
