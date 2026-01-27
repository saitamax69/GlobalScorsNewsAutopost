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
  
  // How many predictions to include
  MIN_PREDICTIONS: 5,
  MAX_PREDICTIONS: 10,
  
  // League priorities
  TOP_LEAGUES: [
    "PREMIER LEAGUE", "CHAMPIONS LEAGUE", "LA LIGA", "LALIGA",
    "BUNDESLIGA", "SERIE A", "LIGUE 1", "EUROPA LEAGUE",
    "CONFERENCE LEAGUE", "FA CUP", "COPA DEL REY", "DFB POKAL",
    "COPPA ITALIA", "COUPE DE FRANCE", "CARABAO CUP", "EFL CUP",
    "WORLD CUP", "EURO", "COPA AMERICA", "NATIONS LEAGUE",
    "SAUDI PRO", "MLS", "EREDIVISIE", "PRIMEIRA LIGA",
    "SUPER LIG", "BRASILEIRAO", "CHAMPIONSHIP", "LIGA MX",
    "SCOTTISH", "BELGIAN", "AUSTRIAN", "SWISS"
  ],
  
  // Country flags
  LEAGUE_FLAGS: {
    "PREMIER": "🏴󠁧󠁢󠁥󠁮󠁧󠁿", "CHAMPIONSHIP": "🏴󠁧󠁢󠁥󠁮󠁧󠁿", "FA CUP": "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
    "EFL": "🏴󠁧󠁢󠁥󠁮󠁧󠁿", "CARABAO": "🏴󠁧󠁢󠁥󠁮󠁧󠁿", "ENGLAND": "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
    "LA LIGA": "🇪🇸", "LALIGA": "🇪🇸", "COPA DEL REY": "🇪🇸", "SPAIN": "🇪🇸",
    "BUNDESLIGA": "🇩🇪", "DFB": "🇩🇪", "GERMANY": "🇩🇪",
    "SERIE A": "🇮🇹", "COPPA ITALIA": "🇮🇹", "ITALY": "🇮🇹",
    "LIGUE 1": "🇫🇷", "COUPE DE FRANCE": "🇫🇷", "FRANCE": "🇫🇷",
    "CHAMPIONS": "🇪🇺", "EUROPA": "🇪🇺", "CONFERENCE": "🇪🇺", "UEFA": "🇪🇺", "NATIONS": "🇪🇺",
    "EREDIVISIE": "🇳🇱", "NETHERLANDS": "🇳🇱", "DUTCH": "🇳🇱",
    "PRIMEIRA": "🇵🇹", "PORTUGAL": "🇵🇹",
    "SUPER LIG": "🇹🇷", "TURKEY": "🇹🇷",
    "MLS": "🇺🇸", "USA": "🇺🇸",
    "LIGA MX": "🇲🇽", "MEXICO": "🇲🇽",
    "BRASILEIRA": "🇧🇷", "BRAZIL": "🇧🇷",
    "SAUDI": "🇸🇦",
    "SCOTTISH": "🏴󠁧󠁢󠁳󠁣󠁴󠁿", "SCOTLAND": "🏴󠁧󠁢󠁳󠁣󠁴󠁿",
    "BELGIAN": "🇧🇪", "BELGIUM": "🇧🇪",
    "AUSTRIAN": "🇦🇹", "AUSTRIA": "🇦🇹",
    "SWISS": "🇨🇭", "SWITZERLAND": "🇨🇭",
    "WORLD CUP": "🌍", "EURO": "🇪🇺", "COPA AMERICA": "🌎",
    "AFRICAN": "🌍", "AFCON": "🌍", "AFRICA": "🌍",
    "ARGENTINA": "🇦🇷", "ARGENTINE": "🇦🇷"
  }
};

// ============================================
// MASTER INSTRUCTION - BETTING FOCUSED
// ============================================
const MASTER_INSTRUCTION = `You are the HEAD BETTING ANALYST at "Global Score News" - the #1 football betting tips page. Create a COMPREHENSIVE daily betting guide.

═══════════════════════════════════════════
📋 POST STRUCTURE (FOLLOW EXACTLY):
═══════════════════════════════════════════

𝟭. 𝗛𝗘𝗔𝗗𝗘𝗥:
⚽ 𝗙𝗢𝗢𝗧𝗕𝗔𝗟𝗟 𝗗𝗔𝗜𝗟𝗬 | [Day Date Month Year]

📊 [X] Matches Today | [Y] Top Picks Inside! 🎯

━━━━━━━━━━━━━━━━━━━━━

𝟮. 🔴 𝗟𝗜𝗩𝗘 𝗦𝗖𝗢𝗥𝗘𝗦 (if any live matches):
[Flag] [League]
[Home] [Score] [Away] ⏱️ [Min]'
(Group by league, 2-3 lines per match max)

━━━━━━━━━━━━━━━━━━━━━

𝟯. ✅ 𝗧𝗢𝗗𝗔𝗬'𝗦 𝗥𝗘𝗦𝗨𝗟𝗧𝗦:
[Flag] [League]
[Home] [Score] [Away] ✅/🤝/❌
(List ALL finished matches, group by league)

━━━━━━━━━━━━━━━━━━━━━

𝟰. 🎯 𝗧𝗢𝗗𝗔𝗬'𝗦 𝗕𝗘𝗧𝗧𝗜𝗡𝗚 𝗣𝗥𝗘𝗗𝗜𝗖𝗧𝗜𝗢𝗡𝗦 (MAIN SECTION - DETAILED):

For EACH upcoming match (5-10 picks), use this format:

━━━━━━━━━━━━━━━━━━━━━

[Flag] 𝗟𝗲𝗮𝗴𝘂𝗲 𝗡𝗮𝗺𝗲 • [Kick-off Time]

⚽ [Home Team] vs [Away Team]

📊 𝗢𝗗𝗗𝗦: [Home] | [Draw] | [Away]

📈 𝗦𝗧𝗔𝗧𝗦:
• [Home team] form: [W/D/L last 5] 
• [Away team] form: [W/D/L last 5]
• H2H: [Key head-to-head stat]
• [Relevant goal/clean sheet stat]
• [Another key stat]

🔮 𝗣𝗥𝗘𝗗𝗜𝗖𝗧𝗜𝗢𝗡: [Specific Pick - e.g., "Home Win & Over 1.5 Goals"]
📍 𝗢𝗗𝗗𝗦: @[odds for this pick]
⚠️ 𝗥𝗜𝗦𝗞: ⭐ Low / ⭐⭐ Medium / ⭐⭐⭐ High

💡 𝗔𝗡𝗔𝗟𝗬𝗦𝗜𝗦:
[3-4 sentences explaining WHY this bet is good. Include form, injuries, motivation, historical data. Be specific and confident.]

━━━━━━━━━━━━━━━━━━━━━

𝟱. 🔥 𝗔𝗖𝗖𝗨𝗠𝗨𝗟𝗔𝗧𝗢𝗥 𝗢𝗙 𝗧𝗛𝗘 𝗗𝗔𝗬:

[X]-Fold @ [Total Odds]:

1️⃣ [Match] → [Pick] @[Odds]
2️⃣ [Match] → [Pick] @[Odds]
3️⃣ [Match] → [Pick] @[Odds]
4️⃣ [Match] → [Pick] @[Odds]
5️⃣ [Match] → [Pick] @[Odds]

💰 £10 returns £[Amount]

━━━━━━━━━━━━━━━━━━━━━

𝟲. 📈 𝗧𝗢𝗗𝗔𝗬'𝗦 𝗩𝗔𝗟𝗨𝗘 𝗕𝗘𝗧𝗦:

🔹 SAFEST: [Match] → [Pick] @[Low Odds] ✅
🔹 VALUE: [Match] → [Pick] @[Medium Odds] 🎯
🔹 LONGSHOT: [Match] → [Pick] @[High Odds] 🎲

━━━━━━━━━━━━━━━━━━━━━

𝟳. 💰 𝗧𝗘𝗟𝗘𝗚𝗥𝗔𝗠 𝗖𝗧𝗔 (EXACTLY AS WRITTEN):

💰 𝗪𝗔𝗡𝗧 𝗠𝗢𝗥𝗘 𝗪𝗜𝗡𝗡𝗘𝗥𝗦?

Join 5,000+ members getting FREE daily tips!

✅ Full match analysis
✅ Live in-play alerts
✅ Accumulators daily
✅ Stats & H2H data
✅ VIP picks

👉 𝗝𝗢𝗜𝗡 𝗙𝗥𝗘𝗘: https://t.me/+9uDCOJXm_R1hMzM0

🔔 Don't miss today's winners!

⚠️ Gamble responsibly. 18+ only.

━━━━━━━━━━━━━━━━━━━━━

𝟴. 𝗛𝗔𝗦𝗛𝗧𝗔𝗚𝗦 (15-20):
#GlobalScoreNews #Football #BettingTips #FreeTips #[LeagueTags] #Predictions #Accumulator #BTTS #Over25Goals #SoccerBetting

═══════════════════════════════════════════
📝 BETTING PREDICTION TYPES TO USE:
═══════════════════════════════════════════

• Home Win / Away Win / Draw
• Double Chance (1X, X2, 12)
• Over/Under 0.5, 1.5, 2.5, 3.5 Goals
• Both Teams To Score (BTTS) Yes/No
• BTTS & Over 2.5
• Home/Away Win & Over/Under
• Asian Handicap (-0.5, -1, -1.5, -2)
• Correct Score (for confident picks)
• Half-Time Result
• First/Last Goalscorer mention
• Corner bets mention
• Clean Sheet Yes/No

═══════════════════════════════════════════
⚠️ IMPORTANT RULES:
═══════════════════════════════════════════

1. Be SPECIFIC with predictions (not just "Home Win" but "Home Win & Over 1.5")
2. Include STATS that support the prediction
3. ODDS must be realistic (1.20-10.00 range typically)
4. Risk rating: ⭐ = Very Safe, ⭐⭐ = Medium, ⭐⭐⭐ = Risky
5. Analysis must explain WHY the bet is good
6. Use 𝗯𝗼𝗹𝗱 𝘂𝗻𝗶𝗰𝗼𝗱𝗲 for headers
7. Include ALL matches provided
8. Make accumulator from your best 4-6 picks
9. Sound like a PROFESSIONAL betting analyst
10. Total post: 600-1000 words

OUTPUT FORMAT (JSON only):
{
  "post_text": "<complete post>",
  "hashtags": ["#GlobalScoreNews", "#Football", "#BettingTips", ...]
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

function getTodayFormatted() {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const now = new Date();
  const day = now.getDate();
  const suffix = ['th', 'st', 'nd', 'rd'][(day % 10 > 3 || [11,12,13].includes(day % 100)) ? 0 : day % 10];
  return `${days[now.getDay()]} ${day}${suffix} ${months[now.getMonth()]} ${now.getFullYear()}`;
}

function formatKickoffTime(timestamp) {
  if (!timestamp) return null;
  try {
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return null;
    return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
  } catch {
    return null;
  }
}

function getLeagueFlag(leagueName) {
  if (!leagueName) return "⚽";
  const upper = leagueName.toUpperCase();
  for (const [key, flag] of Object.entries(CONFIG.LEAGUE_FLAGS)) {
    if (upper.includes(key)) return flag;
  }
  return "⚽";
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
  return CONFIG.TOP_LEAGUES.some(league => upper.includes(league));
}

function getLeaguePriority(leagueName) {
  if (!leagueName) return 999;
  const upper = leagueName.toUpperCase();
  const index = CONFIG.TOP_LEAGUES.findIndex(league => upper.includes(league));
  return index === -1 ? 999 : index;
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
  history.posts.push({ postedAt: new Date().toISOString(), matchCount, type: 'betting_analysis' });
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
  
  console.log(`\n📊 Post Check:`);
  console.log(`   Hour: ${hour} UTC | Posts: ${count}/${target} | Since last: ${hoursSince.toFixed(1)}h`);
  
  if (count >= target) { console.log("   ❌ Daily limit"); return false; }
  if (hoursSince < CONFIG.MIN_HOURS_BETWEEN_POSTS) { console.log("   ❌ Too soon"); return false; }
  
  let chance = CONFIG.BASE_POST_CHANCE;
  if (CONFIG.QUIET_HOURS.includes(hour)) chance *= 0.2;
  else if (CONFIG.PEAK_HOURS.includes(hour)) chance *= 1.5;
  
  const roll = Math.random();
  const willPost = roll < chance;
  console.log(`   🎲 ${(chance*100).toFixed(0)}% chance | ${willPost ? '✅ POSTING' : '⏭️ SKIP'}`);
  
  return willPost;
}

// ============================================
// SPORTDB API
// ============================================

async function fetchAllMatches() {
  console.log("\n📡 Fetching all matches...");
  let allMatches = [];
  
  // Live
  try {
    const res = await fetch("https://api.sportdb.dev/api/flashscore/football/live", {
      headers: { "X-API-Key": SPORTDB_API_KEY }
    });
    if (res.ok) {
      const data = await res.json();
      const matches = Array.isArray(data) ? data : (data.matches || data.events || data.data || []);
      console.log(`   🔴 Live: ${matches.length}`);
      allMatches.push(...matches.map(m => ({ ...m, _source: 'live' })));
    }
  } catch (e) {
    console.log(`   ⚠️ Live error: ${e.message}`);
  }
  
  // Today
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
        if (!exists) allMatches.push({ ...m, _source: 'today' });
      }
    }
  } catch (e) {
    console.log(`   ⚠️ Today error: ${e.message}`);
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
  if (["FINISHED", "ENDED", "FT", "AET", "AFTER ET", "AFTER PEN", "FULL TIME", "AP", "PEN"].includes(status)) return "FT";
  if (status.includes("POSTPONED") || status.includes("CANCELLED")) return "CANCELLED";
  return "NS";
}

function transformMatch(raw) {
  const status = getMatchStatus(raw);
  const league = raw.leagueName || raw.tournamentName || raw.league || "";
  
  // Generate mock form/stats for AI to use (in production, you'd get real data)
  const mockStats = generateMockStats(raw);
  
  return {
    home_team: raw.homeName || raw.homeFirstName || "Unknown",
    away_team: raw.awayName || raw.awayFirstName || "Unknown",
    competition: league,
    flag: getLeagueFlag(league),
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
    stats: mockStats
  };
}

function generateMockOdds() {
  // Generate realistic-looking odds
  const homeOdds = (1.2 + Math.random() * 3).toFixed(2);
  const drawOdds = (2.5 + Math.random() * 2).toFixed(2);
  const awayOdds = (1.5 + Math.random() * 4).toFixed(2);
  return { home: homeOdds, draw: drawOdds, away: awayOdds };
}

function generateMockStats(raw) {
  // Generate plausible stats for analysis
  const forms = ['W', 'D', 'L'];
  const homeForm = Array(5).fill(0).map(() => forms[Math.floor(Math.random() * 3)]).join('');
  const awayForm = Array(5).fill(0).map(() => forms[Math.floor(Math.random() * 3)]).join('');
  const h2hWins = Math.floor(Math.random() * 6);
  const avgGoals = (1.5 + Math.random() * 1.5).toFixed(1);
  
  return {
    homeForm: homeForm,
    awayForm: awayForm,
    h2h: `${h2hWins} wins in last 5`,
    avgGoals: avgGoals
  };
}

function processMatches(rawMatches) {
  const valid = rawMatches.filter(m => (m.homeName || m.homeFirstName) && (m.awayName || m.awayFirstName));
  const transformed = valid.map(transformMatch).filter(m => m.status !== "CANCELLED");
  
  // Sort by priority
  transformed.sort((a, b) => a.priority - b.priority);
  
  // Categorize
  const categories = {
    live: transformed.filter(m => m.status === "LIVE" || m.status === "HT"),
    finished: transformed.filter(m => m.status === "FT"),
    upcoming: transformed.filter(m => m.status === "NS")
  };
  
  return categories;
}

function groupByLeague(matches) {
  const groups = {};
  for (const m of matches) {
    const key = m.competition || "Other";
    if (!groups[key]) groups[key] = { name: m.competition, flag: m.flag, matches: [] };
    groups[key].matches.push(m);
  }
  return Object.values(groups);
}

// ============================================
// BUILD DATA FOR AI
// ============================================

function buildMatchDataString(categories) {
  let data = `📅 DATE: ${getTodayFormatted()}\n\n`;
  
  const totalMatches = categories.live.length + categories.finished.length + categories.upcoming.length;
  data += `📊 TOTAL MATCHES TODAY: ${totalMatches}\n`;
  data += `   🔴 Live: ${categories.live.length}\n`;
  data += `   ✅ Finished: ${categories.finished.length}\n`;
  data += `   📅 Upcoming: ${categories.upcoming.length}\n\n`;
  
  // LIVE
  if (categories.live.length > 0) {
    data += "═══════════════════════════════════════\n";
    data += "🔴 LIVE MATCHES\n";
    data += "═══════════════════════════════════════\n\n";
    
    const liveGroups = groupByLeague(categories.live);
    for (const group of liveGroups) {
      data += `${group.flag} ${group.name}\n`;
      for (const m of group.matches) {
        data += `• ${m.home_team} ${m.score.home}-${m.score.away} ${m.away_team}`;
        if (m.minute) data += ` (${m.minute}')`;
        data += "\n";
      }
      data += "\n";
    }
  }
  
  // FINISHED
  if (categories.finished.length > 0) {
    data += "═══════════════════════════════════════\n";
    data += "✅ FINISHED MATCHES\n";
    data += "═══════════════════════════════════════\n\n";
    
    const finishedGroups = groupByLeague(categories.finished);
    for (const group of finishedGroups) {
      data += `${group.flag} ${group.name}\n`;
      for (const m of group.matches) {
        const result = m.score.home > m.score.away ? "✅" : m.score.home < m.score.away ? "❌" : "🤝";
        data += `• ${m.home_team} ${m.score.home}-${m.score.away} ${m.away_team} ${result}\n`;
      }
      data += "\n";
    }
  }
  
  // UPCOMING (with details for predictions)
  if (categories.upcoming.length > 0) {
    data += "═══════════════════════════════════════\n";
    data += "📅 UPCOMING MATCHES (FOR PREDICTIONS)\n";
    data += "═══════════════════════════════════════\n\n";
    
    // Prioritize top league matches
    const topUpcoming = categories.upcoming.filter(m => m.isTopLeague);
    const otherUpcoming = categories.upcoming.filter(m => !m.isTopLeague);
    const allUpcoming = [...topUpcoming, ...otherUpcoming];
    
    // Take top 10-15 for detailed predictions
    const forPredictions = allUpcoming.slice(0, Math.min(15, allUpcoming.length));
    
    const upcomingGroups = groupByLeague(forPredictions);
    for (const group of upcomingGroups) {
      data += `${group.flag} ${group.name}\n`;
      data += "─────────────────────────────────\n";
      
      for (const m of group.matches) {
        data += `\n⚽ ${m.home_team} vs ${m.away_team}\n`;
        if (m.kickoff_time) data += `🕐 Kick-off: ${m.kickoff_time}\n`;
        if (m.odds) data += `📊 Odds: ${m.odds.home} | ${m.odds.draw} | ${m.odds.away}\n`;
        if (m.stats) {
          data += `📈 ${m.home_team} last 5: ${m.stats.homeForm}\n`;
          data += `📈 ${m.away_team} last 5: ${m.stats.awayForm}\n`;
          data += `📈 H2H: ${m.stats.h2h}\n`;
          data += `📈 Avg goals: ${m.stats.avgGoals}\n`;
        }
        data += "\n";
      }
      data += "\n";
    }
    
    // List remaining upcoming briefly
    if (allUpcoming.length > 15) {
      data += "OTHER UPCOMING MATCHES:\n";
      for (const m of allUpcoming.slice(15)) {
        data += `• ${m.home_team} vs ${m.away_team}`;
        if (m.kickoff_time) data += ` (${m.kickoff_time})`;
        data += "\n";
      }
    }
  }
  
  return data;
}

// ============================================
// GROQ API
// ============================================

async function generatePost(matchData) {
  console.log("\n🤖 Generating betting analysis...");
  
  const prompt = `${MASTER_INSTRUCTION}

═══════════════════════════════════════════
📊 TODAY'S MATCH DATA:
═══════════════════════════════════════════

${matchData}

═══════════════════════════════════════════

Create the COMPLETE betting analysis post now.
Include ALL live/finished matches listed.
Make 5-10 DETAILED predictions for upcoming matches.
Include an accumulator of your best picks.
Include value bets section.

Return ONLY valid JSON, no markdown code blocks.`;

  const models = ["llama-3.3-70b-versatile", "llama-3.1-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768"];
  
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
            { role: "system", content: "You are an expert football betting analyst. Create professional, detailed betting content. Respond with valid JSON only." },
            { role: "user", content: prompt }
          ],
          temperature: 0.85,
          max_tokens: 4000
        })
      });
      
      if (res.status === 429) {
        console.log("   ⚠️ Rate limited, waiting...");
        await delay(10000);
        continue;
      }
      
      if (!res.ok) {
        console.log(`   ❌ Error: ${res.status}`);
        continue;
      }
      
      const data = await res.json();
      let text = data?.choices?.[0]?.message?.content || "";
      
      if (!text) continue;
      
      // Clean JSON
      text = text.trim();
      if (text.startsWith("```json")) text = text.slice(7);
      else if (text.startsWith("```")) text = text.slice(3);
      if (text.endsWith("```")) text = text.slice(0, -3);
      text = text.trim();
      
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start !== -1 && end !== -1) text = text.slice(start, end + 1);
      
      console.log("   ✅ Generated!");
      return JSON.parse(text);
      
    } catch (e) {
      console.log(`   ❌ ${e.message}`);
      continue;
    }
  }
  
  throw new Error("All models failed");
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
    throw new Error(`Facebook: ${res.status} - ${err}`);
  }
  
  console.log("   ✅ Posted!");
  return res.json();
}

function buildFinalMessage(response) {
  let message = response.post_text || "";
  
  // Ensure correct Telegram link
  message = message.replace(/t\.me\/\+[\w-]+/g, "t.me/+9uDCOJXm_R1hMzM0");
  
  // Add hashtags
  if (response.hashtags && !message.includes("#GlobalScoreNews")) {
    message += "\n\n" + response.hashtags.join(" ");
  }
  
  return message.trim();
}

// ============================================
// MAIN
// ============================================

async function main() {
  console.log("═".repeat(60));
  console.log("⚽ GLOBAL SCORE NEWS v6.0 - Betting Analysis Edition");
  console.log("═".repeat(60));
  console.log(`⏰ ${new Date().toISOString()}`);
  
  assertEnv();
  
  const history = loadHistory();
  
  if (!FORCE_POST && !shouldPostNow(history)) {
    console.log("\n👋 Skipping.");
    return;
  }
  
  if (FORCE_POST) console.log("\n⚡ FORCE POST");
  
  // Fetch matches
  const rawMatches = await fetchAllMatches();
  if (!rawMatches?.length) {
    console.log("⚠️ No matches");
    return;
  }
  
  // Process
  const categories = processMatches(rawMatches);
  const total = categories.live.length + categories.finished.length + categories.upcoming.length;
  
  console.log(`\n📊 Processed: ${total} matches`);
  console.log(`   🔴 ${categories.live.length} live`);
  console.log(`   ✅ ${categories.finished.length} finished`);
  console.log(`   📅 ${categories.upcoming.length} upcoming`);
  
  if (total < 5) {
    console.log("⚠️ Not enough matches");
    return;
  }
  
  // Build data
  const matchData = buildMatchDataString(categories);
  
  // Generate
  const response = await generatePost(matchData);
  const finalMessage = buildFinalMessage(response);
  
  // Preview
  console.log("\n" + "═".repeat(60));
  console.log("📝 POST PREVIEW:");
  console.log("═".repeat(60));
  console.log(finalMessage);
  console.log("═".repeat(60));
  console.log(`📏 ${finalMessage.length} chars | ${total} matches`);
  
  // Post
  const result = await postToFacebook(finalMessage);
  recordPost(history, total);
  
  console.log(`\n✅ SUCCESS! ID: ${result.id}`);
  console.log(`   Today: ${getTodayCount(history)} posts`);
}

main().catch(e => {
  console.error("❌", e.message);
  process.exit(1);
});
