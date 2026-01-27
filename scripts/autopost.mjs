import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// ============================================
// FILE PATHS
// ============================================
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = join(__dirname, '..', 'data');
const POSTED_FILE = join(DATA_DIR, 'posted.json');

// ============================================
// ENVIRONMENT VARIABLES
// ============================================
const SPORTDB_API_KEY = process.env.SPORTDB_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const FB_PAGE_ID = process.env.FB_PAGE_ID;
const FB_PAGE_ACCESS_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN;
const FORCE_POST = process.env.FORCE_POST === 'true';

// ============================================
// CONFIGURATION
// ============================================
const CONFIG = {
  MIN_POSTS_PER_DAY: 10,
  MAX_POSTS_PER_DAY: 14,
  MIN_HOURS_BETWEEN_POSTS: 1,
  PEAK_HOURS: [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22],
  QUIET_HOURS: [0, 1, 2, 3, 4, 5, 6, 7],
  BASE_POST_CHANCE: 0.25,
  PAGE_NAME: "Global Score News",
  TELEGRAM_URL: "https://t.me/+xAQ3DCVJa8A2ZmY8"
};

// ============================================
// MASTER INSTRUCTION FOR AI
// ============================================
const MASTER_INSTRUCTION = `You are a senior social media editor for the Facebook page "Global Score News." You write concise, clean, professional posts about football (soccer): live updates, results, analysis, previews, and predictions. You must ONLY use facts present in the provided match_data. Do not invent details.

Constraints and style:

First line = strong hook with 1–2 relevant emojis.
Total length: 45–110 words (tight, scannable).
Include team names, score/time, key scorers or moments if provided.
If odds are provided, mention them briefly (e.g., "Odds favor X at 1.85").
Use 3–6 tasteful emojis (no spam, no childish vibe).
End with a clear CTA: "Free tips + real-time alerts: Join our Telegram 👉 https://t.me/+xAQ3DCVJa8A2ZmY8"
Include 5–10 relevant hashtags. Always include #GlobalScoreNews.
For predictions: add disclaimer: "No guarantees. Bet responsibly (18+)."
Never claim certainty. Avoid clickbait. Keep it professional.
Tone: confident, neutral, energetic.

Output format (JSON only):
{
  "post_type": "<content type>",
  "post_text": "<facebook text>",
  "hashtags": ["#GlobalScoreNews", "..."],
  "safety_notes": "<caveats>"
}`;

// ============================================
// HELPER FUNCTIONS
// ============================================

function assertEnv() {
  const required = ["SPORTDB_API_KEY", "GROQ_API_KEY", "FB_PAGE_ID", "FB_PAGE_ACCESS_TOKEN"];
  for (const key of required) {
    if (!process.env[key]) throw new Error(`Missing: ${key}`);
  }
  console.log("✅ Environment OK");
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ============================================
// HISTORY MANAGEMENT
// ============================================

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function loadHistory() {
  ensureDataDir();
  if (!existsSync(POSTED_FILE)) return { posts: [], dailyCount: {}, lastPost: null };
  try {
    return JSON.parse(readFileSync(POSTED_FILE, 'utf-8'));
  } catch {
    return { posts: [], dailyCount: {}, lastPost: null };
  }
}

function saveHistory(history) {
  ensureDataDir();
  if (history.posts.length > 100) history.posts = history.posts.slice(-100);
  
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);
  const cutoffDate = cutoff.toISOString().split('T')[0];
  for (const date in history.dailyCount) {
    if (date < cutoffDate) delete history.dailyCount[date];
  }
  
  writeFileSync(POSTED_FILE, JSON.stringify(history, null, 2));
}

function getTodayDate() {
  return new Date().toISOString().split('T')[0];
}

function getTodayCount(history) {
  return history.dailyCount[getTodayDate()] || 0;
}

function getHoursSinceLastPost(history) {
  if (!history.lastPost) return 999;
  return (new Date() - new Date(history.lastPost)) / (1000 * 60 * 60);
}

function wasPosted(history, key) {
  return history.posts.some(p => p.matchKey === key);
}

function recordPost(history, key, info) {
  const today = getTodayDate();
  const now = new Date().toISOString();
  history.posts.push({ matchKey: key, matchInfo: info, postedAt: now });
  history.dailyCount[today] = (history.dailyCount[today] || 0) + 1;
  history.lastPost = now;
  saveHistory(history);
}

// ============================================
// RANDOM POSTING DECISION
// ============================================

function shouldPostNow(history) {
  const now = new Date();
  const hour = now.getUTCHours();
  const today = getTodayDate();
  const count = getTodayCount(history);
  const hoursSince = getHoursSinceLastPost(history);
  
  const seed = parseInt(today.replace(/-/g, ''));
  const target = CONFIG.MIN_POSTS_PER_DAY + (seed % (CONFIG.MAX_POSTS_PER_DAY - CONFIG.MIN_POSTS_PER_DAY + 1));
  
  console.log(`\n📊 Decision Check:`);
  console.log(`   Hour (UTC): ${hour} | Posts today: ${count}/${target}`);
  console.log(`   Hours since last: ${hoursSince.toFixed(1)}`);
  
  if (count >= target) { console.log(`   ❌ Daily limit`); return false; }
  if (hoursSince < CONFIG.MIN_HOURS_BETWEEN_POSTS) { console.log(`   ❌ Too soon`); return false; }
  
  let chance = CONFIG.BASE_POST_CHANCE;
  if (CONFIG.QUIET_HOURS.includes(hour)) chance *= 0.3;
  else if (CONFIG.PEAK_HOURS.includes(hour)) chance *= 1.5;
  
  const expected = (hour / 24) * target;
  if (count < expected - 2) chance *= 1.5;
  
  const roll = Math.random();
  const willPost = roll < chance;
  
  console.log(`   🎲 Chance: ${(chance * 100).toFixed(1)}% | Roll: ${(roll * 100).toFixed(1)}%`);
  console.log(`   ${willPost ? '✅ POSTING' : '⏭️ SKIP'}`);
  
  return willPost;
}

// ============================================
// SPORTDB API (with logos and odds)
// ============================================

async function fetchMatches() {
  console.log("\n📡 Fetching matches...");
  
  // Try live first
  let res = await fetch("https://api.sportdb.dev/api/flashscore/football/live", {
    headers: { "X-API-Key": SPORTDB_API_KEY }
  });
  
  if (res.ok) {
    const data = await res.json();
    const matches = Array.isArray(data) ? data : (data.matches || data.events || data.data || []);
    if (matches.length > 0) {
      console.log(`   Found ${matches.length} live matches`);
      return matches;
    }
  }
  
  // Fallback to today
  res = await fetch("https://api.sportdb.dev/api/flashscore/football/today", {
    headers: { "X-API-Key": SPORTDB_API_KEY }
  });
  
  if (!res.ok) throw new Error(`SportDB error: ${res.status}`);
  
  const data = await res.json();
  const matches = Array.isArray(data) ? data : (data.matches || data.events || data.data || []);
  console.log(`   Found ${matches.length} matches today`);
  return matches;
}

// ============================================
// ODDS API (Free)
// ============================================

async function fetchOdds(homeTeam, awayTeam) {
  // Try to get odds from the match data first
  // If not available, return default/null
  console.log("   📈 Checking for odds...");
  
  // You can integrate with free odds APIs here
  // For now, we'll use odds from SportDB if available
  return null;
}

// ============================================
// IMAGE GENERATION (Using Pollinations.ai - Free)
// ============================================

async function generateMatchImage(matchData) {
  console.log("\n🖼️ Generating match image...");
  
  const { home_team, away_team, score, status, competition, odds, homeLogo, awayLogo } = matchData;
  
  // Create image prompt for Pollinations
  const statusText = status === "LIVE" ? "🔴 LIVE" : 
                     status === "HT" ? "⏸️ HALF TIME" :
                     status === "FT" ? "✅ FULL TIME" : "📅 UPCOMING";
  
  const scoreText = status === "NS" ? "vs" : `${score.home} - ${score.away}`;
  
  // Pollinations.ai free image generation
  const prompt = encodeURIComponent(
    `Professional sports match graphic, dark blue gradient background, ` +
    `"${CONFIG.PAGE_NAME}" logo at top, ` +
    `${home_team} team emblem on left vs ${away_team} team emblem on right, ` +
    `score "${scoreText}" in center, ` +
    `"${competition}" text, ` +
    `"${statusText}" badge, ` +
    `modern minimalist design, high quality, 4k, sports broadcast style`
  );
  
  // Using Pollinations.ai (completely free, no API key needed)
  const imageUrl = `https://image.pollinations.ai/prompt/${prompt}?width=1200&height=630&nologo=true`;
  
  console.log(`   ✅ Image URL generated`);
  
  return imageUrl;
}

// Alternative: Create a simple HTML-based image using a service
async function generateSimpleMatchImage(matchData) {
  const { home_team, away_team, score, status, competition, homeLogo, awayLogo, odds } = matchData;
  
  const statusEmoji = status === "LIVE" ? "🔴" : 
                      status === "HT" ? "⏸️" :
                      status === "FT" ? "✅" : "📅";
  
  const statusText = status === "LIVE" ? "LIVE" : 
                     status === "HT" ? "HALF TIME" :
                     status === "FT" ? "FULL TIME" : "UPCOMING";
  
  const scoreText = status === "NS" ? "VS" : `${score.home} - ${score.away}`;
  
  // Build odds text if available
  let oddsText = "";
  if (odds && odds.home && odds.draw && odds.away) {
    oddsText = `${odds.home} | ${odds.draw} | ${odds.away}`;
  }
  
  // Use placeholder service with team logos
  // This creates a consistent branded image
  const params = new URLSearchParams({
    title: CONFIG.PAGE_NAME,
    home: home_team,
    away: away_team,
    score: scoreText,
    status: `${statusEmoji} ${statusText}`,
    league: competition,
    homeLogo: homeLogo || '',
    awayLogo: awayLogo || '',
    odds: oddsText,
    telegram: CONFIG.TELEGRAM_URL
  });
  
  // Using Pollinations for now (free)
  const prompt = encodeURIComponent(
    `Minimalist football match poster, navy blue background, ` +
    `white text "${CONFIG.PAGE_NAME}" header, ` +
    `"${home_team} ${scoreText} ${away_team}", ` +
    `"${competition}", "${statusEmoji} ${statusText}", ` +
    `clean modern sports design, no people, graphic design style`
  );
  
  return `https://image.pollinations.ai/prompt/${prompt}?width=1200&height=630&nologo=true`;
}

// ============================================
// MATCH SELECTION
// ============================================

function createMatchKey(m) {
  const home = m.homeName || m.homeFirstName || "";
  const away = m.awayName || m.awayFirstName || "";
  const status = (m.eventStage || m.status || "").toUpperCase();
  const score = `${m.homeScore || 0}-${m.awayScore || 0}`;
  return `${home}_${away}_${status}_${score}`;
}

function pickBestMatch(matches, history) {
  if (!matches?.length) return null;
  
  const valid = matches.filter(m => 
    (m.homeName || m.homeFirstName) && (m.awayName || m.awayFirstName)
  );
  
  console.log(`\n🔍 Finding match...`);
  console.log(`   Valid: ${valid.length}`);
  
  if (!valid.length) return null;
  
  const getStatus = (m) => (m.eventStage || m.status || "").toUpperCase();
  const notPosted = valid.filter(m => !wasPosted(history, createMatchKey(m)));
  
  console.log(`   Not posted: ${notPosted.length}`);
  
  const pool = notPosted.length ? notPosted : valid;
  
  // Priority order
  const priorities = [
    m => getStatus(m).includes("HALF") || getStatus(m) === "LIVE",
    m => getStatus(m).includes("HT"),
    m => getStatus(m) === "FINISHED" || getStatus(m) === "FT",
    () => true
  ];
  
  for (const check of priorities) {
    const filtered = pool.filter(check);
    if (filtered.length) {
      const pick = filtered[getRandomInt(0, filtered.length - 1)];
      console.log(`   ✅ Selected: ${pick.homeName} vs ${pick.awayName}`);
      return pick;
    }
  }
  
  return pool[0];
}

function transformMatch(raw) {
  const normalize = (s) => {
    const status = (s || "").toUpperCase();
    if (status.includes("HALF") || status === "LIVE" || status === "1H" || status === "2H") return "LIVE";
    if (status === "FINISHED" || status === "ENDED" || status === "FT") return "FT";
    if (status.includes("HT") || status === "HALFTIME") return "HT";
    return "NS";
  };
  
  // Extract odds if available
  let odds = null;
  if (raw.odds) {
    odds = {
      home: raw.odds.home || raw.odds["1"] || null,
      draw: raw.odds.draw || raw.odds["X"] || null,
      away: raw.odds.away || raw.odds["2"] || null
    };
  }
  
  return {
    competition: raw.leagueName || raw.tournamentName || "",
    home_team: raw.homeName || raw.homeFirstName || "Unknown",
    away_team: raw.awayName || raw.awayFirstName || "Unknown",
    status: normalize(raw.eventStage || raw.status),
    minute: raw.gameTime !== "-1" ? raw.gameTime : null,
    score: {
      home: parseInt(raw.homeScore) || parseInt(raw.homeFullTimeScore) || 0,
      away: parseInt(raw.awayScore) || parseInt(raw.awayFullTimeScore) || 0
    },
    homeLogo: raw.homeLogo || null,
    awayLogo: raw.awayLogo || null,
    odds: odds
  };
}

function getContentType(status) {
  return { "LIVE": "live_update", "HT": "half_time", "FT": "full_time" }[status] || "preview";
}

// ============================================
// GROQ API
// ============================================

async function generateText(contentType, matchData) {
  console.log("\n🤖 Generating text...");
  
  const input = {
    page_name: CONFIG.PAGE_NAME,
    telegram_cta_url: CONFIG.TELEGRAM_URL,
    content_type: contentType,
    match_data: matchData
  };

  const prompt = `${MASTER_INSTRUCTION}

Generate a ${contentType} post:

${JSON.stringify(input, null, 2)}

Return ONLY valid JSON.`;

  const models = [
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
    "llama3-70b-8192",
    "mixtral-8x7b-32768"
  ];
  
  for (const model of models) {
    try {
      console.log(`   Trying: ${model}`);
      
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${GROQ_API_KEY}`
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: "Respond with valid JSON only." },
            { role: "user", content: prompt }
          ],
          temperature: 0.7,
          max_tokens: 1024
        })
      });
      
      if (res.status === 429) {
        await delay(3000);
        continue;
      }
      
      if (!res.ok) continue;
      
      const data = await res.json();
      let text = data?.choices?.[0]?.message?.content || "";
      
      // Clean JSON
      text = text.trim();
      if (text.startsWith("```json")) text = text.slice(7);
      if (text.startsWith("```")) text = text.slice(3);
      if (text.endsWith("```")) text = text.slice(0, -3);
      text = text.trim();
      
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start !== -1 && end !== -1) text = text.slice(start, end + 1);
      
      console.log(`   ✅ Success!`);
      return JSON.parse(text);
      
    } catch (e) {
      continue;
    }
  }
  
  throw new Error("All models failed");
}

// ============================================
// FACEBOOK API (with image)
// ============================================

async function postToFacebook(message, imageUrl = null) {
  console.log("\n📘 Posting to Facebook...");
  
  let endpoint, body;
  
  if (imageUrl) {
    // Post with image
    endpoint = `https://graph.facebook.com/v19.0/${FB_PAGE_ID}/photos`;
    body = new URLSearchParams({
      url: imageUrl,
      caption: message,
      access_token: FB_PAGE_ACCESS_TOKEN
    });
    console.log(`   📷 With image`);
  } else {
    // Text only post
    endpoint = `https://graph.facebook.com/v19.0/${FB_PAGE_ID}/feed`;
    body = new URLSearchParams({
      message: message,
      access_token: FB_PAGE_ACCESS_TOKEN
    });
    console.log(`   📝 Text only`);
  }
  
  const res = await fetch(endpoint, {
    method: "POST",
    body: body
  });
  
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Facebook error ${res.status}: ${err}`);
  }
  
  return res.json();
}

function buildMessage(response) {
  const text = response.post_text || "";
  const tags = response.hashtags || [];
  
  if (text.includes("#GlobalScoreNews")) return text;
  return `${text}\n\n${tags.join(" ")}`.trim();
}

// ============================================
// MAIN
// ============================================

async function main() {
  console.log("🚀 Global Score News Autopost v2.0");
  console.log("=".repeat(50));
  console.log(`⏰ ${new Date().toISOString()}`);
  
  assertEnv();
  
  const history = loadHistory();
  
  if (!FORCE_POST && !shouldPostNow(history)) {
    console.log("\n👋 Skipping this run.");
    return;
  }
  
  if (FORCE_POST) console.log("\n⚡ FORCE POST");
  
  const matches = await fetchMatches();
  if (!matches?.length) { console.log("\n⚠️ No matches."); return; }
  
  const raw = pickBestMatch(matches, history);
  if (!raw) { console.log("\n⚠️ No match found."); return; }
  
  const match = transformMatch(raw);
  const key = createMatchKey(raw);
  
  console.log(`\n📋 Match: ${match.home_team} vs ${match.away_team}`);
  console.log(`   ${match.status} | ${match.score.home}-${match.score.away}`);
  console.log(`   ${match.competition}`);
  if (match.odds) {
    console.log(`   Odds: ${match.odds.home} | ${match.odds.draw} | ${match.odds.away}`);
  }
  
  if (match.home_team === "Unknown") { console.log("\n⚠️ Invalid data."); return; }
  
  const type = getContentType(match.status);
  
  // Generate text
  const response = await generateText(type, match);
  const message = buildMessage(response);
  
  // Generate image
  let imageUrl = null;
  try {
    imageUrl = await generateSimpleMatchImage(match);
    console.log(`   🖼️ Image ready`);
  } catch (e) {
    console.log(`   ⚠️ Image failed: ${e.message}`);
  }
  
  console.log("\n" + "=".repeat(50));
  console.log("📝 POST:");
  console.log("=".repeat(50));
  console.log(message);
  if (imageUrl) console.log(`\n🖼️ Image: ${imageUrl.slice(0, 80)}...`);
  console.log("=".repeat(50));
  
  // Post to Facebook
  const result = await postToFacebook(message, imageUrl);
  console.log(`\n✅ Posted! ID: ${result.id || result.post_id}`);
  
  // Record
  recordPost(history, key, {
    home: match.home_team,
    away: match.away_team,
    score: `${match.score.home}-${match.score.away}`,
    status: match.status
  });
  
  console.log(`📊 Today's posts: ${getTodayCount(history)}`);
}

main().catch((e) => {
  console.error("\n❌ Error:", e.message);
  process.exit(1);
});
