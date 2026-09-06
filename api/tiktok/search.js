/**
 * TikTok Search API — Vercel Serverless Function
 * GET /api/tiktok/search?text=<query>&limit=10&apitoken=<optional>
 *
 * Scrapes TikTok's public search page and extracts the embedded
 * __UNIVERSAL_DATA_FOR_REHYDRATION__ JSON blob — no login / no
 * signing (X-Bogus / msToken) required.
 *
 * Response shape plugs directly into SHAVIYA-XMD's tt-search.js
 * (.tiktoksearch / .ts plugin) with zero code changes there:
 *   { "success": true, "data": [ { title, author, duration, link, nowm } ] }
 *
 * ── Vercel + Chromium fix ──────────────────────────────────────
 * This file must set AWS_LAMBDA_JS_RUNTIME *before* requiring
 * @sparticuz/chromium — the package reads that env var at import
 * time, so setting it after require() is too late. It's set here
 * as a code-level fallback, but for reliability also add it in the
 * Vercel Dashboard: Settings → Environment Variables →
 *   AWS_LAMBDA_JS_RUNTIME = nodejs20.x   (apply to all environments)
 * ─────────────────────────────────────────────────────────────
 */

if (!process.env.AWS_LAMBDA_JS_RUNTIME) {
    process.env.AWS_LAMBDA_JS_RUNTIME = "nodejs20.x";
}

const path = require("path");
const chromium = require("@sparticuz/chromium");
const puppeteer = require("puppeteer-core");

const API_TOKEN = process.env.API_TOKEN || ""; // optional: set in Vercel env vars

let browserPromise = null;

// Reuse the browser across warm invocations (Vercel keeps functions warm
// for a short window — this avoids relaunching Chromium every request).
async function getBrowser() {
    if (!browserPromise) {
        // No GPU in serverless — disable graphics mode to avoid the browser
        // freezing right after "new page" is created.
        if (typeof chromium.setGraphicsMode === "function") {
            chromium.setGraphicsMode(false);
        }

        const executablePath = await chromium.executablePath();

        // CRITICAL: tell the dynamic linker where the extracted .so files
        // (libnss3.so, libnspr4.so, etc.) live, or Chromium fails to start
        // with "error while loading shared libraries".
        process.env.LD_LIBRARY_PATH = path.dirname(executablePath);

        browserPromise = puppeteer.launch({
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath,
            headless: chromium.headless,
        });
    }
    return browserPromise;
}

async function tiktokSearch(query, limit = 10) {
    const browser = await getBrowser();
    const page = await browser.newPage();

    try {
        await page.setUserAgent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        );
        await page.setExtraHTTPHeaders({ "accept-language": "en-US,en;q=0.9" });

        const url = `https://www.tiktok.com/search/video?q=${encodeURIComponent(query)}`;
        await page.goto(url, { waitUntil: "networkidle2", timeout: 40000 });

        await page
            .waitForSelector('script#__UNIVERSAL_DATA_FOR_REHYDRATION__', { timeout: 12000 })
            .catch(() => {});

        const raw = await page.evaluate(() => {
            const el = document.querySelector('script#__UNIVERSAL_DATA_FOR_REHYDRATION__');
            return el ? el.textContent : null;
        });

        if (!raw) return [];

        const json = JSON.parse(raw);

        // TikTok nests search results under a scope keyed like
        // "webapp.search-detail" — path can shift, so walk defensively.
        const scopes = json?.["__DEFAULT_SCOPE__"] || {};
        const searchScope =
            scopes["webapp.search-detail"] ||
            scopes["webapp.search"] ||
            {};

        const items =
            searchScope?.data ||
            searchScope?.searchResult ||
            searchScope?.itemList ||
            [];

        const results = [];
        for (const entry of items) {
            const item = entry?.item || entry;
            if (!item?.video) continue;

            results.push({
                title: item.desc || "TikTok Video",
                author: item.author?.uniqueId || item.author?.nickname || "Unknown",
                duration: item.video?.duration ? `${item.video.duration}s` : "Unknown",
                link: `https://www.tiktok.com/@${item.author?.uniqueId}/video/${item.id}`,
                nowm: item.video?.playAddr || item.video?.downloadAddr || null,
            });
            if (results.length >= limit) break;
        }

        return results;
    } finally {
        await page.close();
    }
}

module.exports = async (req, res) => {
    const { text, q, apitoken, limit } = req.query;
    const query = text || q;

    if (API_TOKEN && apitoken !== API_TOKEN) {
        res.status(401).json({ success: false, error: "Invalid API token" });
        return;
    }
    if (!query) {
        res.status(400).json({ success: false, error: "Missing ?text= query parameter" });
        return;
    }

    try {
        const data = await tiktokSearch(query, Number(limit) || 10);
        if (!data.length) {
            res.status(404).json({ success: false, data: [], error: "No results found" });
            return;
        }
        res.status(200).json({ success: true, data });
    } catch (e) {
        console.error("[tiktok-search] error:", e.message);
        res.status(500).json({ success: false, error: e.message });
    }
};
