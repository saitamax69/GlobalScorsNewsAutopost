#!/usr/bin/env python3
import os
import sys
import json
import logging
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List, Tuple

import requests
from PIL import Image, ImageDraw, ImageFont

# --- CONFIGURATION ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Constants
RAPIDAPI_HOST = "free-football-api-data.p.rapidapi.com"
TELEGRAM_LINK = "https://t.me/+xAQ3DCVJa8A2ZmY8"

# Environment Variables
RAPIDAPI_KEY = os.environ.get("RAPIDAPI_KEY")
FACEBOOK_PAGE_ACCESS_TOKEN = os.environ.get("FACEBOOK_PAGE_ACCESS_TOKEN")
FACEBOOK_PAGE_ID = os.environ.get("FACEBOOK_PAGE_ID", "me")

class FootballAPIClient:
    def __init__(self, api_key: str):
        self.base_url = f"https://{RAPIDAPI_HOST}"
        self.headers = {
            "x-rapidapi-host": RAPIDAPI_HOST,
            "x-rapidapi-key": api_key
        }

    def _get(self, endpoint: str, params: Dict = None):
        url = f"{self.base_url}/{endpoint}"
        try:
            resp = requests.get(url, headers=self.headers, params=params, timeout=30)
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            logger.error(f"API Request failed: {e}")
            raise

    def get_finished_matches_today(self) -> List[Dict]:
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        logger.info(f"Fetching matches for: {today}")
        
        data = self._get("football-matches-by-date", {"date": today})
        matches = data if isinstance(data, list) else data.get("response", data.get("data", []))
        
        finished = []
        indicators = ["finished", "ended", "ft", "full-time", "complete"]
        
        for m in matches:
            status = str(m.get("status", "")).lower()
            if not status and "fixture" in m:
                status = str(m["fixture"].get("status", {}).get("long", "")).lower()
            
            if any(ind in status for ind in indicators):
                finished.append(m)
        return finished

    def get_stats(self, event_id: str) -> Dict:
        return self._get("football-event-statistics", {"eventid": event_id})

def extract_event_id(match: Dict) -> Optional[str]:
    # Tries common ID fields (API format varies sometimes)
    for key in ["id", "eventId", "fixtureId", "matchId"]:
        if key in match: return str(match[key])
    if "fixture" in match: return str(match["fixture"].get("id"))
    return None

def extract_team_data(match: Dict) -> Tuple[str, str, int, int]:
    home, away = "Home", "Away"
    h_score, a_score = 0, 0
    
    # Extract Names
    if "homeTeam" in match:
        home = match["homeTeam"].get("name", "Home")
        away = match["awayTeam"].get("name", "Away")
    elif "teams" in match:
        home = match["teams"]["home"].get("name", "Home")
        away = match["teams"]["away"].get("name", "Away")
        
    # Extract Scores
    if "score" in match and isinstance(match["score"], dict):
        h_score = match["score"].get("fulltime", {}).get("home", 0)
        a_score = match["score"].get("fulltime", {}).get("away", 0)
    elif "goals" in match:
        h_score = match["goals"].get("home", 0)
        a_score = match["goals"].get("away", 0)
        
    return home, away, int(h_score or 0), int(a_score or 0)

def parse_stats(raw_data: Dict) -> Dict:
    data = raw_data.get("response", raw_data)
    if isinstance(data, list) and data: data = data[0]
    
    stats = {}
    
    # We want these specific stats
    target_stats = {
        "Possession": ["Ball possession", "possession"],
        "Shots on Target": ["Shots on target", "shots_on_target"],
        "Total Shots": ["Total shots", "total_shots"],
        "Corners": ["Corner kicks", "corners"],
        "Fouls": ["Fouls", "fouls"]
    }

    # Find the stats list inside the response
    stat_groups = data.get("statistics", [])
    items = []
    if isinstance(stat_groups, list):
        for group in stat_groups:
             if "statisticsItems" in group:
                 items.extend(group["statisticsItems"])
             elif "type" in group:
                 items.append(group)

    # Filter and extract
    for label, keys in target_stats.items():
        for item in items:
            item_name = item.get("name", item.get("type", ""))
            if item_name in keys:
                stats[label] = {
                    "home": str(item.get("home", "0")).replace("%",""),
                    "away": str(item.get("away", "0")).replace("%","")
                }
                break
    return stats

def create_image(home: str, away: str, h_score: int, a_score: int, stats: Dict):
    W, H = 1080, 1080
    bg_color = (15, 23, 42)
    card_color = (30, 41, 59)
    accent = (34, 197, 94) # Green
    text_white = (248, 250, 252)
    
    img = Image.new('RGB', (W, H), bg_color)
    draw = ImageDraw.Draw(img)
    
    # Font loading logic
    try:
        font_lg = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 60)
        font_md = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 40)
        font_sm = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 28)
    except:
        font_lg = font_md = font_sm = ImageFont.load_default()

    # Title
    draw.text((540, 80), "MATCH STATISTICS", font=font_md, fill=accent, anchor="mm")
    draw.text((540, 140), datetime.now().strftime("%d %b %Y"), font=font_sm, fill=(148, 163, 184), anchor="mm")

    # Score Board
    draw.rounded_rectangle([(100, 200), (980, 400)], radius=20, fill=card_color)
    draw.text((250, 260), home[:15], font=font_md, fill=text_white, anchor="mm")
    draw.text((830, 260), away[:15], font=font_md, fill=text_white, anchor="mm")
    draw.text((540, 300), f"{h_score} - {a_score}", font=font_lg, fill=accent, anchor="mm")
    draw.text((540, 360), "Full Time", font=font_sm, fill=(148, 163, 184), anchor="mm")

    # Stats Rows
    y = 500
    for label, val in stats.items():
        draw.rectangle([(100, y), (980, y+80)], fill=card_color)
        draw.text((540, y+40), label.upper(), font=font_sm, fill=(148, 163, 184), anchor="mm")
        draw.text((150, y+40), val['home'], font=font_md, fill=text_white, anchor="lm")
        w = draw.textlength(val['away'], font=font_md)
        draw.text((930-w, y+25), val['away'], font=font_md, fill=text_white)
        y += 100

    img.save("stats_card.jpg")
    print("📸 Image generated: stats_card.jpg")

def post_to_facebook(caption: str, image_path: str):
    url = f"https://graph.facebook.com/v18.0/{FACEBOOK_PAGE_ID}/photos"
    with open(image_path, "rb") as img:
        payload = {"caption": caption, "access_token": FACEBOOK_PAGE_ACCESS_TOKEN}
        files = {"source": img}
        resp = requests.post(url, data=payload, files=files)
        
    if resp.status_code == 200:
        print(f"✅ Posted to FB: {resp.json().get('post_id')}")
    else:
        print(f"❌ FB Upload Failed: {resp.text}")
        sys.exit(1)

def main():
    if not RAPIDAPI_KEY or not FACEBOOK_PAGE_ACCESS_TOKEN:
        print("❌ Missing API Keys in environment.")
        sys.exit(1)

    client = FootballAPIClient(RAPIDAPI_KEY)
    
    # 1. Get Matches
    matches = client.get_finished_matches_today()
    if not matches:
        print("No completed matches found today.")
        sys.exit(0)
        
    # 2. Select Match & Get ID
    match = matches[0] # Selects first completed match
    eid = extract_event_id(match)
    home, away, h_score, a_score = extract_team_data(match)
    
    print(f"👉 Selected: {home} vs {away} (ID: {eid})")
    
    if not eid:
        print("❌ Could not get Event ID")
        sys.exit(1)

    # 3. Get Stats
    raw_stats = client.get_stats(eid)
    stats = parse_stats(raw_stats)
    
    # 4. Generate Content
    create_image(home, away, h_score, a_score, stats)
    
    # CAPTION GENERATION
    caption = f"📊 Match Stats Update: {home} vs {away}\n"
    caption += f"⚽ Score: {h_score} - {a_score}\n\n"
    
    for k, v in stats.items():
        caption += f"{k}: {v['home']} - {v['away']}\n"
        
    caption += "\n🔮 We post accurate predictions for matches like this on our channel!"
    caption += f"\n👉 Join here: {TELEGRAM_LINK}"
    caption += "\n\n#Football #MatchStats #Predictions #BettingTips #Soccer"
    
    # 5. Post
    post_to_facebook(caption, "stats_card.jpg")

if __name__ == "__main__":
    main()
