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
  
  TOP_LEAGUES: [
    "PREMIER LEAGUE", "CHAMPIONS LEAGUE", "LA LIGA", "LALIGA",
    "BUNDESLIGA", "SERIE A", "LIGUE 1", "EUROPA LEAGUE",
    "FA CUP", "COPA DEL REY", "DFB POKAL", "COPPA ITALIA",
    "CARABAO CUP", "SAUDI PRO", "MLS", "EREDIVISIE",
    "CHAMPIONSHIP", "LIGA MX", "BRASILEIRAO"
  ],
  
  LEAGUE_FLAGS: {
    "PREMIER": "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
    "CHAMPIONSHIP": "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
    "FA CUP": "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
    "ENGLAND": "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
    "LA LIGA": "🇪🇸",
    "LALIGA": "🇪🇸",
    "SPAIN": "🇪🇸",
    "BUNDESLIGA": "🇩🇪",
    "GERMANY": "🇩🇪",
    "SERIE A": "🇮🇹",
    "ITALY": "🇮🇹",
    "LIGUE 1": "🇫🇷",
    "FRANCE": "🇫🇷",
    "CHAMPIONS": "🇪🇺",
    "EUROPA": "🇪🇺",
    "EREDIVISIE": "🇳🇱",
    "MLS": "🇺🇸",
    "LIGA MX": "🇲🇽",
    "BRAZIL": "🇧🇷",
    "SAUDI": "🇸🇦",
    "SCOTLAND": "🏴󠁧󠁢󠁳󠁣󠁴󠁿",
    "ARGENTINA": "🇦🇷"
  }
};

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
  return `${days[now.getDay()]} ${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;
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
  const home = odds.home || odds["1"] || null;
  const draw = odds.draw || odds["X"] || null;
  const away = odds.away || odds["2"] || null;
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
  
  const exclude = ["U17", "U18", "U19", "U20", "U21", "U23", "YOUTH", "RESERVE", "WOMEN U", "GIRL"];
  for (const p of exclude) {
    if (upper.includes(p)) return false;
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
  if (history.posts.length > 500) history.posts = history.posts.slice(-500);
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

function recordPost(history, count) {
  const today = getTodayDate();
  history.posts.push({ postedAt: new Date().toISOString(), count });
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
  const hours = getHoursSinceLastPost(history);
  
  const target = CONFIG.MIN_POSTS_PER_DAY + (parseInt(getTodayDate().replace(/-/g, '')) % 5);
  
  console.log(`\n📊 ${count}/${target} posts | ${hours.toFixed(1)}h ago`);
  
  if (count >= target) return false;
  if (hours < CONFIG.MIN_HOURS_BETWEEN_POSTS) return false;
  
  let chance = CONFIG.BASE_POST_CHANCE;
  if (CONFIG.QUIET_HOURS.includes(hour)) chance *= 0.2;
  else if (CONFIG.PEAK_HOURS.includes(hour)) chance *= 1.5;
  
  return Math.random() < chance;
}

// ============================================
// SPORTDB API
// ============================================

async function fetchAllMatches() {
  console.log("\n📡 Fetching matches...");
  let all = [];
  
  try {
    const res = await fetch("https://api.sportdb.dev/api/flashscore/football/live", {
      headers: { "X-API-Key": SPORTDB_API_KEY }
    });
    if (res.ok) {
      const data = await res.json();
      const m = Array.isArray(data) ? data : (data.matches || data.data || []);
      console.log(`   🔴 Live: ${m.length}`);
      all.push(...m);
    }
  } catch (e) { }
  
  try {
    const res = await fetch("https://api.sportdb.dev/api/flashscore/football/today", {
      headers: { "X-API-Key": SPORTDB_API_KEY }
    });
    if (res.ok) {
      const data = await res.json();
      const m = Array.isArray(data) ? data : (data.matches || data.data || []);
      console.log(`   📅 Today: ${m.length}`);
      for (const match of m) {
        const key = `${match.homeName}_${match.awayName}`;
        if (!all.some(e => `${e.homeName}_${e.awayName}` === key)) {
          all.push(match);
        }
      }
    }
  } catch (e) { }
  
  console.log(`   📊 Total: ${all.length}`);
  return all;
}

// ============================================
// MATCH PROCESSING
// ============================================

function getStatus(m) {
  const s = (m.eventStage || m.status || "").toUpperCase();
  if (s.includes("1ST") || s.includes("2ND") || s === "LIVE" || s === "1H" || s === "2H") return "LIVE";
  if (s.includes("HT")) return "HT";
  if (["FINISHED", "FT", "AET", "PEN"].includes(s)) return "FT";
  return "NS";
}

function transform(raw) {
  const league = raw.leagueName || raw.tournamentName || "";
  return {
    home: raw.homeName || raw.homeFirstName || "Unknown",
    away: raw.awayName || raw.awayFirstName || "Unknown",
    league,
    flag: getLeagueFlag(league),
    status: getStatus(raw),
    minute: raw.gameTime !== "-1" ? raw.gameTime : null,
    score: { home: parseInt(raw.homeScore) || 0, away: parseInt(raw.awayScore) || 0 },
    odds: formatOdds(raw.odds) || mockOdds(),
    priority: getLeaguePriority(league),
    isTop: isTopLeague(league),
    stats: mockStats()
  };
}

function mockOdds() {
  return {
    home: (1.5 + Math.random() * 2).toFixed(2),
    draw: (3 + Math.random() * 1.5).toFixed(2),
    away: (2.5 + Math.random() * 2.5).toFixed(2)
  };
}

function mockStats() {
  const f = ['W', 'D', 'L'];
  return {
    homeForm: Array(5).fill(0).map(() => f[Math.floor(Math.random() * 3)]).join(''),
    awayForm: Array(5).fill(0).map(() => f[Math.floor(Math.random() * 3)]).join(''),
    h2h: Math.floor(Math.random() * 4) + 1,
    avgGoals: (2 + Math.random() * 1.5).toFixed(1)
  };
}

function process(raw) {
  const valid = raw.filter(m => m.homeName && m.awayName);
  const all = valid.map(transform).filter(m => m.status !== "CANCELLED");
  all.sort((a, b) => a.priority - b.priority);
  
  return {
    live: all.filter(m => m.status === "LIVE" || m.status === "HT"),
    finished: all.filter(m => m.status === "FT"),
    upcoming: all.filter(m => m.status === "NS")
  };
}

// ============================================
// BUILD FORMATTED POST (NO AI - DIRECT FORMAT)
// ============================================

function buildPost(cats) {
  const date = getTodayFormatted();
  const total = cats.live.length + cats.finished.length + cats.upcoming.length;
  
  let post = "";
  
  // HEADER
  post += `⚽ 𝗙𝗢𝗢𝗧𝗕𝗔𝗟𝗟 𝗗𝗔𝗜𝗟𝗬 | ${date}\n`;
  post += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  post += `📊 ${total} Matches Today | Top Picks Inside! 🎯\n`;
  post += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  
  // LIVE SCORES
  const topLive = cats.live.filter(m => m.isTop).slice(0, 8);
  if (topLive.length > 0) {
    post += `🔴 𝗟𝗜𝗩𝗘 𝗦𝗖𝗢𝗥𝗘𝗦\n`;
    post += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    
    const grouped = groupByLeague(topLive);
    for (const g of grouped) {
      post += `${g.flag} ${g.name}\n`;
      for (const m of g.matches) {
        post += `   ⚽ ${m.home} ${m.score.home}-${m.score.away} ${m.away}`;
        if (m.minute) post += ` ⏱️ ${m.minute}'`;
        post += `\n`;
      }
      post += `\n`;
    }
  }
  
  // TODAY'S RESULTS
  const topFinished = cats.finished.filter(m => m.isTop).slice(0, 10);
  if (topFinished.length > 0) {
    post += `✅ 𝗧𝗢𝗗𝗔𝗬'𝗦 𝗥𝗘𝗦𝗨𝗟𝗧𝗦\n`;
    post += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    
    const grouped = groupByLeague(topFinished);
    for (const g of grouped) {
      post += `${g.flag} ${g.name}\n`;
      for (const m of g.matches) {
        const emoji = m.score.home > m.score.away ? "✅" : m.score.home < m.score.away ? "❌" : "🤝";
        post += `   ⚽ ${m.home} ${m.score.home}-${m.score.away} ${m.away} ${emoji}\n`;
      }
      post += `\n`;
    }
  }
  
  // PREDICTIONS
  const topUpcoming = cats.upcoming.filter(m => m.isTop).slice(0, 6);
  if (topUpcoming.length > 0) {
    post += `🎯 𝗧𝗢𝗣 𝗣𝗥𝗘𝗗𝗜𝗖𝗧𝗜𝗢𝗡𝗦\n`;
    post += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    
    for (const m of topUpcoming) {
      const prediction = generatePrediction(m);
      
      post += `┌─────────────────────────────┐\n`;
      post += `│ ${m.flag} ${m.league.slice(0, 25)}\n`;
      post += `└─────────────────────────────┘\n\n`;
      
      post += `⚽ ${m.home} vs ${m.away}\n\n`;
      
      post += `   📊 𝗢𝗱𝗱𝘀: ${m.odds.home} │ ${m.odds.draw} │ ${m.odds.away}\n\n`;
      
      post += `   📈 𝗦𝘁𝗮𝘁𝘀:\n`;
      post += `   ├ ${m.home} form: ${m.stats.homeForm}\n`;
      post += `   ├ ${m.away} form: ${m.stats.awayForm}\n`;
      post += `   ├ H2H: ${m.stats.h2h} wins in last 5\n`;
      post += `   └ Avg goals: ${m.stats.avgGoals}\n\n`;
      
      post += `   🔮 𝗣𝗶𝗰𝗸: ${prediction.pick}\n`;
      post += `   💰 𝗢𝗱𝗱𝘀: @${prediction.odds}\n`;
      post += `   ⚠️ 𝗥𝗶𝘀𝗸: ${prediction.risk}\n\n`;
      
      post += `   💡 ${prediction.analysis}\n\n`;
      
      post += `─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─\n\n`;
    }
  }
  
  // ACCUMULATOR
  if (topUpcoming.length >= 4) {
    post += `🔥 𝗔𝗖𝗖𝗨𝗠𝗨𝗟𝗔𝗧𝗢𝗥 𝗢𝗙 𝗧𝗛𝗘 𝗗𝗔𝗬\n`;
    post += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    
    const accaMatches = topUpcoming.slice(0, 5);
    let totalOdds = 1;
    
    accaMatches.forEach((m, i) => {
      const pred = generatePrediction(m);
      const odds = parseFloat(pred.odds);
      totalOdds *= odds;
      post += `   ${i + 1}️⃣ ${m.home} vs ${m.away}\n`;
      post += `      → ${pred.pick} @${pred.odds}\n\n`;
    });
    
    post += `   💰 £10 → Returns £${(10 * totalOdds).toFixed(2)}\n\n`;
  }
  
  // VALUE BETS
  post += `📈 𝗩𝗔𝗟𝗨𝗘 𝗕𝗘𝗧𝗦\n`;
  post += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  
  if (topUpcoming.length >= 3) {
    const m1 = topUpcoming[0];
    const m2 = topUpcoming[1];
    const m3 = topUpcoming[2];
    
    post += `   🟢 𝗦𝗔𝗙𝗘: ${m1.home} to Win @${m1.odds.home}\n\n`;
    post += `   🟡 𝗩𝗔𝗟𝗨𝗘: ${m2.home} vs ${m2.away} - BTTS @1.75\n\n`;
    post += `   🔴 𝗟𝗢𝗡𝗚𝗦𝗛𝗢𝗧: ${m3.away} to Win @${m3.odds.away}\n\n`;
  }
  
  // CTA
  post += `\n`;
  post += `💰 𝗪𝗔𝗡𝗧 𝗠𝗢𝗥𝗘 𝗪𝗜𝗡𝗡𝗘𝗥𝗦?\n`;
  post += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  post += `Join 5,000+ members getting FREE tips!\n\n`;
  post += `   ✅ Pre-match predictions\n`;
  post += `   ✅ Live in-play alerts\n`;
  post += `   ✅ Daily accumulators\n`;
  post += `   ✅ VIP exclusive picks\n\n`;
  post += `👉 𝗝𝗢𝗜𝗡 𝗙𝗥𝗘𝗘: ${CONFIG.TELEGRAM_URL}\n\n`;
  post += `⚠️ 18+ | Gamble Responsibly\n\n`;
  post += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  
  // HASHTAGS
  post += `#GlobalScoreNews #Football #BettingTips #FreeTips #Predictions #PremierLeague #LaLiga #Bundesliga #SerieA #Ligue1 #ChampionsLeague #Accumulator #BTTS`;
  
  return post;
}

function groupByLeague(matches) {
  const groups = {};
  for (const m of matches) {
    const key = m.league || "Other";
    if (!groups[key]) groups[key] = { name: m.league, flag: m.flag, matches: [] };
    groups[key].matches.push(m);
  }
  return Object.values(groups);
}

function generatePrediction(match) {
  const homeOdds = parseFloat(match.odds.home);
  const awayOdds = parseFloat(match.odds.away);
  const drawOdds = parseFloat(match.odds.draw);
  
  // Count wins in form
  const homeWins = (match.stats.homeForm.match(/W/g) || []).length;
  const awayWins = (match.stats.awayForm.match(/W/g) || []).length;
  
  let pick, odds, risk, analysis;
  
  if (homeOdds < 1.6 && homeWins >= 3) {
    pick = `${match.home} Win & Over 1.5 Goals`;
    odds = (homeOdds * 1.15).toFixed(2);
    risk = "⭐⭐ Medium";
    analysis = `${match.home} in great form with ${homeWins} wins in 5. Strong favorites at home.`;
  } else if (homeOdds < 2.0 && homeWins >= 2) {
    pick = `${match.home} Win`;
    odds = match.odds.home;
    risk = "⭐ Low";
    analysis = `${match.home} solid at home. ${match.away} struggling on the road.`;
  } else if (awayOdds < 2.5 && awayWins >= 3) {
    pick = `${match.away} Win or Draw (Double Chance)`;
    odds = "1.45";
    risk = "⭐ Low";
    analysis = `${match.away} in excellent form away from home. Good value here.`;
  } else if (parseFloat(match.stats.avgGoals) > 2.5) {
    pick = "Over 2.5 Goals";
    odds = "1.85";
    risk = "⭐⭐ Medium";
    analysis = `Both teams score freely. Avg ${match.stats.avgGoals} goals in recent games.`;
  } else {
    pick = "Both Teams To Score";
    odds = "1.75";
    risk = "⭐⭐ Medium";
    analysis = `Expect goals at both ends. Neither defense is solid.`;
  }
  
  return { pick, odds, risk, analysis };
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
    throw new Error(`Facebook: ${res.status}`);
  }
  
  console.log("   ✅ Posted!");
  return res.json();
}

// ============================================
// MAIN
// ============================================

async function main() {
  console.log("═".repeat(50));
  console.log("⚽ GLOBAL SCORE NEWS v8.0 - Beautiful Format");
  console.log("═".repeat(50));
  
  assertEnv();
  
  const history = loadHistory();
  
  if (!FORCE_POST && !shouldPostNow(history)) {
    console.log("\n👋 Skipping");
    return;
  }
  
  if (FORCE_POST) console.log("\n⚡ FORCE POST");
  
  const raw = await fetchAllMatches();
  if (!raw?.length) {
    console.log("⚠️ No matches");
    return;
  }
  
  const cats = process(raw);
  const topCount = cats.live.filter(m => m.isTop).length +
                   cats.finished.filter(m => m.isTop).length +
                   cats.upcoming.filter(m => m.isTop).length;
  
  console.log(`\n📊 Top leagues: ${topCount}`);
  
  if (topCount < 3) {
    console.log("⚠️ Not enough matches");
    return;
  }
  
  // Build post directly (no AI)
  const post = buildPost(cats);
  
  console.log("\n" + "═".repeat(50));
  console.log("📝 POST PREVIEW:");
  console.log("═".repeat(50));
  console.log(post);
  console.log("═".repeat(50));
  console.log(`📏 ${post.length} chars`);
  
  const result = await postToFacebook(post);
  recordPost(history, topCount);
  
  console.log(`\n✅ SUCCESS! ID: ${result.id}`);
}

main().catch(e => {
  console.error("❌", e.message);
  process.exit(1);
});
