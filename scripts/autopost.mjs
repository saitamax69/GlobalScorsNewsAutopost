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

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
  const matches = Array.isArray(data) ? data : (data.matches || data.events || data.data || []);
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
  
  let matches = await fetchLiveMatches();
  
  if (matches.length > 0) {
    console.log(`Found ${matches.length} live matches`);
    return matches;
  }
  
  matches = await fetchTodayMatches();
  console.log(`Found ${matches.length} matches today`);
  return matches;
}

// ============================================
// MATCH SELECTION & TRANSFORMATION
// ============================================

function getMatchStatus(m) {
  const stage = (m.eventStage || m.status || m.state || "").toString().toUpperCase();
  return stage;
}

function pickBestMatch(matches) {
  if (!matches || matches.length === 0) {
    return null;
  }
  
  const hasValidTeams = (m) => {
    const home = m.homeName || m.homeFirstName || "";
    const away = m.awayName || m.awayFirstName || "";
    return home.length > 0 && away.length > 0;
  };
  
  const validMatches = matches.filter(hasValidTeams);
  console.log(`Found ${validMatches.length} matches with valid team names`);
  
  if (validMatches.length === 0) {
    return matches[0];
  }
  
  // Priority 1: LIVE matches
  const live = validMatches.find(m => {
    const s = getMatchStatus(m);
    return s === "LIVE" || s === "1ST HALF" || s === "2ND HALF" || 
           s === "1H" || s === "2H" || s.includes("HALF");
  });
  if (live) {
    console.log("🔴 Selected LIVE match");
    return live;
  }
  
  // Priority 2: HALF TIME
  const ht = validMatches.find(m => {
    const s = getMatchStatus(m);
    return s === "HALFTIME" || s === "HT" || s === "HALF TIME";
  });
  if (ht) {
    console.log("⏸️ Selected HT match");
    return ht;
  }
  
  // Priority 3: FINISHED matches
  const ft = validMatches.find(m => {
    const s = getMatchStatus(m);
    return s === "FINISHED" || s === "FT" || s === "ENDED" || s === "AET";
  });
  if (ft) {
    console.log("✅ Selected FT match");
    return ft;
  }
  
  // Priority 4: Big league matches
  const bigLeagues = ["PREMIER LEAGUE", "LA LIGA", "BUNDESLIGA", "SERIE A", "LIGUE 1", 
                      "CHAMPIONS LEAGUE", "EUROPA LEAGUE"];
  
  const bigLeagueMatch = validMatches.find(m => {
    const league = (m.leagueName || m.tournamentName || "").toUpperCase();
    return bigLeagues.some(bl => league.includes(bl));
  });
  
  if (bigLeagueMatch) {
    console.log("🏆 Selected big league match");
    return bigLeagueMatch;
  }
  
  console.log("📌 Selected first valid match");
  return validMatches[0];
}

function transformToMatchData(raw) {
  const normalizeStatus = (stage) => {
    const s = (stage || "").toString().toUpperCase();
    if (s === "1ST HALF" || s === "2ND HALF" || s === "1H" || s === "2H" || 
        s === "LIVE" || s.includes("HALF")) return "LIVE";
    if (s === "FINISHED" || s === "ENDED" || s === "FT" || s === "AET") return "FT";
    if (s === "HALFTIME" || s === "HT" || s === "HALF TIME") return "HT";
    return "NS";
  };
  
  return {
    competition: raw.leagueName || raw.tournamentName || raw.competition || "",
    round: raw.round || raw.matchday || "",
    home_team: raw.homeName || raw.homeFirstName || "Unknown",
    away_team: raw.awayName || raw.awayFirstName || "Unknown",
    status: normalizeStatus(raw.eventStage || raw.status),
    minute: raw.gameTime && raw.gameTime !== "-1" ? raw.gameTime : null,
    score: {
      home: parseInt(raw.homeScore) || parseInt(raw.homeFullTimeScore) || 0,
      away: parseInt(raw.awayScore) || parseInt(raw.awayFullTimeScore) || 0
    },
    scorers: raw.scorers || [],
    events: raw.events || [],
    stats: raw.stats || {},
    form: raw.form || {},
    h2h: raw.h2h || {},
    odds_like: raw.odds || {},
    venue: raw.venue || "",
    kickoff_iso: raw.startTime || raw.datetime || "",
    notes: ""
  };
}

function determineContentType(status) {
  switch (status) {
    case "LIVE": return "live_update";
    case "HT": return "half_time";
    case "FT": return "full_time";
    default: return "preview";
  }
}

// ============================================
// GEMINI API - FIXED MODEL NAMES
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

  // Correct model configurations
  const modelConfigs = [
    { 
      model: "gemini-2.0-flash", 
      apiVersion: "v1beta" 
    },
    { 
      model: "gemini-1.5-flash", 
      apiVersion: "v1beta" 
    },
    { 
      model: "gemini-1.5-pro", 
      apiVersion: "v1beta" 
    }
  ];
  
  const maxRetries = 3;
  let lastError = null;
  
  for (const config of modelConfigs) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`   Trying ${config.model} (${config.apiVersion}) - attempt ${attempt}/${maxRetries}`);
        
        const url = `https://generativelanguage.googleapis.com/${config.apiVersion}/models/${config.model}:generateContent?key=${GEMINI_API_KEY}`;
        
        const requestBody = {
          contents: [
            {
              parts: [
                { 
                  text: `${MASTER_INSTRUCTION}\n\nGenerate a ${contentType} post for this match:\n\n${JSON.stringify(input, null, 2)}` 
                }
              ]
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
        
        // Handle rate limiting
        if (res.status === 429) {
          console.log(`   ⚠️ Rate limited. Waiting 15 seconds...`);
          await delay(15000);
          continue;
        }
        
        // Handle other errors
        if (!res.ok) {
          const errText = await res.text();
          console.log(`   ❌ ${config.model} failed: ${res.status}`);
          lastError = new Error(`Gemini API error ${res.status}: ${errText}`);
          break; // Try next model
        }
        
        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
        
        if (!text) {
          console.log(`   ⚠️ Empty response, retrying...`);
          await delay(3000);
          continue;
        }
        
        // Clean up JSON response
        let cleaned = text.trim();
        if (cleaned.startsWith("```json")) cleaned = cleaned.slice(7);
        else if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
        if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
        cleaned = cleaned.trim();
        
        const parsed = JSON.parse(cleaned);
        console.log(`   ✅ Success with ${config.model}!`);
        return parsed;
        
      } catch (error) {
        console.log(`   ⚠️ Error: ${error.message}`);
        lastError = error;
        if (attempt < maxRetries) {
          console.log(`   Waiting 5 seconds before retry...`);
          await delay(5000);
        }
      }
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
  
  if (postText.includes("#GlobalScoreNews")) {
    return postText;
  }
  
  return `${postText}\n\n${hashtags.join(" ")}`.trim();
}

// ============================================
// MAIN FUNCTION
// ============================================

async function main() {
  console.log("🚀 Starting Global Score News Autopost...\n");
  
  assertEnv();
  
  const matches = await fetchAllMatches();
  
  if (!matches || matches.length === 0) {
    console.log("⚠️ No matches found. Exiting.");
    return;
  }
  
  const rawMatch = pickBestMatch(matches);
  
  if (!rawMatch) {
    console.log("⚠️ No suitable match found. Exiting.");
    return;
  }
  
  const matchData = transformToMatchData(rawMatch);
  console.log(`\n📋 Match: ${matchData.home_team} vs ${matchData.away_team}`);
  console.log(`   Status: ${matchData.status}`);
  console.log(`   Score: ${matchData.score.home} - ${matchData.score.away}`);
  console.log(`   Competition: ${matchData.competition}\n`);
  
  if (matchData.home_team === "Unknown" || matchData.away_team === "Unknown") {
    console.log("⚠️ Could not parse match data properly.");
    return;
  }
  
  const contentType = determineContentType(matchData.status);
  console.log(`📝 Content type: ${contentType}\n`);
  
  const geminiResponse = await generatePostWithGemini(contentType, matchData);
  console.log("✅ Post generated successfully\n");
  
  const message = buildFacebookMessage(geminiResponse);
  console.log("--- POST PREVIEW ---");
  console.log(message);
  console.log("--- END PREVIEW ---\n");
  
  const fbResult = await postToFacebook(message);
  console.log("✅ Posted to Facebook successfully!");
  console.log(`   Post ID: ${fbResult.id}`);
}

main().catch((error) => {
  console.error("❌ Error:", error.message);
  process.exit(1);
});
