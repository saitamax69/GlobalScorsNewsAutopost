import fetch from "node-fetch";

// ============================================
// ENVIRONMENT VARIABLES
// ============================================
const SPORTDB_API_KEY = process.env.SPORTDB_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const FB_PAGE_ID = process.env.FB_PAGE_ID;
const FB_PAGE_ACCESS_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN;

// ============================================
// MASTER INSTRUCTION FOR GEMINI
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

Output format (JSON only):
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
  const required = [
    "SPORTDB_API_KEY",
    "GEMINI_API_KEY",
    "FB_PAGE_ID",
    "FB_PAGE_ACCESS_TOKEN"
  ];
  
  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }
  console.log("✅ All environment variables present");
}

// ============================================
// SPORTDB API FUNCTIONS
// ============================================

async function fetchLiveMatches() {
  const url = "https://api.sportdb.dev/api/flashscore/football/live";
  const res = await fetch(url, {
    headers: { "X-API-Key": SPORTDB_API_KEY }
  });
  
  if (!res.ok) {
    console.log(`Live matches API returned ${res.status}`);
    return [];
  }
  
  const data = await res.json();
  return Array.isArray(data) ? data : (data.matches || data.events || data.data || []);
}

async function fetchTodayMatches() {
  const url = "https://api.sportdb.dev/api/flashscore/football/today";
  const res = await fetch(url, {
    headers: { "X-API-Key": SPORTDB_API_KEY }
  });
  
  if (!res.ok) {
    throw new Error(`SportDB today matches error: ${res.status}`);
  }
  
  const data = await res.json();
  return Array.isArray(data) ? data : (data.matches || data.events || data.data || []);
}

async function fetchAllMatches() {
  console.log("📡 Fetching matches from SportDB...");
  
  // Try live matches first
  let matches = await fetchLiveMatches();
  
  if (matches.length > 0) {
    console.log(`Found ${matches.length} live matches`);
    return matches;
  }
  
  // Fall back to today's matches
  matches = await fetchTodayMatches();
  console.log(`Found ${matches.length} matches today`);
  return matches;
}

// ============================================
// MATCH SELECTION & TRANSFORMATION
// ============================================

function pickBestMatch(matches) {
  if (!matches || matches.length === 0) {
    return null;
  }
  
  // Priority: LIVE > HT > FT > NS (upcoming)
  const getStatus = (m) => (m.status || m.state || "").toUpperCase();
  
  // Find live match
  const live = matches.find(m => getStatus(m) === "LIVE" || getStatus(m) === "1H" || getStatus(m) === "2H");
  if (live) {
    console.log("🔴 Selected LIVE match");
    return live;
  }
  
  // Find half-time match
  const ht = matches.find(m => getStatus(m) === "HT");
  if (ht) {
    console.log("⏸️ Selected HT match");
    return ht;
  }
  
  // Find finished match
  const ft = matches.find(m => getStatus(m) === "FT" || getStatus(m) === "FINISHED");
  if (ft) {
    console.log("✅ Selected FT match");
    return ft;
  }
  
  // Find upcoming match
  const ns = matches.find(m => getStatus(m) === "NS" || getStatus(m) === "SCHEDULED");
  if (ns) {
    console.log("📅 Selected upcoming match");
    return ns;
  }
  
  // Return first match as fallback
  console.log("📌 Selected first available match");
  return matches[0];
}

function transformToMatchData(raw) {
  // Adapt this mapping based on actual SportDB response structure
  const getTeamName = (team) => {
    if (typeof team === "string") return team;
    return team?.name || team?.teamName || team?.team_name || "Unknown";
  };
  
  const getScore = (raw) => {
    if (raw.score) {
      if (typeof raw.score === "object") {
        return {
          home: raw.score.home ?? raw.score.homeScore ?? 0,
          away: raw.score.away ?? raw.score.awayScore ?? 0
        };
      }
      if (typeof raw.score === "string" && raw.score.includes("-")) {
        const parts = raw.score.split("-");
        return { home: parseInt(parts[0]) || 0, away: parseInt(parts[1]) || 0 };
      }
    }
    return {
      home: raw.homeScore ?? raw.home_score ?? 0,
      away: raw.awayScore ?? raw.away_score ?? 0
    };
  };
  
  const normalizeStatus = (status) => {
    const s = (status || "").toUpperCase();
    if (s === "1H" || s === "2H" || s === "LIVE" || s === "INPROGRESS") return "LIVE";
    if (s === "FINISHED" || s === "ENDED") return "FT";
    if (s === "HALFTIME") return "HT";
    if (s === "SCHEDULED" || s === "NOTSTARTED") return "NS";
    return s || "NS";
  };
  
  return {
    competition: raw.competition?.name || raw.league?.name || raw.league || raw.tournament || "",
    round: raw.round || raw.matchday || "",
    home_team: getTeamName(raw.home || raw.homeTeam || raw.home_team),
    away_team: getTeamName(raw.away || raw.awayTeam || raw.away_team),
    status: normalizeStatus(raw.status || raw.state),
    minute: raw.minute ?? raw.time ?? raw.currentMinute ?? null,
    score: getScore(raw),
    scorers: raw.scorers || raw.goals || [],
    events: raw.events || raw.incidents || [],
    stats: raw.stats || raw.statistics || {},
    form: raw.form || {},
    h2h: raw.h2h || raw.headToHead || {},
    odds_like: raw.odds || {},
    venue: raw.venue || raw.stadium || "",
    kickoff_iso: raw.kickoff_iso || raw.datetime || raw.startTime || raw.date || "",
    notes: raw.notes || ""
  };
}

function determineContentType(status) {
  switch (status) {
    case "LIVE":
      return "live_update";
    case "HT":
      return "half_time";
    case "FT":
      return "full_time";
    case "NS":
    default:
      return "preview";
  }
}

// ============================================
// GEMINI API
// ============================================

async function generatePostWithGemini(contentType, matchData) {
  console.log("🤖 Generating post with Gemini...");
  
  const input = {
    page_name: "Global Score News",
    telegram_cta_url: "https://t.me/+xAQ3DCVJa8A2ZmY8",
    content_type: contentType,
    language: "en",
    match_data: matchData
  };
  
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
  
  const requestBody = {
    contents: [
      {
        role: "user",
        parts: [{ text: MASTER_INSTRUCTION }]
      },
      {
        role: "user",
        parts: [{ text: `Generate a ${contentType} post for this match:\n\n${JSON.stringify(input, null, 2)}` }]
      }
    ],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 1024
    }
  };
  
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody)
  });
  
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${errText}`);
  }
  
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  
  // Clean up and parse JSON response
  let cleaned = text.trim();
  
  // Remove markdown code fences if present
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith("```")) {
    cleaned = cleaned.slice(0, -3);
  }
  cleaned = cleaned.trim();
  
  try {
    return JSON.parse(cleaned);
  } catch (parseError) {
    console.error("Failed to parse Gemini response as JSON:", cleaned);
    throw new Error("Invalid JSON response from Gemini");
  }
}

// ============================================
// FACEBOOK API
// ============================================

async function postToFacebook(message) {
  console.log("📘 Posting to Facebook...");
  
  const url = `https://graph.facebook.com/v19.0/${FB_PAGE_ID}/feed`;
  
  const params = new URLSearchParams({
    message: message,
    access_token: FB_PAGE_ACCESS_TOKEN
  });
  
  const res = await fetch(url, {
    method: "POST",
    body: params
  });
  
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Facebook API error ${res.status}: ${errText}`);
  }
  
  return res.json();
}

function buildFacebookMessage(geminiResponse) {
  const postText = geminiResponse.post_text || "";
  const hashtags = geminiResponse.hashtags || [];
  
  // Check if hashtags are already in post_text
  const hashtagsText = hashtags.join(" ");
  
  if (postText.includes("#GlobalScoreNews")) {
    return postText;
  }
  
  return `${postText}\n\n${hashtagsText}`.trim();
}

// ============================================
// DUPLICATE POST PREVENTION (Simple)
// ============================================

// Store last posted match to avoid duplicates within same run
let lastPostedMatch = null;

function createMatchKey(matchData) {
  return `${matchData.home_team}_${matchData.away_team}_${matchData.status}_${matchData.score.home}_${matchData.score.away}`;
}

function isDuplicate(matchData) {
  const key = createMatchKey(matchData);
  if (lastPostedMatch === key) {
    return true;
  }
  lastPostedMatch = key;
  return false;
}

// ============================================
// MAIN FUNCTION
// ============================================

async function main() {
  console.log("🚀 Starting Global Score News Autopost...\n");
  
  // Validate environment
  assertEnv();
  
  // Fetch matches
  const matches = await fetchAllMatches();
  
  if (!matches || matches.length === 0) {
    console.log("⚠️ No matches found. Exiting.");
    return;
  }
  
  // Pick best match to post about
  const rawMatch = pickBestMatch(matches);
  
  if (!rawMatch) {
    console.log("⚠️ No suitable match found. Exiting.");
    return;
  }
  
  // Transform to our format
  const matchData = transformToMatchData(rawMatch);
  console.log(`\n📋 Match: ${matchData.home_team} vs ${matchData.away_team}`);
  console.log(`   Status: ${matchData.status}`);
  console.log(`   Score: ${matchData.score.home} - ${matchData.score.away}`);
  console.log(`   Competition: ${matchData.competition}\n`);
  
  // Check for duplicate
  if (isDuplicate(matchData)) {
    console.log("⚠️ Duplicate match detected. Skipping.");
    return;
  }
  
  // Determine content type
  const contentType = determineContentType(matchData.status);
  console.log(`📝 Content type: ${contentType}\n`);
  
  // Generate post with Gemini
  const geminiResponse = await generatePostWithGemini(contentType, matchData);
  console.log("✅ Post generated successfully\n");
  
  // Build final message
  const message = buildFacebookMessage(geminiResponse);
  console.log("--- POST PREVIEW ---");
  console.log(message);
  console.log("--- END PREVIEW ---\n");
  
  // Post to Facebook
  const fbResult = await postToFacebook(message);
  console.log("✅ Posted to Facebook successfully!");
  console.log(`   Post ID: ${fbResult.id}`);
}

// Run
main().catch((error) => {
  console.error("❌ Error:", error.message);
  process.exit(1);
});
