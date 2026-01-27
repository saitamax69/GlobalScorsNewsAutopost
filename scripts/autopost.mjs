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
  // Target posts per day (will vary randomly between min and max)
  MIN_POSTS_PER_DAY: 10,
  MAX_POSTS_PER_DAY: 14,
  
  // Minimum hours between posts (prevents spam)
  MIN_HOURS_BETWEEN_POSTS: 1,
  
  // Peak hours (more likely to post) - 24h format UTC
  PEAK_HOURS: [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22],
  
  // Quiet hours (less likely to post) - 24h format UTC
  QUIET_HOURS: [0, 1, 2, 3, 4, 5, 6, 7],
  
  // Chance to post during each check (adjusted by time of day)
  BASE_POST_CHANCE: 0.25  // 25% base chance every 30 min
};

// ============================================
// MASTER INSTRUCTION FOR AI
// ============================================
const MASTER_INSTRUCTION = `You are a senior social media editor for the Facebook page "Global Score News." You write concise, clean, professional posts about football (soccer): live updates, results, analysis, previews, and predictions. You must ONLY use facts present in the provided match_data. Do not invent details.

Constraints and style:

First line = strong hook with 1–2 relevant emojis.
Total length: 45–110 words (tight, scannable).
Include team names, score/time, key scorers or moments if provided, and 1–2 sharp insights (form, H2H, xG, odds-like context) strictly derived from match_data.
Use 3–6 tasteful emojis (no spam, no childish vibe).
End with a clear CTA to the Telegram channel for free tips: "Free tips + real-time alerts: Join our Telegram 👉 https://t.me/+xAQ3DCVJa8A2ZmY8"
Include 5–10 relevant hashtags. Always include #GlobalScoreNews and competition tags if provided.
For predictions/free tips: add a short disclaimer: "No guarantees. Bet responsibly (18+)."
Never claim certainty. Avoid clickbait. Keep it professional.
Language: English (default).
Tone: confident, neutral, energetic—not hype.
If a field in match_data is missing, omit it gracefully.

Output format (JSON only, no markdown, no extra text):
{
  "post_type": "<one of the content types>",
  "title": "<optional, short>",
  "post_text": "<final facebook text ready to post>",
  "hashtags": ["#GlobalScoreNews", "...", "..."],
  "safety_notes": "<any caveats you applied>"
}`;

// ============================================
// HELPER FUNCTIONS
// ============================================

function assertEnv() {
  const required = ["SPORTDB_API_KEY", "GROQ_API_KEY", "FB_PAGE_ID", "FB_PAGE_ACCESS_TOKEN"];
  
  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`Missing: ${key}`);
    }
  }
  console.log("✅ Environment variables OK");
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ============================================
// POSTED HISTORY MANAGEMENT
// ============================================

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadPostedHistory() {
  ensureDataDir();
  
  if (!existsSync(POSTED_FILE)) {
    return { posts: [], dailyCount: {}, lastPost: null };
  }
  
  try {
    const data = readFileSync(POSTED_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return { posts: [], dailyCount: {}, lastPost: null };
  }
}

function savePostedHistory(history) {
  ensureDataDir();
  
  // Keep only last 100 posts to prevent file from growing too large
  if (history.posts.length > 100) {
    history.posts = history.posts.slice(-100);
  }
  
  // Clean old daily counts (keep only last 7 days)
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const cutoffDate = sevenDaysAgo.toISOString().split('T')[0];
  
  for (const date in history.dailyCount) {
    if (date < cutoffDate) {
      delete history.dailyCount[date];
    }
  }
  
  writeFileSync(POSTED_FILE, JSON.stringify(history, null, 2));
}

function getTodayDate() {
  return new Date().toISOString().split('T')[0];
}

function getTodayPostCount(history) {
  const today = getTodayDate();
  return history.dailyCount[today] || 0;
}

function getHoursSinceLastPost(history) {
  if (!history.lastPost) return 999;
  
  const lastPostTime = new Date(history.lastPost);
  const now = new Date();
  const diffMs = now - lastPostTime;
  return diffMs / (1000 * 60 * 60);
}

function wasMatchPosted(history, matchKey) {
  return history.posts.some(p => p.matchKey === matchKey);
}

function recordPost(history, matchKey, matchInfo) {
  const today = getTodayDate();
  const now = new Date().toISOString();
  
  history.posts.push({
    matchKey,
    matchInfo,
    postedAt: now
  });
  
  history.dailyCount[today] = (history.dailyCount[today] || 0) + 1;
  history.lastPost = now;
  
  savePostedHistory(history);
}

// ============================================
// RANDOM POSTING DECISION
// ============================================

function shouldPostNow(history) {
  const now = new Date();
  const currentHour = now.getUTCHours();
  const today = getTodayDate();
  const todayCount = getTodayPostCount(history);
  const hoursSinceLastPost = getHoursSinceLastPost(history);
  
  // Determine today's target (random between min and 
