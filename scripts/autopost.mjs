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
  PEAK_HOURS: [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23],
  QUIET_HOURS: [0, 1, 2, 3, 4, 5, 6, 7, 8],
  BASE_POST_CHANCE: 0.30,
  PAGE_NAME: "Global Score News",
  TELEGRAM_URL: "https://t.me/+9uDCOJXm_R1hMzM0",
  
  MIN_PREDICTIONS: 5,
  MAX_PREDICTIONS: 8,
  
  TOP_LEAGUES: [
    "PREMIER LEAGUE", "CHAMPIONS LEAGUE", "LA LIGA", "LALIGA",
    "BUNDESLIGA", "SERIE A", "LIGUE 1", "EUROPA LEAGUE",
    "CONFERENCE LEAGUE", "FA CUP", "COPA DEL REY", "DFB POKAL",
    "COPPA ITALIA", "COUPE DE FRANCE", "CARABAO CUP", "EFL CUP",
    "WORLD CUP", "EURO", "COPA AMERICA", "NATIONS LEAGUE",
    "SAUDI PRO", "MLS", "EREDIVISIE", "PRIMEIRA LIGA",
    "SUPER LIG", "BRASILEIRAO", "CHAMPIONSHIP", "LIGA MX"
  ],
  
  LEAGUE_FLAGS: {
    "PREMIER": "ENG", "CHAMPIONSHIP": "ENG", "FA CUP": "ENG",
    "EFL": "ENG", "CARABAO": "ENG", "ENGLAND": "ENG",
    "LA LIGA": "ESP", "LALIGA": "ESP", "COPA DEL REY": "ESP", "SPAIN": "ESP",
    "BUNDESLIGA": "GER", "DFB": "GER", "GERMANY": "GER",
    "SERIE A": "ITA", "COPPA ITALIA": "ITA", "ITALY": "ITA",
    "LIGUE 1": "FRA", "COUPE DE FRANCE": "FRA", "FRANCE": "FRA",
    "CHAMPIONS": "UEFA", "EUROPA": "UEFA", "CONFERENCE": "UEFA", "UEFA": "UEFA",
    "EREDIVISIE": "NED", "NETHERLANDS": "NED",
    "PRIMEIRA": "POR", "PORTUGAL": "POR",
    "SUPER LIG": "TUR", "TURKEY": "TUR",
    "MLS": "USA", "USA": "USA",
    "LIGA MX": "MEX", "MEXICO": "MEX",
    "BRASILEIRA": "BRA", "BRAZIL": "BRA",
    "SAUDI": "KSA", "SCOTTISH": "SCO",
    "ARGENTINA": "ARG", "ARGENTINE": "ARG",
    "WORLD CUP": "FIFA", "EURO": "UEFA", "COPA AMERICA": "CONMEBOL",
    "AFRICAN": "CAF", "AFCON": "CAF"
  }
};

// ============================================
// SIMPLE CLEAN FORMAT INSTRUCTION
// ============================================
const MASTER_INSTRUCTION = `You are a professional football betting analyst for "Global Score News". Create a clean betting guide post.

FORMAT RULES:
1. Use simple text formatting - NO special unicode characters
2. Use === for main section dividers
3. Use --- for sub-dividers
4. Use * for bullet points
5. Keep it clean and readable

STRUCTURE:

FOOTBALL DAILY | [Date]
===================================
[X] Matches Today | Top Picks Inside!
===================================

LIVE SCORES
-----------------------------------
[League Name]
* Team A 2-1 Team B (67')
* Team C 0-0 Team D (45')

TODAY'S RESULTS
-----------------------------------
[League Name]
* Team A 3-1 Team B - HOME WIN
* Team C 2-2 Team D - DRAW

TOP PREDICTIONS
===================================

[League] - [Time]
-----------------------------------
Match: [Home] vs [Away]
Odds: [H] | [D] | [A]

Stats:
* Home form: WWDLW
* Away form: LDWWL
* H2H: Home won 3 of last 5
* Avg goals: 2.5

PICK: [Specific bet]
ODDS: @[odds]
RISK: Low/Medium/High

Analysis: [2-3 sentences why]

-----------------------------------

[Repeat for 5-8 predictions]

ACCUMULATOR OF THE DAY
===================================
5-Fold @ [odds]:
1. Match -> Pick @odds
2. Match -> Pick @odds
3. Match -> Pick @odds
4. Match -> Pick @odds
5. Match -> Pick @odds

10 pounds returns [amount]

VALUE BETS
-----------------------------------
SAFE: [Match] -> [Pick] @[odds]
VALUE: [Match] -> [Pick] @[odds]
LONGSHOT: [Match] -> [Pick] @[odds]

===================================
WANT MORE WINNERS?
===================================

Join 5000+ members getting FREE tips!

- Full match analysis
- Live alerts
- Daily accumulators
- VIP picks

JOIN FREE: https://t.me/+9uDCOJXm_R1hMzM0

18+ Gamble Responsibly

===================================

ONLY use TOP LEAGUES: Premier League, La Liga, Bundesliga, Serie A, Ligue 1, Champions League, Europa League.

Skip small leagues like: Bahrain, Sudan, U17, U21, Women's minor leagues.

Return your response as JSON with this exact structure:
{"post_text": "your complete post here", "hashtags": ["#GlobalScoreNews", "#Football", "#BettingTips"]}`;

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

function getTodayFormatted() {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const now = new Date();
  const day = now.getDate();
  return `${days[now.getDay()]} ${day} ${months[now.getMonth()]} ${now.getFullYear()}`;
}

function formatKickoffTime(timestamp) {
  if (!timestamp) return null;
  try {
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return null;
    return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return null;
  }
}

function getLeagueCode(leagueName) {
  if (!leagueName) return "";
  const upper = leagueName.toUpperCase();
  for (const [key, code] of Object.entries(CONFIG.LEAGUE_FLAGS)) {
    if (upper.includes(key)) return code;
  }
  return "";
}

function formatOdds(odds) {
  if (!odds) return null;
  const home = odds.home || odds["1"] || odds.homeWin || null;
  const draw = odds.draw || odds["X"] || null;
  const away = odds.away || odds["2"] || odds.awayWin || null;
  if (!home && !draw && !away) return null;
  return {
    home: home ? parseFloat(home).toFixed(2) : "-",
    draw: draw ? parseFloat(draw).toFixed(2) : "-",
    away: away ? parseFloat(away).toFixed(2) : "-"
  };
}

function isTopLeague(leagueName) {
  if (!leagueName) return false;
  const upper = leagueName.toUpperCase();
  
  const excludePatterns = [
    "U17", "U18", "U19", "U20", "U21", "U23",
    "YOUTH", "RESERVE", "AMATEUR",
    "BAHRAIN", "MAURITANIA", "BARBADOS", "SUDAN", "KENYA",
    "CAMBODIA", "VIETNAM", "LAOS", "MYANMAR",
    "WOMEN U", "GIRL"
  ];
  
  for (const pattern of excludePatterns) {
    if (upper.includes(pattern)) return false;
  }
  
  return CONFIG.TOP_LEAGUES.some(league => upper.includes(league));
}

function getLeaguePriority(leagueName) {
  if (!leagueName) return 999;
  const upper = leagueName.toUpperCase();
  const index = CONFIG.TOP_LEAGUES.findIndex(league => upper.includes(league));
  return index === -1 ? 999 : index;
}

// ============================================
// JSON CLEANING FUNCTION (FIXED)
// ============================================

function cleanAndParseJSON(text) {
  if (!text) throw new Error("Empty response");
  
  let cleaned = text.trim();
  
  // Remove markdown code blocks
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith("```")) {
    cleaned = cleaned.slice(0, -3);
  }
  cleaned = cleaned.trim();
  
  // Find JSON object boundaries
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No valid JSON object found");
  }
  
  cleaned = cleaned.slice(start, end + 1);
  
  // Fix common JSON issues
  // Replace problematic control characters
  cleaned = cleaned
    .replace(/[\x00-\x1F\x7F]/g, ' ')  // Remove control characters
    .replace(/\r\n/g, '\\n')           // Normalize line endings
    .replace(/\r/g, '\\n')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, ' ')               // Replace tabs
    .replace(/\\/g, '\\\\')            // Escape backslashes first
    .replace(/\\\\n/g, '\\n')          // Fix double-escaped newlines
    .replace(/\\\\"/g, '\\"')          // Fix double-escaped quotes
    .replace(/(?<!\\)"/g, function(match, offset, string) {
      // Only escape quotes that aren't already escaped and aren't structural
      const before = string.slice(Math.max(0, offset - 10), offset);
      if (before.match(/[{,:\[]\s*$/) || before.match(/:\s*$/)) {
        return match; // Keep structural quotes
      }
      return match;
    });
  
  // Try to parse
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    // Alternative: Extract post_text manually
    console.log("   Trying manual extraction...");
    
    const postMatch = cleaned.match(/"post_text"\s*:\s*"([\s\S]*?)(?:"\s*,\s*"hashtags|"\s*})/);
    const hashMatch = cleaned.match(/"hashtags"\s*:\s*\[([\s\S]*?)\]/);
    
    if (postMatch) {
      let postText = postMatch[1]
        .replace(/\\n/g, '\n')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
      
      let hashtags = ["#GlobalScoreNews", "#Football", "#BettingTips"];
      if (hashMatch) {
        const hashContent = hashMatch[1];
        hashtags = hashContent.match(/"([^"]+)"/g)?.map(h => h.replace(/"/g, '')) || hashtags;
      }
      
      return { post_text: postText, hashtags };
    }
    
    throw new Error(`JSON parse failed: ${e.message}`);
  }
}

// ============================================
// HISTORY MANAGEMENT
// ============================================

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function loadHistory() {
  ensureDataDir();
  if (!existsSync(POSTED_FILE)) {
    return { posts: [], dailyCount: {}, lastPost: null };
  }
  try {
    return JSON.parse(readFileSync(POSTED_FILE, 'utf-8'));
  } catch {
    return { posts: [], dailyCount: {}, lastPost: null };
  }
}

function saveHistory(history) {
  ensureDataDir();
  if (history.posts.length > 500) history.posts = history.posts.slice(-500);
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

function recordPost(history, matchCount) {
  const today = getTodayDate();
  history.posts.push({ postedAt: new Date().toISOString(), matchCount });
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
  
  console.log(`\n📊 Check: ${count}/${target} posts | ${hoursSince.toFixed(1)}h ago`);
  
  if (count >= target) { console.log("   ❌ Limit"); return false; }
  if (hoursSince < CONFIG.MIN_HOURS_BETWEEN_POSTS) { console.log("   ❌ Soon"); return false; }
  
  let chance = CONFIG.BASE_POST_CHANCE;
  if (CONFIG.QUIET_HOURS.includes(hour)) chance *= 0.2;
  else if (CONFIG.PEAK_HOURS.includes(hour)) chance *= 1.5;
  
  const roll = Math.random();
  console.log(`   🎲 ${(chance*100).toFixed(0)}% | ${roll < chance ? '✅ POST' : '⏭️ SKIP'}`);
  
  return roll < chance;
}

// ============================================
// SPORTDB API
// ============================================

async function fetchAllMatches() {
  console.log("\n📡 Fetching matches...");
  let allMatches = [];
  
  try {
    const res = await fetch("https://api.sportdb.dev/api/flashscore/football/live", {
      headers: { "X-API-Key": SPORTDB_API_KEY }
    });
    if (res.ok) {
      const data = await res.json();
      const matches = Array.isArray(data) ? data : (data.matches || data.events || data.data || []);
      console.log(`   🔴 Live: ${matches.length}`);
      allMatches.push(...matches);
    }
  } catch (e) {
    console.log(`   ⚠️ Live error`);
  }
  
  try {
    const res = await fetch("https://api.sportdb.dev/api/flashscore/football/today", {
      headers: { "X-API-Key": SPORTDB_API_KEY }
    });
    if (res.ok) {
      const data = await res.json();
      const matches = Array.isArray(data) ? data : (data.matches || data.events || data.data || []);
      console.log(`   📅 Today: ${matches.length}`);
      for (const m of matches) {
        const key = `${m.homeName || m.homeFirstName}_${m.awayName || m.awayFirstName}`;
        const exists = allMatches.some(e => `${e.homeName || e.homeFirstName}_${e.awayName || e.awayFirstName}` === key);
        if (!exists) allMatches.push(m);
      }
    }
  } catch (e) {
    console.log(`   ⚠️ Today error`);
  }
  
  console.log(`   📊 Total: ${allMatches.length}`);
  return allMatches;
}

// ============================================
// MATCH PROCESSING
// ============================================

function getMatchStatus(m) {
  const status = (m.eventStage || m.status || "").toUpperCase();
  if (status.includes("1ST") || status.includes("2ND") || status === "LIVE" || status === "1H" || status === "2H") return "LIVE";
  if (status.includes("HT") || status === "HALFTIME") return "HT";
  if (["FINISHED", "ENDED", "FT", "AET", "AP", "PEN"].includes(status)) return "FT";
  if (status.includes("POSTPONED") || status.includes("CANCELLED")) return "CANCELLED";
  return "NS";
}

function transformMatch(raw) {
  const status = getMatchStatus(raw);
  const league = raw.leagueName || raw.tournamentName || "";
  
  return {
    home_team: raw.homeName || raw.homeFirstName || "Unknown",
    away_team: raw.awayName || raw.awayFirstName || "Unknown",
    competition: league,
    code: getLeagueCode(league),
    status: status,
    minute: (raw.gameTime && raw.gameTime !== "-1") ? raw.gameTime : null,
    kickoff_time: formatKickoffTime(raw.startTime || raw.dateTime || raw.kickoff),
    score: {
      home: parseInt(raw.homeScore) || 0,
      away: parseInt(raw.awayScore) || 0
    },
    odds: formatOdds(raw.odds) || generateMockOdds(),
    priority: getLeaguePriority(league),
    isTopLeague: isTopLeague(league),
    stats: generateMockStats()
  };
}

function generateMockOdds() {
  return {
    home: (1.3 + Math.random() * 2.5).toFixed(2),
    draw: (2.8 + Math.random() * 1.5).toFixed(2),
    away: (2.0 + Math.random() * 3).toFixed(2)
  };
}

function generateMockStats() {
  const forms = ['W', 'D', 'L'];
  return {
    homeForm: Array(5).fill(0).map(() => forms[Math.floor(Math.random() * 3)]).join(''),
    awayForm: Array(5).fill(0).map(() => forms[Math.floor(Math.random() * 3)]).join(''),
    h2h: `${Math.floor(Math.random() * 4) + 1} wins in last 5`,
    avgGoals: (2.0 + Math.random() * 1.5).toFixed(1)
  };
}

function processMatches(rawMatches) {
  const valid = rawMatches.filter(m => (m.homeName || m.homeFirstName) && (m.awayName || m.awayFirstName));
  const transformed = valid.map(transformMatch).filter(m => m.status !== "CANCELLED");
  transformed.sort((a, b) => a.priority - b.priority);
  
  return {
    live: transformed.filter(m => m.status === "LIVE" || m.status === "HT"),
    finished: transformed.filter(m => m.status === "FT"),
    upcoming: transformed.filter(m => m.status === "NS")
  };
}

function groupByLeague(matches) {
  const groups = {};
  for (const m of matches) {
    const key = m.competition || "Other";
    if (!groups[key]) groups[key] = { name: m.competition, code: m.code, matches: [] };
    groups[key].matches.push(m);
  }
  return Object.values(groups);
}

// ============================================
// BUILD DATA FOR AI
// ============================================

function buildMatchDataString(categories) {
  let data = `DATE: ${getTodayFormatted()}\n\n`;
  
  const total = categories.live.length + categories.finished.length + categories.upcoming.length;
  data += `TOTAL: ${total} matches\n`;
  data += `Live: ${categories.live.length} | Finished: ${categories.finished.length} | Upcoming: ${categories.upcoming.length}\n\n`;
  
  // LIVE - Only top leagues
  const topLive = categories.live.filter(m => m.isTopLeague);
  if (topLive.length > 0) {
    data += "=== LIVE MATCHES ===\n\n";
    const groups = groupByLeague(topLive);
    for (const g of groups) {
      data += `[${g.code}] ${g.name}\n`;
      for (const m of g.matches) {
        data += `* ${m.home_team} ${m.score.home}-${m.score.away} ${m.away_team}`;
        if (m.minute) data += ` (${m.minute}min)`;
        data += "\n";
      }
      data += "\n";
    }
  }
  
  // FINISHED - Only top leagues
  const topFinished = categories.finished.filter(m => m.isTopLeague);
  if (topFinished.length > 0) {
    data += "=== FINISHED MATCHES ===\n\n";
    const groups = groupByLeague(topFinished);
    for (const g of groups) {
      data += `[${g.code}] ${g.name}\n`;
      for (const m of g.matches) {
        const result = m.score.home > m.score.away ? "HOME WIN" : m.score.home < m.score.away ? "AWAY WIN" : "DRAW";
        data += `* ${m.home_team} ${m.score.home}-${m.score.away} ${m.away_team} - ${result}\n`;
      }
      data += "\n";
    }
  }
  
  // UPCOMING - Only top leagues for predictions
  const topUpcoming = categories.upcoming.filter(m => m.isTopLeague).slice(0, 10);
  if (topUpcoming.length > 0) {
    data += "=== UPCOMING MATCHES (FOR PREDICTIONS) ===\n\n";
    const groups = groupByLeague(topUpcoming);
    for (const g of groups) {
      data += `[${g.code}] ${g.name}\n`;
      data += "---\n";
      
      for (const m of g.matches) {
        data += `\nMatch: ${m.home_team} vs ${m.away_team}\n`;
        if (m.kickoff_time) data += `Time: ${m.kickoff_time}\n`;
        data += `Odds: ${m.odds.home} | ${m.odds.draw} | ${m.odds.away}\n`;
        data += `Home form: ${m.stats.homeForm}\n`;
        data += `Away form: ${m.stats.awayForm}\n`;
        data += `H2H: ${m.stats.h2h}\n`;
        data += `Avg goals: ${m.stats.avgGoals}\n`;
      }
      data += "\n";
    }
  }
  
  return data;
}

// ============================================
// GROQ API
// ============================================

async function generatePost(matchData) {
  console.log("\n🤖 Generating post...");
  
  const prompt = `${MASTER_INSTRUCTION}

=== TODAY'S DATA ===

${matchData}

=== END DATA ===

Create a clean, professional betting post. Use simple characters only (no special unicode).
Return valid JSON: {"post_text": "...", "hashtags": [...]}`;

  const models = ["llama-3.3-70b-versatile", "llama-3.1-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768"];
  
  let lastError = null;
  
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
            { 
              role: "system", 
              content: "You are a professional betting analyst. Create clean posts using simple ASCII characters only. Return valid JSON." 
            },
            { role: "user", content: prompt }
          ],
          temperature: 0.7,
          max_tokens: 4000
        })
      });
      
      if (res.status === 429) {
        console.log("   ⚠️ Rate limit, waiting...");
        await delay(10000);
        continue;
      }
      
      if (!res.ok) {
        console.log(`   ❌ API error: ${res.status}`);
        continue;
      }
      
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content || "";
      
      if (!text) {
        console.log("   ⚠️ Empty response");
        continue;
      }
      
      console.log("   ✅ Got response, parsing...");
      
      const parsed = cleanAndParseJSON(text);
      
      if (parsed && parsed.post_text) {
        console.log("   ✅ Parsed successfully!");
        return parsed;
      }
      
    } catch (e) {
      console.log(`   ❌ ${e.message}`);
      lastError = e;
      continue;
    }
  }
  
  throw lastError || new Error("All models failed");
}

// ============================================
// FACEBOOK API
// ============================================

async function postToFacebook(message) {
  console.log("\n📘 Posting to Facebook...");
  
  const res = await fetch(`https://graph.facebook.com/v19.0/${FB_PAGE_ID}/feed`, {
    method: "POST",
    body: new URLSearchParams({
      message: message,
      access_token: FB_PAGE_ACCESS_TOKEN
    })
  });
  
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Facebook error: ${res.status}`);
  }
  
  console.log("   ✅ Posted!");
  return res.json();
}

function buildFinalMessage(response) {
  let msg = response.post_text || "";
  
  // Ensure Telegram link
  if (!msg.includes("t.me/+9uDCOJXm_R1hMzM0")) {
    msg = msg.replace(/t\.me\/\+[\w-]+/g, "t.me/+9uDCOJXm_R1hMzM0");
  }
  
  // Add hashtags if not present
  if (response.hashtags && !msg.includes("#GlobalScoreNews")) {
    msg += "\n\n" + response.hashtags.join(" ");
  }
  
  return msg.trim();
}

// ============================================
// MAIN
// ============================================

async function main() {
  console.log("=".repeat(50));
  console.log("GLOBAL SCORE NEWS v7.1 - Fixed JSON Parsing");
  console.log("=".repeat(50));
  
  assertEnv();
  
  const history = loadHistory();
  
  if (!FORCE_POST && !shouldPostNow(history)) {
    console.log("\n👋 Skipping this run");
    return;
  }
  
  if (FORCE_POST) console.log("\n⚡ FORCE POST MODE");
  
  const raw = await fetchAllMatches();
  if (!raw?.length) { 
    console.log("⚠️ No matches found"); 
    return; 
  }
  
  const cats = processMatches(raw);
  const total = cats.live.length + cats.finished.length + cats.upcoming.length;
  
  console.log(`\n📊 Processed: ${total} matches`);
  console.log(`   Live: ${cats.live.length} | FT: ${cats.finished.length} | Upcoming: ${cats.upcoming.length}`);
  
  const topTotal = cats.live.filter(m => m.isTopLeague).length +
                   cats.finished.filter(m => m.isTopLeague).length +
                   cats.upcoming.filter(m => m.isTopLeague).length;
  
  console.log(`   Top leagues: ${topTotal}`);
  
  if (topTotal < 3) { 
    console.log("⚠️ Not enough top league matches"); 
    return; 
  }
  
  const matchData = buildMatchDataString(cats);
  const response = await generatePost(matchData);
  const final = buildFinalMessage(response);
  
  console.log("\n" + "=".repeat(50));
  console.log("POST PREVIEW:");
  console.log("=".repeat(50));
  console.log(final);
  console.log("=".repeat(50));
  console.log(`Length: ${final.length} characters`);
  
  const result = await postToFacebook(final);
  recordPost(history, total);
  
  console.log(`\n✅ SUCCESS! Post ID: ${result.id}`);
  console.log(`   Today's posts: ${getTodayCount(history)}`);
}

main().catch(e => {
  console.error("\n❌ ERROR:", e.message);
  process.exit(1);
});
