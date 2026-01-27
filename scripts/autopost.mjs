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
  
  // Debug: Log the structure of the first match
  const matches = Array.isArray(data) ? data : (data.matches || data.events || data.data || []);
  if (matches.length > 0) {
    console.log("\n🔍 DEBUG - First match structure:");
    console.log(JSON.stringify(matches[0], null, 2).slice(0, 1000));
    console.log("\n");
  }
  
  return matches;
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
  const getStatus = (m) => {
    const status = m.status || m.state || m.STATUS || m.matchStatus || "";
    return status.toString().toUpperCase();
  };
  
  // Find live match (with valid team names)
  const hasValidTeams = (m) => {
    const home = m.HOME_NAME || m.homeName || m.home_name || m.homeTeam?.name || m.home?.name || "";
    const away = m.AWAY_NAME || m.awayName || m.away_name || m.awayTeam?.name || m.away?.name || "";
    return home.length > 0 && away.length > 0;
  };
  
  const validMatches = matches.filter(hasValidTeams);
  console.log(`Found ${validMatches.length} matches with valid team names`);
  
  if (validMatches.length === 0) {
    // Return first match anyway for debugging
    return matches[0];
  }
  
  // Find live match
  const live = validMatches.find(m => {
    const s = getStatus(m);
    return s === "LIVE" || s === "1H" || s === "2H" || s.includes("LIVE");
  });
  if (live) {
    console.log("🔴 Selected LIVE match");
    return live;
  }
  
  // Find half-time match
  const ht = validMatches.find(m => getStatus(m) === "HT" || getStatus(m) === "HALFTIME");
  if (ht) {
    console.log("⏸️ Selected HT match");
    return ht;
  }
  
  // Find finished match
  const ft = validMatches.find(m => {
    const s = getStatus(m);
    return s === "FT" || s === "FINISHED" || s === "ENDED" || s === "AET";
  });
  if (ft) {
    console.log("✅ Selected FT match");
    return ft;
  }
  
  // Find upcoming match
  const ns = validMatches.find(m => {
    const s = getStatus(m);
    return s === "NS" || s === "SCHEDULED" || s === "NOTSTARTED" || s === "";
  });
  if (ns) {
    console.log("📅 Selected upcoming match");
    return ns;
  }
  
  // Return first valid match as fallback
  console.log("📌 Selected first valid match");
  return validMatches[0];
}

function transformToMatchData(raw) {
  // Try multiple possible field names (SportDB might use different formats)
  const getTeamName = (raw, type) => {
    if (type === "home") {
      return raw.HOME_NAME || 
             raw.homeName || 
             raw.home_name || 
             raw.homeTeam?.name || 
             raw.home?.name ||
             raw.homeTeam ||
             raw.home ||
             (typeof raw.HOME === "string" ? raw.HOME : raw.HOME?.name) ||
             "Unknown Home";
    } else {
      return raw.AWAY_NAME || 
             raw.awayName || 
             raw.away_name || 
             raw.awayTeam?.name || 
             raw.away?.name ||
             raw.awayTeam ||
             raw.away ||
             (typeof raw.AWAY === "string" ? raw.AWAY : raw.AWAY?.name) ||
             "Unknown Away";
    }
  };
  
  const getScore = (raw) => {
    // Try different score field formats
    const homeScore = raw.HOME_SCORE ?? raw.homeScore ?? raw.home_score ?? 
                      raw.score?.home ?? raw.SCORE?.home ?? 
                      raw.result?.home ?? 0;
    const awayScore = raw.AWAY_SCORE ?? raw.awayScore ?? raw.away_score ?? 
                      raw.score?.away ?? raw.SCORE?.away ?? 
                      raw.result?.away ?? 0;
    
    return {
      home: parseInt(homeScore) || 0,
      away: parseInt(awayScore) || 0
    };
  };
  
  const normalizeStatus = (status) => {
    const s = (status || "").toString().toUpperCase();
    if (s === "1H" || s === "2H" || s === "LIVE" || s === "INPROGRESS" || s.includes("LIVE")) return "LIVE";
    if (s === "FINISHED" || s === "ENDED" || s === "FT" || s === "AET") return "FT";
    if (s === "HALFTIME" || s === "HT") return "HT";
    if (s === "SCHEDULED" || s === "NOTSTARTED" || s === "NS" || s === "") return "NS";
    return s || "NS";
  };
  
  const getCompetition = (raw) => {
    return raw.LEAGUE_NAME ||
           raw.leagueName ||
           raw.league_name ||
           raw.competition?.name ||
           raw.league?.name ||
           raw.tournament?.name ||
           raw.competition ||
           raw.league ||
           raw.tournament ||
           "";
  };
  
  return {
    competition: getCompetition(raw),
    round: raw.round || raw.matchday || raw.ROUND || "",
    home_team: getTeamName(raw, "home"),
    away_team: getTeamName(raw, "away"),
    status: normalizeStatus(raw.status || raw.state || raw.STATUS || raw.matchStatus),
    minute: raw.minute ?? raw.time ?? raw.MINUTE ?? raw.currentMinute ?? null,
    score: getScore(raw),
    scorers: raw.scorers || raw.goals || raw.SCORERS || [],
    events: raw.events || raw.incidents || raw.EVENTS || [],
    stats: raw.stats || raw.statistics || raw.STATS || {},
    form: raw.form || {},
    h2h: raw.h2h || raw.headToHead || {},
    odds_like: raw.odds || {},
    venue: raw.venue || raw.stadium || raw.VENUE || "",
    kickoff_iso: raw.kickoff_iso || raw.datetime || raw.startTime || raw.date || raw.START_TIME || "",
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
// GEMINI API (FIXED MODEL NAME)
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
  
  // Try different model names
  const models = [
    "gemini-2.0-flash",
    "gemini-1.5-flash-latest",
    "gemini-1.5-flash-001",
    "gemini-pro"
  ];
  
  let lastError = null;
  
  for (const model of models) {
    try {
      console.log(`   Trying model: ${model}`);
      
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
      
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
        console.log(`   Model ${model} failed: ${res.status}`);
        lastError = new Error(`Gemini API error ${res.status}: ${errText}`);
        continue;
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
      
      console.log(`   ✅ Model ${model} worked!`);
      return JSON.parse(cleaned);
      
    } catch (error) {
      lastError = error;
      continue;
    }
  }
  
  throw lastError || new Error("All Gemini models failed");
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
// DUPLICATE POST PREVENTION
// ============================================

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
  
  // Skip if match data is invalid
  if (matchData.home_team === "Unknown Home" || matchData.away_team === "Unknown Away") {
    console.log("⚠️ Could not parse match data properly. Check SportDB response structure.");
    console.log("Raw match data:", JSON.stringify(rawMatch, null, 2).slice(0, 2000));
    return;
  }
  
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
