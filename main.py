#!/usr/bin/env python3
import os
import sys
import logging
import requests
from datetime import datetime, timezone
from PIL import Image, ImageDraw, ImageFont

# --- CONFIG ---
logging.basicConfig(level=logging.INFO, format='%(message)s')
logger = logging.getLogger(__name__)

# THE HOST FROM YOUR CURL
RAPIDAPI_HOST = "free-football-api-data.p.rapidapi.com"
TELEGRAM_LINK = "https://t.me/+xAQ3DCVJa8A2ZmY8"

RAPIDAPI_KEY = os.environ.get("RAPIDAPI_KEY")
FB_TOKEN = os.environ.get("FACEBOOK_PAGE_ACCESS_TOKEN")
FB_PAGE_ID = os.environ.get("FACEBOOK_PAGE_ID")

class FootballAPI:
    def __init__(self):
        self.headers = {
            "x-rapidapi-host": RAPIDAPI_HOST,
            "x-rapidapi-key": RAPIDAPI_KEY
        }
        self.base = f"https://{RAPIDAPI_HOST}"

    def get_matches_today(self):
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        # For this specific API, this is the endpoint to find match IDs
        url = f"{self.base}/football-get-all-matches-by-date"
        
        logger.info(f"📅 Fetching matches for: {today}")
        try:
            resp = requests.get(url, headers=self.headers, params={"date": today})
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            logger.error(f"Failed to fetch matches: {e}")
            return None

    def get_stats(self, event_id):
        # THE EXACT ENDPOINT FROM YOUR CURL
        url = f"{self.base}/football-event-statistics"
        logger.info(f"📊 Fetching stats for Event ID: {event_id}")
        try:
            resp = requests.get(url, headers=self.headers, params={"eventid": event_id})
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            logger.error(f"Failed to fetch stats: {e}")
            return None

def find_finished_match(data):
    # This API returns leagues, we need to dig into events
    leagues = data if isinstance(data, list) else data.get('leagues', [])
    for league in leagues:
        for event in league.get('events', []):
            status = event.get('status', {})
            # Look for finished matches
            if status.get('finished') or status.get('type') == 'finished':
                return event
    return None

def create_card(home, away, h_score, a_score, stats_resp):
    img = Image.new('RGB', (1080, 1080), (15, 23, 42))
    draw = ImageDraw.Draw(img)
    
    try:
        f_lg = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 80)
        f_md = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 40)
        f_sm = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 30)
    except:
        f_lg = f_md = f_sm = ImageFont.load_default()

    draw.text((540, 100), "MATCH RESULT", font=f_md, fill=(34, 197, 94), anchor="mm")
    draw.rounded_rectangle([(100, 250), (980, 500)], radius=20, fill=(30, 41, 59))
    draw.text((540, 320), f"{h_score} - {a_score}", font=f_lg, fill=(34, 197, 94), anchor="mm")
    draw.text((250, 320), home[:12], font=f_md, fill="white", anchor="mm")
    draw.text((830, 320), away[:12], font=f_md, fill="white", anchor="mm")

    # Parse stats from the specific API structure
    y = 600
    # Statistics are usually in response[0]['groups'][0]['statisticsItems']
    try:
        stats_data = stats_resp if isinstance(stats_resp, list) else stats_resp.get('response', [])
        if stats_data:
            items = stats_data[0].get('groups', [{}])[0].get('statisticsItems', [])
            for item in items[:5]:
                name = item.get('name', 'Stat')
                h = str(item.get('home', '0'))
                a = str(item.get('away', '0'))
                draw.text((540, y), name.upper(), font=f_sm, fill=(148, 163, 184), anchor="mm")
                draw.text((150, y), h, font=f_md, fill="white", anchor="lm")
                draw.text((930, y), a, font=f_md, fill="white", anchor="rm")
                y += 90
    except:
        draw.text((540, 700), "Check Telegram for Full Stats", font=f_sm, fill="white", anchor="mm")

    img.save("stats_card.jpg")

def main():
    if not RAPIDAPI_KEY or not FB_TOKEN:
        print("❌ Missing Secrets (RAPIDAPI_KEY or FB_TOKEN)")
        sys.exit(1)

    api = FootballAPI()
    
    # 1. Find a match
    match_data = api.get_matches_today()
    if not match_data:
        print("No match data found for today.")
        return

    match = find_finished_match(match_data)
    if not match:
        print("No finished matches found today.")
        return

    # 2. Extract match data
    eid = match['id']
    home = match['homeTeam']['name']
    away = match['awayTeam']['name']
    h_score = match['homeTeam']['score']
    a_score = match['awayTeam']['score']

    # 3. Get Stats (The CURL endpoint)
    stats = api.get_stats(eid)

    # 4. Generate Image
    create_card(home, away, h_score, a_score, stats)

    # 5. Post to Facebook
    caption = f"✅ Match Result: {home} vs {away}\n"
    caption += f"⚽ Final Score: {h_score} - {a_score}\n\n"
    caption += "🔮 We post winning predictions daily on our channel!\n"
    caption += f"👉 Join: {TELEGRAM_LINK}\n\n#Football #MatchStats #Predictions"

    url = f"https://graph.facebook.com/v18.0/{FB_PAGE_ID}/photos"
    with open("stats_card.jpg", "rb") as f:
        requests.post(url, data={"caption": caption, "access_token": FB_TOKEN}, files={"source": f})
    
    print(f"✅ Posted {home} vs {away} to Facebook!")

if __name__ == "__main__":
    main()
