// ============================================
// ENVIRONMENT VARIABLES
// ============================================
const SPORTDB_API_KEY = process.env.SPORTDB_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY; // Optional: Add this for backup
const FB_PAGE_ID = process.env.FB_PAGE_ID;
const FB_PAGE_ACCESS_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN;

// ============================================
// MASTER INSTRUCTION
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
  const required = ["SPORTDB_API_KEY", "FB_PAGE_ID", "FB_PAGE_ACCESS_TOKEN"];
  
  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }
  
  if (!GEMINI_API_KEY && !OPENAI_API_KEY) {
    throw new Error("Need either GEMINI_API_KEY or OPENAI_API_KEY");
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
  return (m.eventStage || m.status || m.state || "").toString().toUpperCase();
}

function pickBestMatch(matches) {
  if (!matches || matches.length === 0) return null;
  
  const hasValidTeams = (m) => {
    const home = m.homeName || m.homeFirstName || "";
    const away = m.awayName || m.awayFirstName || "";
    return home.length > 0 && away.length > 0;
  };
  
  const validMatches = matches.filter(hasValidTeams);
  console.log(`Found ${validMatches.length} matches with valid team names`);
  
  if (validMatches.length === 0) return matches[0];
  
  // Priority: LIVE > HT > FT > Big League
  const live = validMatches.find(m => {
    const s = getMatchStatus(m);
    return s.includes("HALF") || s === "LIVE" || s === "1H" || s === "2H";
  });
  if (live) { console.log("🔴 Selected LIVE match"); return live; }
  
  const ht = validMatches.find(m => getMatchStatus(m).includes("HT") || getMatchStatus(m).includes("HALFTIME"));
  if (ht) { console.log("⏸️ Selected HT match"); return ht; }
  
  const ft = validMatches.find(m => {
    const s = getMatchStatus(m);
    return s === "FINISHED" || s === "FT" || s === "ENDED";
  });
  if (ft) { console.log("✅ Selected FT match"); return ft; }
  
  console.log("📌 Selected first valid match");
  return validMatches[0];
}

function transformToMatchData(raw) {
  const normalizeStatus = (stage) => {
    const s = (stage || "").toString().toUpperCase();
    if (s.includes("HALF") || s === "LIVE" || s === "1H" || s === "2H") return "LIVE";
    if (s === "FINISHED" || s === "ENDED" || s === "FT" || s === "AET") return "FT";
    if (s.includes("HT") || s === "HALFTIME") return "HT";
    return "NS";
  };
  
  return {
    competition: raw.leagueName || raw.tournamentName || "",
    round: raw.round || "",
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
    form: {},
    h2h: {},
    odds_like: {},
    venue: raw.venue || "",
    kickoff_iso: raw.startTime || "",
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
// GEMINI API (with longer delays)
// ============================================

async function generateWithGemini(contentType, matchData) {
  const input = {
    page_name: "Global Score News",
    telegram_cta_url: "https://t.me/+xAQ3DCVJa8A2ZmY8",
    content_type: contentType,
    language: "en",
    match_data: matchData
  };

  const prompt = `${MASTER_INSTRUCTION}\n\nGenerate a ${contentType} post for this match:\n\n${JSON.stringify(input, null, 2)}`;

  const maxRetries = 5;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.log(`   Gemini attempt ${attempt}/${maxRetries}`);
    
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
    
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 1024 }
      })
    });
    
    if (res.status === 429) {
      const waitTime = attempt * 20; // 20s, 40s, 60s, 80s, 100s
      console.log(`   ⚠️ Rate limited. Waiting ${waitTime} seconds...`);
      await delay(waitTime * 1000);
      continue;
    }
    
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini error ${res.status}: ${errText}`);
    }
    
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    
    let cleaned = text.trim();
    if (cleaned.startsWith("```json")) cleaned = cleaned.slice(7);
    else if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
    if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
    
    return JSON.parse(cleaned.trim());
  }
  
  throw new Error("Gemini rate limit exceeded after all retries");
}

// ============================================
// OPENAI API (Backup)
// ============================================

async function generateWithOpenAI(contentType, matchData) {
  const input = {
    page_name: "Global Score News",
    telegram_cta_url: "https://t.me/+xAQ3DCVJa8A2ZmY8",
    content_type: contentType,
    language: "en",
    match_data: matchData
  };

  const prompt = `${MASTER_INSTRUCTION}\n\nGenerate a ${contentType} post for this match:\n\n${JSON.stringify(input, null, 2)}`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: 1024
    })
  });
  
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${errText}`);
  }
  
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || "";
  
  let cleaned = text.trim();
  if (cleaned.startsWith("```json")) cleaned = cleaned.slice(7);
  else if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
  if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
  
  return JSON.parse(cleaned.trim());
}

// ============================================
// MAIN GENERATE FUNCTION
// ============================================

async function generatePost(contentType, matchData) {
  console.log("🤖 Generating post...");
  
  // Try OpenAI first if available (more reliable)
  if (OPENAI_API_KEY) {
    try {
      console.log("   Using OpenAI...");
      return await generateWithOpenAI(contentType, matchData);
    } catch (error) {
      console.log(`   OpenAI failed: ${error.message}`);
    }
  }
  
  // Try Gemini
  if (GEMINI_API_KEY) {
    try {
      console.log("   Using Gemini...");
      return await generateWithGemini(contentType, matchData);
    } catch (error) {
      console.log(`   Gemini failed: ${error.message}`);
      throw error;
    }
  }
  
  throw new Error("No AI API available");
}

// ============================================
// FACEBOOK API
// ============================================

async function postToFacebook(message) {
  console.log("📘 Posting to Facebook...");
  
  const res = await fetch(`https://graph.facebook.com/v19.0/${FB_PAGE_ID}/feed`, {
    method: "POST",
    body: new URLSearchParams({
      message: message,
      access_token: FB_PAGE_ACCESS_TOKEN
    })
  });
  
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Facebook error ${res.status}: ${errText}`);
  }
  
  return res.json();
}

function buildFacebookMessage(response) {
  const postText = response.post_text || "";
  const hashtags = response.hashtags || [];
  
  if (postText.includes("#GlobalScoreNews")) return postText;
  return `${postText}\n\n${hashtags.join(" ")}`.trim();
}

// ============================================
// MAIN
// ============================================

async function main() {
  console.log("🚀 Starting Global Score News Autopost...\n");
  
  assertEnv();
  
  const matches = await fetchAllMatches();
  if (!matches?.length) { console.log("⚠️ No matches found."); return; }
  
  const rawMatch = pickBestMatch(matches);
  if (!rawMatch) { console.log("⚠️ No suitable match."); return; }
  
  const matchData = transformToMatchData(rawMatch);
  console.log(`\n📋 Match: ${matchData.home_team} vs ${matchData.away_team}`);
  console.log(`   Status: ${matchData.status} | Score: ${matchData.score.home}-${matchData.score.away}`);
  console.log(`   Competition: ${matchData.competition}\n`);
  
  if (matchData.home_team === "Unknown") { console.log("⚠️ Invalid match data."); return; }
  
  const contentType = determineContentType(matchData.status);
  console.log(`📝 Content type: ${contentType}\n`);
  
  const response = await generatePost(contentType, matchData);
  console.log("✅ Post generated!\n");
  
  const message = buildFacebookMessage(response);
  console.log("--- POST PREVIEW ---");
  console.log(message);
  console.log("--- END PREVIEW ---\n");
  
  const fbResult = await postToFacebook(message);
  console.log(`✅ Posted! ID: ${fbResult.id}`);
}

main().catch((error) => {
  console.error("❌ Error:", error.message);
  process.exit(1);
});
