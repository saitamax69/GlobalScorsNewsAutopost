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
// MASTER INSTRUCTION
// ============================================
const MASTER_INSTRUCTION = `You are a senior social media editor for "Global Score News." Write concise, professional football posts.

Rules:
- First line: strong hook with 1-2 emojis
- Length: 45-110 words
- Include team names, score, competition
- If odds provided, mention briefly
- Use 3-6 emojis (professional, not childish)
- End with: "Free tips + alerts: Join Telegram 👉 https://t.me/+xAQ3DCVJa8A2ZmY8"
- Add 5-10 hashtags including #GlobalScoreNews
- For predictions: add "No guarantees. Bet responsibly (18+)."
- Tone: confident, neutral, energetic

Output JSON only:
{
  "post_text": "<facebook text>",
  "hashtags": ["#GlobalScoreNews", "..."]
}`;

// ============================================
// HELPERS
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
  history.posts.push({ matchKey: key, matchInfo: info, postedAt: new Date().toISOString() });
  history.dailyCount[today] = (history.dailyCount[today] || 0) + 1;
  history.lastPost = new Date().toISOString();
  saveHistory(history);
}

// ============================================
// SHOULD POST NOW
// ============================================

function shouldPostNow(history) {
  const hour = new Date().getUTCHours();
  const count = getTodayCount(history);
  const hoursSince = getHoursSinceLastPost(history);
  
  const seed = parseInt(getTodayDate().replace(/-/g, ''));
  const target = CONFIG.MIN_POSTS_PER_DAY + (seed % (CONFIG.MAX_POSTS_PER_DAY - CONFIG.MIN_POSTS_PER_DAY + 1));
  
  console.log(`\n📊 Check: ${count}/${target} posts | ${hoursSince.toFixed(1)}h since last`);
  
  if (count >= target) { console.log("   ❌ Daily limit"); return false; }
  if (hoursSince < CONFIG.MIN_HOURS_BETWEEN_POSTS) { console.log("   ❌ Too soon"); return false; }
  
  let chance = CONFIG.BASE_POST_CHANCE;
  if (CONFIG.QUIET_HOURS.includes(hour)) chance *= 0.3;
  else if (CONFIG.PEAK_HOURS.includes(hour)) chance *= 1.5;
  
  const roll = Math.random();
  const willPost = roll < chance;
  console.log(`   🎲 ${(chance * 100).toFixed(0)}% chance | ${willPost ? '✅ POST' : '⏭️ SKIP'}`);
  
  return willPost;
}

// ============================================
// SPORTDB API
// ============================================

async function fetchMatches() {
  console.log("\n📡 Fetching matches...");
  
  let res = await fetch("https://api.sportdb.dev/api/flashscore/football/live", {
    headers: { "X-API-Key": SPORTDB_API_KEY }
  });
  
  if (res.ok) {
    const data = await res.json();
    const matches = Array.isArray(data) ? data : (data.matches || data.events || data.data || []);
    if (matches.length > 0) {
      console.log(`   ${matches.length} live matches`);
      return matches;
    }
  }
  
  res = await fetch("https://api.sportdb.dev/api/flashscore/football/today", {
    headers: { "X-API-Key": SPORTDB_API_KEY }
  });
  
  if (!res.ok) throw new Error(`SportDB: ${res.status}`);
  
  const data = await res.json();
  const matches = Array.isArray(data) ? data : (data.matches || data.events || data.data || []);
  console.log(`   ${matches.length} matches today`);
  return matches;
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
  
  if (!valid.length) return null;
  
  const getStatus = (m) => (m.eventStage || m.status || "").toUpperCase();
  const notPosted = valid.filter(m => !wasPosted(history, createMatchKey(m)));
  const pool = notPosted.length ? notPosted : valid;
  
  // Priority: LIVE > HT > FT > Any
  for (const check of [
    m => getStatus(m).includes("HALF") || getStatus(m) === "LIVE",
    m => getStatus(m).includes("HT"),
    m => ["FINISHED", "FT", "ENDED"].includes(getStatus(m)),
    () => true
  ]) {
    const filtered = pool.filter(check);
    if (filtered.length) {
      return filtered[getRandomInt(0, filtered.length - 1)];
    }
  }
  
  return pool[0];
}

function transformMatch(raw) {
  const normalize = (s) => {
    const status = (s || "").toUpperCase();
    if (status.includes("HALF") || status === "LIVE" || status === "1H" || status === "2H") return "LIVE";
    if (["FINISHED", "ENDED", "FT"].includes(status)) return "FT";
    if (status.includes("HT") || status === "HALFTIME") return "HT";
    return "NS";
  };
  
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
    odds: raw.odds || null
  };
}

// ============================================
// IMAGE GENERATION (Using quickchart.io - FREE)
// ============================================

function generateMatchImage(match) {
  console.log("\n🖼️ Generating image...");
  
  const { home_team, away_team, score, status, competition, minute, odds, homeLogo, awayLogo } = match;
  
  // Status display
  const statusConfig = {
    "LIVE": { emoji: "🔴", text: "LIVE", color: "#e74c3c" },
    "HT": { emoji: "⏸️", text: "HALF TIME", color: "#f39c12" },
    "FT": { emoji: "✅", text: "FULL TIME", color: "#27ae60" },
    "NS": { emoji: "📅", text: "UPCOMING", color: "#3498db" }
  };
  
  const statusInfo = statusConfig[status] || statusConfig["NS"];
  const scoreText = status === "NS" ? "VS" : `${score.home} - ${score.away}`;
  const minuteText = minute && status === "LIVE" ? `${minute}'` : "";
  
  // Build odds text
  let oddsText = "";
  if (odds && (odds.home || odds["1"])) {
    const h = odds.home || odds["1"] || "-";
    const d = odds.draw || odds["X"] || "-";
    const a = odds.away || odds["2"] || "-";
    oddsText = `Odds: ${h} | ${d} | ${a}`;
  }
  
  // Use QuickChart.io to create a professional image
  // This creates a chart-style image that looks clean
  const chartConfig = {
    type: 'bar',
    data: {
      labels: [''],
      datasets: [{
        data: [0]
      }]
    },
    options: {
      plugins: {
        title: {
          display: true,
          text: [
            '⚽ GLOBAL SCORE NEWS',
            '',
            `${home_team}`,
            scoreText,
            `${away_team}`,
            '',
            `${statusInfo.emoji} ${statusInfo.text} ${minuteText}`,
            competition,
            '',
            oddsText,
            '📱 t.me/+xAQ3DCVJa8A2ZmY8'
          ],
          font: { size: 20, weight: 'bold' },
          color: '#ffffff',
          padding: 20
        },
        legend: { display: false }
      }
    }
  };
  
  // Encode for URL
  const chartUrl = `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(chartConfig))}&backgroundColor=%231a1a2e&width=800&height=600`;
  
  console.log("   ✅ Image URL ready");
  return chartUrl;
}

// Better option: Create text-based image using og-image style
function generateCleanImage(match) {
  console.log("\n🖼️ Creating match graphic...");
  
  const { home_team, away_team, score, status, competition, minute, odds } = match;
  
  const statusText = {
    "LIVE": "🔴 LIVE",
    "HT": "⏸️ HALF TIME", 
    "FT": "✅ FULL TIME",
    "NS": "📅 UPCOMING"
  }[status] || "📅 UPCOMING";
  
  const scoreText = status === "NS" ? "VS" : `${score.home} - ${score.away}`;
  const minuteText = minute && status === "LIVE" ? ` • ${minute}'` : "";
  
  let oddsLine = "";
  if (odds) {
    const h = odds.home || odds["1"];
    const d = odds.draw || odds["X"];
    const a = odds.away || odds["2"];
    if (h && d && a) oddsLine = `%0A%0AOdds: ${h} | ${d} | ${a}`;
  }
  
  // Using a simple image placeholder service
  // This creates clean, readable text on solid background
  const text = encodeURIComponent(
    `⚽ GLOBAL SCORE NEWS\n\n` +
    `${home_team}\n` +
    `${scoreText}\n` +
    `${away_team}\n\n` +
    `${statusText}${minuteText}\n` +
    `${competition}` +
    (oddsLine ? `\n\nOdds: ${odds?.home || '-'} | ${odds?.draw || '-'} | ${odds?.away || '-'}` : '') +
    `\n\n📱 Join Telegram for Tips`
  );
  
  // Using placehold.co for simple branded image
  const imageUrl = `https://placehold.co/1200x630/1a1a2e/ffffff?text=${text.replace(/\n/g, '%0A')}`;
  
  console.log("   ✅ Clean image ready");
  return imageUrl;
}

// BEST OPTION: No image, just great text
// Facebook posts with good text often perform BETTER than bad images

// ============================================
// GROQ API
// ============================================

async function generateText(match) {
  console.log("\n🤖 Generating post text...");
  
  const type = { "LIVE": "live_update", "HT": "half_time", "FT": "full_time" }[match.status] || "preview";
  
  const prompt = `${MASTER_INSTRUCTION}

Match: ${match.home_team} vs ${match.away_team}
Score: ${match.score.home} - ${match.score.away}
Status: ${match.status}${match.minute ? ` (${match.minute}')` : ''}
Competition: ${match.competition}
${match.odds ? `Odds: Home ${match.odds.home || match.odds["1"] || '-'} | Draw ${match.odds.draw || match.odds["X"] || '-'} | Away ${match.odds.away || match.odds["2"] || '-'}` : ''}

Generate a ${type} post. Return JSON only.`;

  const models = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768"];
  
  for (const model of models) {
    try {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${GROQ_API_KEY}`
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: "Respond with valid JSON only. No markdown." },
            { role: "user", content: prompt }
          ],
          temperature: 0.7,
          max_tokens: 800
        })
      });
      
      if (!res.ok) continue;
      
      const data = await res.json();
      let text = data?.choices?.[0]?.message?.content || "";
      
      // Clean JSON
      text = text.trim();
      if (text.startsWith("```")) text = text.replace(/```json?|```/g, "").trim();
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start !== -1 && end !== -1) text = text.slice(start, end + 1);
      
      console.log("   ✅ Text generated");
      return JSON.parse(text);
      
    } catch (e) {
      continue;
    }
  }
  
  throw new Error("Text generation failed");
}

// ============================================
// FACEBOOK API
// ============================================

async function postToFacebook(message, imageUrl = null) {
  console.log("\n📘 Posting to Facebook...");
  
  // Try with image first
  if (imageUrl) {
    try {
      const res = await fetch(`https://graph.facebook.com/v19.0/${FB_PAGE_ID}/photos`, {
        method: "POST",
        body: new URLSearchParams({
          url: imageUrl,
          caption: message,
          access_token: FB_PAGE_ACCESS_TOKEN
        })
      });
      
      if (res.ok) {
        console.log("   📷 Posted with image");
        return res.json();
      }
      console.log("   ⚠️ Image failed, posting text only");
    } catch (e) {
      console.log("   ⚠️ Image error, posting text only");
    }
  }
  
  // Fallback: text only
  const res = await fetch(`https://graph.facebook.com/v19.0/${FB_PAGE_ID}/feed`, {
    method: "POST",
    body: new URLSearchParams({
      message: message,
      access_token: FB_PAGE_ACCESS_TOKEN
    })
  });
  
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Facebook: ${res.status} - ${err}`);
  }
  
  console.log("   📝 Posted text");
  return res.json();
}

// ============================================
// MAIN
// ============================================

async function main() {
  console.log("🚀 Global Score News");
  console.log("=".repeat(40));
  
  assertEnv();
  
  const history = loadHistory();
  
  if (!FORCE_POST && !shouldPostNow(history)) {
    console.log("\n👋 Skipping.");
    return;
  }
  
  const matches = await fetchMatches();
  if (!matches?.length) { console.log("⚠️ No matches"); return; }
  
  const raw = pickBestMatch(matches, history);
  if (!raw) { console.log("⚠️ No match"); return; }
  
  const match = transformMatch(raw);
  console.log(`\n📋 ${match.home_team} ${match.score.home}-${match.score.away} ${match.away_team}`);
  console.log(`   ${match.status} | ${match.competition}`);
  
  if (match.home_team === "Unknown") { console.log("⚠️ Invalid"); return; }
  
  // Generate text
  const response = await generateText(match);
  const message = response.post_text + "\n\n" + (response.hashtags?.join(" ") || "#GlobalScoreNews #Football");
  
  // Option: Skip image for now (better engagement with good text)
  // Or use simple image
  let imageUrl = null;
  
  // Uncomment below to enable simple images:
  // imageUrl = generateCleanImage(match);
  
  console.log("\n" + "=".repeat(40));
  console.log(message);
  console.log("=".repeat(40));
  
  const result = await postToFacebook(message, imageUrl);
  console.log(`\n✅ Posted! ID: ${result.id || result.post_id}`);
  
  recordPost(history, createMatchKey(raw), {
    home: match.home_team,
    away: match.away_team,
    score: `${match.score.home}-${match.score.away}`
  });
  
  console.log(`📊 Today: ${getTodayCount(history)} posts`);
}

main().catch((e) => {
  console.error("❌", e.message);
  process.exit(1);
});
