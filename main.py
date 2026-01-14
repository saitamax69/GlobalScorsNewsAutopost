import os
import sys
import logging
import asyncio
import requests
import time
import yt_dlp
from datetime import datetime
from TikTokApi import TikTokApi

# Logging Setup
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger()

# Configuration
FOOTBALL_API_KEY = os.getenv("FOOTBALL_API_KEY")
FB_PAGE_ACCESS_TOKEN = os.getenv("FB_PAGE_ACCESS_TOKEN")
FB_PAGE_ID = os.getenv("FB_PAGE_ID")

# IDs for: Premier League, La Liga, Bundesliga, Serie A, Ligue 1, UCL
TARGET_LEAGUES = [2021, 2014, 2002, 2019, 2015, 2001] 

def get_biggest_matches():
    """Finds top 2 matches for today."""
    if not FOOTBALL_API_KEY:
        logger.error("Football API Key missing.")
        return []

    headers = {"X-Auth-Token": FOOTBALL_API_KEY}
    today = datetime.now().strftime("%Y-%m-%d")
    url = f"http://api.football-data.org/v4/matches?dateFrom={today}&dateTo={today}"
    
    try:
        logger.info(f"Fetching matches for {today}...")
        response = requests.get(url, headers=headers)
        
        if response.status_code != 200:
            logger.error(f"Football API Error: {response.text}")
            return []

        data = response.json()
        matches = []
        
        for match in data.get('matches', []):
            if match['competition']['id'] in TARGET_LEAGUES:
                matches.append({
                    "home": match['homeTeam']['name'],
                    "away": match['awayTeam']['name'],
                    "league": match['competition']['name']
                })
        
        logger.info(f"Found {len(matches)} matches in top leagues.")
        return matches[:2] # Return top 2
        
    except Exception as e:
        logger.error(f"Error fetching matches: {e}")
        return []

async def get_tiktok_video(match):
    """Searches TikTok and downloads video."""
    query = f"{match['home']} vs {match['away']} goal"
    logger.info(f"Searching TikTok for: {query}")
    video_url = None

    try:
        async with TikTokApi() as api:
            await api.create_sessions(ms_tokens=[], num_sessions=1, sleep_after=3, headless=True)
            videos = api.search.videos(query, count=10)
            
            async for video in videos:
                # Basic check: uploaded recently (timestamp check omitted for simplicity in v1)
                # We just take the first result that looks valid
                data = video.as_dict
                video_url = f"https://www.tiktok.com/@{data['author']['uniqueId']}/video/{data['id']}"
                logger.info(f"Found video URL: {video_url}")
                break
    except Exception as e:
        logger.error(f"TikTok Scraping failed: {e}")
        return None

    if video_url:
        return download_video(video_url)
    return None

def download_video(url):
    filename = "temp_video.mp4"
    if os.path.exists(filename): os.remove(filename)
    
    ydl_opts = {'outtmpl': filename, 'format': 'mp4', 'quiet': True}
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
        return filename
    except Exception as e:
        logger.error(f"Download failed: {e}")
        return None

def post_to_facebook(video_path, match):
    url = f"https://graph.facebook.com/v19.0/{FB_PAGE_ID}/videos"
    caption = f"Goal! ⚽️ {match['home']} vs {match['away']} \n#football #{match['home'].replace(' ','')}"
    
    files = {'source': open(video_path, 'rb')}
    payload = {'access_token': FB_PAGE_ACCESS_TOKEN, 'description': caption}
    
    try:
        logger.info("Uploading to Facebook...")
        r = requests.post(url, data=payload, files=files)
        if r.status_code == 200:
            logger.info("Success!")
        else:
            logger.error(f"FB Failed: {r.text}")
    except Exception as e:
        logger.error(f"FB Error: {e}")
    finally:
        files['source'].close()
        os.remove(video_path)

async def main():
    matches = get_biggest_matches()
    if not matches:
        logger.info("No matches today.")
        return

    for match in matches:
        video_path = await get_tiktok_video(match)
        if video_path:
            post_to_facebook(video_path, match)
            time.sleep(10)

if __name__ == "__main__":
    asyncio.run(main())
