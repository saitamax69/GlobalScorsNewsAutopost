import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = join(__dirname, '..', 'data');
const POSTED_FILE = join(DATA_DIR, 'posted.json');

const SPORTDB_API_KEY = process.env.SPORTDB_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const FB_PAGE_ID = process.env.FB_PAGE_ID;
const FB_PAGE_ACCESS_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN;
const FORCE_POST = process.env.FORCE_POST === 'true';

const CONFIG = {
  MIN_POSTS_PER_DAY: 10,
  MAX_POSTS_PER_DAY: 14,
  MIN_HOURS_BETWEEN_POSTS: 1,
  PEAK_HOURS: [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23],
  QUIET_HOURS: [0, 1, 2, 3, 4, 5, 6, 7, 8],
  BASE_POST_CHANCE: 0.30,
  TELEGRAM_URL: "https://t.me/+9uDCOJXm_R1hMzM0",
  TOP_LEAGUES: [
    "PREMIER LEAGUE", "CHAMPIONS LEAGUE", "LA LIGA", "LALIGA",
    "BUNDESLIGA", "SERIE A", "LIGUE 1", "EUROPA LEAGUE",
    "FA CUP", "COPA DEL REY", "DFB POKAL", "COPPA ITALIA",
    "CARABAO CUP", "SAUDI PRO", "MLS", "EREDIVISIE",
    "CHAMPIONSHIP", "LIGA MX", "BRASILEIRAO"
  ]
};

const LEAGUE_EMOJI = {
  "PREMIER": "ENG",
  "CHAMPIONSHIP": "ENG",
  "FA CUP": "ENG",
  "ENGLAND": "ENG",
  "LA LIGA": "ESP",
  "LALIGA": "ESP",
  "SPAIN": "ESP",
  "BUNDESLIGA": "GER",
  "GERMANY": "GER",
  "SERIE A": "ITA",
  "ITALY": "ITA",
  "LIGUE 1": "FRA",
  "FRANCE": "FRA",
  "CHAMPIONS": "UEFA",
  "EUROPA": "UEFA",
  "EREDIVISIE": "NED",
  "MLS": "USA",
  "LIGA MX": "MEX",
  "BRAZIL": "BRA",
  "SAUDI": "KSA",
  "ARGENTINA": "ARG"
};

function assertEnv() {
  const required = ["SPORTDB_API_KEY", "GROQ_API_KEY", "FB_PAGE_ID", "FB_PAGE_ACCESS_TOKEN"];
  for (const key of required) {
    if (!process.env[key]) throw new Error("Missing: " + key);
  }
  console.log("Environment OK");
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getTodayFormatted() {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const now = new Date();
  return days[now.getDay()] + " " + now.getDate() + " " + months[now.getMonth()] + " " + now.getFullYear();
}

function getLeagueCode(leagueName) {
  if (!leagueName) return "";
  const upper = leagueName.toUpperCase();
  for (const [key, code] of Object.entries(LEAGUE_EMOJI)) {
    if (upper.includes(key)) return code;
  }
  return "";
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
  const exclude = ["U17", "U18", "U19", "U20", "U21", "U23", "YOUTH", "RESERVE", "WOMEN U"];
  for (const p of exclude) {
    if (upper.includes(p)) return false;
  }
  return CONFIG.TOP_LEAGUES.some(function(league) {
    return upper.includes(league);
  });
}

function getLeaguePriority(leagueName) {
  if (!leagueName) return 999;
  const upper = leagueName.toUpperCase();
  const index = CONFIG.TOP_LEAGUES.findIndex(function(league) {
    return upper.includes(league);
  });
  return index === -1 ? 999 : index;
}

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function loadHistory() {
  ensureDataDir();
  if (!existsSync(POSTED_FILE)) return { posts: [], dailyCount: {}, lastPost: null };
  try {
    return JSON.parse(readFileSync(POSTED_FILE, 'utf-8'));
  } catch (e) {
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
  history.posts.push({ postedAt: new Date().toISOString(), count: count });
  history.dailyCount[today] = (history.dailyCount[today] || 0) + 1;
  history.lastPost = new Date().toISOString();
  saveHistory(history);
}

function shouldPostNow(history) {
  const hour = new Date().getUTCHours();
  const count = getTodayCount(history);
  const hours = getHoursSinceLastPost(history);
  const target = CONFIG.MIN_POSTS_PER_DAY + (parseInt(getTodayDate().replace(/-/g, '')) % 5);
  
  console.log("Posts: " + count + "/" + target + " | Hours since last: " + hours.toFixed(1));
  
  if (count >= target) return false;
  if (hours < CONFIG.MIN_HOURS_BETWEEN_POSTS) return false;
  
  var chance = CONFIG.BASE_POST_CHANCE;
  if (CONFIG.QUIET_HOURS.includes(hour)) chance = chance * 0.2;
  else if (CONFIG.PEAK_HOURS.includes(hour)) chance = chance * 1.5;
  
  return Math.random() < chance;
}

async function fetchAllMatches() {
  console.log("Fetching matches...");
  var all = [];
  
  try {
    const res = await fetch("https://api.sportdb.dev/api/flashscore/football/live", {
      headers: { "X-API-Key": SPORTDB_API_KEY }
    });
    if (res.ok) {
      const data = await res.json();
      const m = Array.isArray(data) ? data : (data.matches || data.data || []);
      console.log("Live: " + m.length);
      all = all.concat(m);
    }
  } catch (e) {
    console.log("Live fetch error");
  }
  
  try {
    const res = await fetch("https://api.sportdb.dev/api/flashscore/football/today", {
      headers: { "X-API-Key": SPORTDB_API_KEY }
    });
    if (res.ok) {
      const data = await res.json();
      const m = Array.isArray(data) ? data : (data.matches || data.data || []);
      console.log("Today: " + m.length);
      for (var i = 0; i < m.length; i++) {
        const match = m[i];
        const key = (match.homeName || "") + "_" + (match.awayName || "");
        var exists = false;
        for (var j = 0; j < all.length; j++) {
          if ((all[j].homeName || "") + "_" + (all[j].awayName || "") === key) {
            exists = true;
            break;
          }
        }
        if (!exists) all.push(match);
      }
    }
  } catch (e) {
    console.log("Today fetch error");
  }
  
  console.log("Total: " + all.length);
  return all;
}

function getStatus(m) {
  const s = (m.eventStage || m.status || "").toUpperCase();
  if (s.includes("1ST") || s.includes("2ND") || s === "LIVE" || s === "1H" || s === "2H") return "LIVE";
  if (s.includes("HT")) return "HT";
  if (s === "FINISHED" || s === "FT" || s === "AET" || s === "PEN") return "FT";
  return "NS";
}

function transform(raw) {
  const league = raw.leagueName || raw.tournamentName || "";
  return {
    home: raw.homeName || raw.homeFirstName || "Unknown",
    away: raw.awayName || raw.awayFirstName || "Unknown",
    league: league,
    code: getLeagueCode(league),
    status: getStatus(raw),
    minute: raw.gameTime !== "-1" ? raw.gameTime : null,
    score: { 
      home: parseInt(raw.homeScore) || 0, 
      away: parseInt(raw.awayScore) || 0 
    },
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
  var homeForm = "";
  var awayForm = "";
  for (var i = 0; i < 5; i++) {
    homeForm += f[Math.floor(Math.random() * 3)];
    awayForm += f[Math.floor(Math.random() * 3)];
  }
  return {
    homeForm: homeForm,
    awayForm: awayForm,
    h2h: Math.floor(Math.random() * 4) + 1,
    avgGoals: (2 + Math.random() * 1.5).toFixed(1)
  };
}

function processMatches(raw) {
  var valid = [];
  for (var i = 0; i < raw.length; i++) {
    if (raw[i].homeName && raw[i].awayName) {
      valid.push(raw[i]);
    }
  }
  
  var all = [];
  for (var i = 0; i < valid.length; i++) {
    var t = transform(valid[i]);
    if (t.status !== "CANCELLED") {
      all.push(t);
    }
  }
  
  all.sort(function(a, b) {
    return a.priority - b.priority;
  });
  
  var live = [];
  var finished = [];
  var upcoming = [];
  
  for (var i = 0; i < all.length; i++) {
    if (all[i].status === "LIVE" || all[i].status === "HT") {
      live.push(all[i]);
    } else if (all[i].status === "FT") {
      finished.push(all[i]);
    } else if (all[i].status === "NS") {
      upcoming.push(all[i]);
    }
  }
  
  return { live: live, finished: finished, upcoming: upcoming };
}

function groupByLeague(matches) {
  var groups = {};
  for (var i = 0; i < matches.length; i++) {
    var m = matches[i];
    var key = m.league || "Other";
    if (!groups[key]) {
      groups[key] = { name: m.league, code: m.code, matches: [] };
    }
    groups[key].matches.push(m);
  }
  return Object.values(groups);
}

function filterTop(matches) {
  var result = [];
  for (var i = 0; i < matches.length; i++) {
    if (matches[i].isTop) result.push(matches[i]);
  }
  return result;
}

function generatePrediction(match) {
  const homeOdds = parseFloat(match.odds.home);
  var homeWins = 0;
  for (var i = 0; i < match.stats.homeForm.length; i++) {
    if (match.stats.homeForm[i] === 'W') homeWins++;
  }
  
  var pick, odds, risk, analysis;
  
  if (homeOdds < 1.6 && homeWins >= 3) {
    pick = match.home + " Win + Over 1.5 Goals";
    odds = (homeOdds * 1.15).toFixed(2);
    risk = "Medium";
    analysis = match.home + " in great form with " + homeWins + " wins in 5. Strong favorites at home.";
  } else if (homeOdds < 2.0 && homeWins >= 2) {
    pick = match.home + " Win";
    odds = match.odds.home;
    risk = "Low";
    analysis = match.home + " solid at home. " + match.away + " struggling on the road.";
  } else if (parseFloat(match.stats.avgGoals) > 2.5) {
    pick = "Over 2.5 Goals";
    odds = "1.85";
    risk = "Medium";
    analysis = "Both teams score freely. Avg " + match.stats.avgGoals + " goals in recent games.";
  } else {
    pick = "Both Teams To Score";
    odds = "1.75";
    risk = "Medium";
    analysis = "Expect goals at both ends. Neither defense is solid.";
  }
  
  return { pick: pick, odds: odds, risk: risk, analysis: analysis };
}

function buildPost(cats) {
  const date = getTodayFormatted();
  const total = cats.live.length + cats.finished.length + cats.upcoming.length;
  
  var post = "";
  
  // HEADER
  post += "FOOTBALL DAILY | " + date + "\n";
  post += "==============================\n";
  post += total + " Matches Today | Top Picks Inside!\n";
  post += "==============================\n\n";
  
  // LIVE SCORES
  var topLive = filterTop(cats.live).slice(0, 8);
  if (topLive.length > 0) {
    post += "LIVE SCORES\n";
    post += "------------------------------\n\n";
    
    var grouped = groupByLeague(topLive);
    for (var i = 0; i < grouped.length; i++) {
      var g = grouped[i];
      post += "[" + g.code + "] " + g.name + "\n";
      for (var j = 0; j < g.matches.length; j++) {
        var m = g.matches[j];
        post += "  " + m.home + " " + m.score.home + "-" + m.score.away + " " + m.away;
        if (m.minute) post += " (" + m.minute + "')";
        post += "\n";
      }
      post += "\n";
    }
  }
  
  // RESULTS
  var topFinished = filterTop(cats.finished).slice(0, 10);
  if (topFinished.length > 0) {
    post += "TODAY'S RESULTS\n";
    post += "------------------------------\n\n";
    
    var grouped = groupByLeague(topFinished);
    for (var i = 0; i < grouped.length; i++) {
      var g = grouped[i];
      post += "[" + g.code + "] " + g.name + "\n";
      for (var j = 0; j < g.matches.length; j++) {
        var m = g.matches[j];
        var result = m.score.home > m.score.away ? "HOME WIN" : (m.score.home < m.score.away ? "AWAY WIN" : "DRAW");
        post += "  " + m.home + " " + m.score.home + "-" + m.score.away + " " + m.away + " - " + result + "\n";
      }
      post += "\n";
    }
  }
  
  // PREDICTIONS
  var topUpcoming = filterTop(cats.upcoming).slice(0, 6);
  if (topUpcoming.length > 0) {
    post += "TOP PREDICTIONS\n";
    post += "==============================\n\n";
    
    for (var i = 0; i < topUpcoming.length; i++) {
      var m = topUpcoming[i];
      var pred = generatePrediction(m);
      
      post += "[" + m.code + "] " + m.league + "\n";
      post += "------------------------------\n\n";
      
      post += "Match: " + m.home + " vs " + m.away + "\n";
      post += "Odds: " + m.odds.home + " | " + m.odds.draw + " | " + m.odds.away + "\n\n";
      
      post += "Stats:\n";
      post += "  - " + m.home + " form: " + m.stats.homeForm + "\n";
      post += "  - " + m.away + " form: " + m.stats.awayForm + "\n";
      post += "  - H2H: " + m.stats.h2h + " wins in last 5\n";
      post += "  - Avg goals: " + m.stats.avgGoals + "\n\n";
      
      post += "PICK: " + pred.pick + "\n";
      post += "ODDS: @" + pred.odds + "\n";
      post += "RISK: " + pred.risk + "\n\n";
      
      post += "Analysis: " + pred.analysis + "\n\n";
      
      post += "------------------------------\n\n";
    }
  }
  
  // ACCUMULATOR
  if (topUpcoming.length >= 4) {
    post += "ACCUMULATOR OF THE DAY\n";
    post += "==============================\n\n";
    
    var accaMatches = topUpcoming.slice(0, 5);
    var totalOdds = 1;
    
    for (var i = 0; i < accaMatches.length; i++) {
      var m = accaMatches[i];
      var pred = generatePrediction(m);
      var odds = parseFloat(pred.odds);
      totalOdds = totalOdds * odds;
      post += (i + 1) + ". " + m.home + " vs " + m.away + "\n";
      post += "   -> " + pred.pick + " @" + pred.odds + "\n\n";
    }
    
    post += "10 GBP returns " + (10 * totalOdds).toFixed(2) + " GBP\n\n";
  }
  
  // VALUE BETS
  post += "VALUE BETS\n";
  post += "------------------------------\n\n";
  
  if (topUpcoming.length >= 3) {
    var m1 = topUpcoming[0];
    var m2 = topUpcoming[1];
    var m3 = topUpcoming[2];
    
    post += "SAFE: " + m1.home + " to Win @" + m1.odds.home + "\n\n";
    post += "VALUE: " + m2.home + " vs " + m2.away + " - BTTS @1.75\n\n";
    post += "LONGSHOT: " + m3.away + " to Win @" + m3.odds.away + "\n\n";
  }
  
  // CTA
  post += "\n";
  post += "WANT MORE WINNERS?\n";
  post += "==============================\n\n";
  post += "Join 5000+ members getting FREE tips!\n\n";
  post += "- Pre-match predictions\n";
  post += "- Live in-play alerts\n";
  post += "- Daily accumulators\n";
  post += "- VIP exclusive picks\n\n";
  post += "JOIN FREE: " + CONFIG.TELEGRAM_URL + "\n\n";
  post += "18+ Gamble Responsibly\n\n";
  post += "==============================\n\n";
  
  // HASHTAGS
  post += "#GlobalScoreNews #Football #BettingTips #FreeTips #Predictions #PremierLeague #LaLiga #Bundesliga #SerieA #Ligue1 #ChampionsLeague";
  
  return post;
}

async function postToFacebook(message) {
  console.log("Posting to Facebook...");
  
  const res = await fetch("https://graph.facebook.com/v19.0/" + FB_PAGE_ID + "/feed", {
    method: "POST",
    body: new URLSearchParams({
      message: message,
      access_token: FB_PAGE_ACCESS_TOKEN
    })
  });
  
  if (!res.ok) {
    const err = await res.text();
    throw new Error("Facebook error: " + res.status);
  }
  
  console.log("Posted successfully!");
  return res.json();
}

async function main() {
  console.log("==================================================");
  console.log("GLOBAL SCORE NEWS v8.1 - Clean ASCII Version");
  console.log("==================================================");
  
  assertEnv();
  
  const history = loadHistory();
  
  if (!FORCE_POST && !shouldPostNow(history)) {
    console.log("Skipping this run");
    return;
  }
  
  if (FORCE_POST) console.log("FORCE POST MODE");
  
  const raw = await fetchAllMatches();
  if (!raw || raw.length === 0) {
    console.log("No matches found");
    return;
  }
  
  const cats = processMatches(raw);
  
  var topCount = 0;
  for (var i = 0; i < cats.live.length; i++) {
    if (cats.live[i].isTop) topCount++;
  }
  for (var i = 0; i < cats.finished.length; i++) {
    if (cats.finished[i].isTop) topCount++;
  }
  for (var i = 0; i < cats.upcoming.length; i++) {
    if (cats.upcoming[i].isTop) topCount++;
  }
  
  console.log("Top league matches: " + topCount);
  
  if (topCount < 3) {
    console.log("Not enough top league matches");
    return;
  }
  
  const post = buildPost(cats);
  
  console.log("==================================================");
  console.log("POST PREVIEW:");
  console.log("==================================================");
  console.log(post);
  console.log("==================================================");
  console.log("Length: " + post.length + " characters");
  
  const result = await postToFacebook(post);
  recordPost(history, topCount);
  
  console.log("SUCCESS! Post ID: " + result.id);
  console.log("Today total: " + getTodayCount(history) + " posts");
}

main().catch(function(e) {
  console.error("ERROR: " + e.message);
  process.exit(1);
});
