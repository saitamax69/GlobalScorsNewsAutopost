// ============================================
// ENVIRONMENT VARIABLES
// ============================================
const SPORTDB_API_KEY = process.env.SPORTDB_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
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

Output format (JSON only, no extra text):
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
  console.log("✅ All environment variables present");
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================
// SPORTDB API
// ============================================

async function fetchLiveMatches() {
  const res = await fetch("https://api.sportdb.dev/api/flashscore/football/live", {
    headers: { "X-API-Key": SPORTDB_API_KEY }
  });
  
  if (!res.ok) return [];
  
  const data = await res.json();
  return Array.isArray(data) ? data : (data.matches || data.events || data.data || []);
}

async function fetchTodayMatches() {
  const res = await fetch("https://api.sportdb.dev/api/flashscore/football/today", {
    headers: { "X-API-Key": SPORTDB_API_KEY }
  });
  
  if (!res.ok) throw new Error(`SportDB error: ${res.status}`);
  
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
// MATCH SELECTION
// ============================================

function pickBestMatch(matches) {
  if (!matches?.length) return null;
  
  const hasValidTeams = (m) => (m.homeName || m.homeFirstName) && (m.awayName || m.awayFirstName);
  const validMatches = matches.filter(hasValidTeams);
  
  console.log(`Found ${validMatches.length} valid matches`);
  if (!validMatches.length) return matches[0];
  
  const getStatus = (m) => (m.eventStage || m.status || "").toUpperCase();
  
  // Priority: LIVE > HT > FT > Any
  const live = validMatches.find(m => {
    const s = getStatus(m);
    return s.includes("HALF") || s === "LIVE" || s === "1H" || s === "2H";
  });
  if (live) { console.log("🔴 Selected LIVE match"); return live; }
  
  const ht = validMatches.find(m => getStatus(m).includes("HT") || getStatus(m).includes("HALFTIME"));
  if (ht) { console.log("⏸️ Selected HT match"); return ht; }
  
  const ft = validMatches.find(m => {
    const s = getStatus(m);
    return s === "FINISHED" || s === "FT" || s === "ENDED";
  });
  if (ft) { console.log("✅ Selected FT match"); return ft; }
  
  console.log("📌 Selected first match");
  return validMatches[0];
}

function transformToMatchData(raw) {
  const normalizeStatus = (stage) => {
    const s = (stage || "").toUpperCase();
    if (s.includes("HALF") || s === "LIVE" || s === "1H" || s === "2H") return "LIVE";
    if (s === "FINISHED" || s === "ENDED" || s === "FT") return "FT";
    if (s.includes("HT") || s === "HALFTIME") return "HT";
    return "NS";
  };
  
  return {
    competition: raw.leagueName || raw.tournamentName || "",
    home_team: raw.homeName || raw.homeFirstName || "Unknown",
    away_team: raw.awayName || raw.awayFirstName || "Unknown",
    status: normalizeStatus(raw.eventStage || raw.status),
    minute: raw.gameTime !== "-1" ? raw.gameTime : null,
    score: {
      home: parseInt(raw.homeScore) || parseInt(raw.homeFullTimeScore) || 0,
      away: parseInt(raw.awayScore) || parseInt(raw.awayFullTimeScore) || 0
    }
  };
}

function determineContentType(status) {
  const types = { "LIVE": "live_update", "HT": "half_time", "FT": "full_time" };
  return types[status] || "preview";
}

// ============================================
// GROQ API
// ============================================

async function generateWithGroq(contentType, matchData) {
  console.log("🤖 Generating post with Groq...");
  
  const input = {
    page_name: "Global Score News",
    telegram_cta_url: "https://t.me/+xAQ3DCVJa8A2ZmY8",
    content_type: contentType,
    language: "en",
    match_data: matchData
  };

  const prompt = `${MASTER_INSTRUCTION}

Generate a ${contentType} post for this match:

${JSON.stringify(input, null, 2)}

IMPORTANT: Return ONLY valid JSON, no markdown, no extra text.`;

  // Updated Groq models list
  const models = [
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
    "llama3-70b-8192",
    "llama3-8b-8192",
    "mixtral-8x7b-32768",
    "gemma2-9b-it"
  ];
  
  let lastError = null;
  
  for (const model of models) {
    try {
      console.log(`   Trying model: ${model}`);
      
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${GROQ_API_KEY}`
        },
        body: JSON.stringify({
          model: model,
          messages: [
            {
              role: "system",
              content: "You are a professional social media editor. Always respond with valid JSON only, no markdown code blocks."
            },
            {
              role: "user",
              content: prompt
            }
          ],
          temperature: 0.7,
          max_tokens: 1024
        })
      });
      
      if (res.status === 429) {
        console.log("   ⚠️ Rate limited, waiting 5 seconds...");
        await delay(5000);
        continue;
      }
      
      if (!res.ok) {
        const errText = await res.text();
        console.log(`   ❌ ${model} failed: ${res.status} - ${errText.slice(0, 100)}`);
        lastError = new Error(`${model}: ${res.status}`);
        continue;
      }
      
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content || "";
      
      if (!text) {
        console.log(`   ⚠️ Empty response from ${model}`);
        continue;
      }
      
      // Parse JSON from response
      let cleaned = text.trim();
      
      // Remove markdown code blocks if present
      if (cleaned.startsWith("```json")) {
        cleaned = cleaned.slice(7);
      } else if (cleaned.startsWith("```")) {
        cleaned = cleaned.slice(3);
      }
      if (cleaned.endsWith("```")) {
        cleaned = cleaned.slice(0, -3);
      }
      cleaned = cleaned.trim();
      
      // Try to find JSON object in response
      const jsonStart = cleaned.indexOf("{");
      const jsonEnd = cleaned.lastIndexOf("}");
      if (jsonStart !== -1 && jsonEnd !== -1) {
        cleaned = cleaned.slice(jsonStart, jsonEnd + 1);
      }
      
      const parsed = JSON.parse(cleaned);
      console.log(`   ✅ Success with ${model}!`);
      return parsed;
      
    } catch (error) {
      console.log(`   ⚠️ Error with ${model}: ${error.message}`);
      lastError = error;
      continue;
    }
  }
  
  throw lastError || new Error("All Groq models failed");
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

function buildMessage(response) {
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
  if (!matches?.length) { 
    console.log("⚠️ No matches found. Exiting."); 
    return; 
  }
  
  const rawMatch = pickBestMatch(matches);
  if (!rawMatch) { 
    console.log("⚠️ No suitable match. Exiting."); 
    return; 
  }
  
  const matchData = transformToMatchData(rawMatch);
  console.log(`\n📋 Match: ${matchData.home_team} vs ${matchData.away_team}`);
  console.log(`   Status: ${matchData.status} | Score: ${matchData.score.home}-${matchData.score.away}`);
  console.log(`   Competition: ${matchData.competition}\n`);
  
  if (matchData.home_team === "Unknown") { 
    console.log("⚠️ Invalid match data. Exiting."); 
    return; 
  }
  
  const contentType = determineContentType(matchData.status);
  console.log(`📝 Content type: ${contentType}\n`);
  
  const response = await generateWithGroq(contentType, matchData);
  console.log("✅ Post generated!\n");
  
  const message = buildMessage(response);
  console.log("--- POST PREVIEW ---");
  console.log(message);
  console.log("--- END PREVIEW ---\n");
  
  const fbResult = await postToFacebook(message);
  console.log(`✅ Posted to Facebook! ID: ${fbResult.id}`);
}

main().catch((error) => {
  console.error("❌ Error:", error.message);
  process.exit(1);
});
