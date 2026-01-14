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

async def get_tiktok_video(query):
    """Searches TikTok and downloads video."""
    logger.info(f"Searching TikTok for: {query}")
    video_url = None

    try:
        async with TikTokApi() as api:
            await api.create_sessions(ms_tokens=[], num_sessions=1, sleep_after=3, headless=True)
            videos = api.search.videos(query, count=5)
            
            async for video in videos:
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
    
    # yt-dlp options to mimic a real browser
    ydl_opts = {
        'outtmpl': filename, 
        'format': 'mp4', 
        'quiet': True,
        'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
        return filename
    except Exception as e:
        logger.error(f"Download failed: {e}")
        return None

def post_to_facebook(video_path, title):
    url = f"https://graph.facebook.com/v19.0/{FB_PAGE_ID}/videos"
    caption = f"🔥 {title} ⚽️ \n#football #soccer #goals"
    
    files = {'source': open(video_path, 'rb')}
    payload = {'access_token': FB_PAGE_ACCESS_TOKEN, 'description': caption}
    
    try:
        logger.info("Uploading to Facebook...")
        r = requests.post(url, data=payload, files=files)
        if r.status_code == 200:
            logger.info(f"✅ Success! Posted to Facebook. ID: {r.json().get('id')}")
        else:
            logger.error(f"❌ FB Failed: {r.text}")
    except Exception as e:
        logger.error(f"FB Error: {e}")
    finally:
        files['source'].close()
        if os.path.exists(video_path):
            os.remove(video_path)

async def main():
    # FORCE TEST MODE:
    # Instead of checking the calendar, we manually define a "Match"
    test_search = "Real Madrid Goal"
    
    logger.info("🚀 STARTING MANUAL TEST RUN")
    
    video_path = await get_tiktok_video(test_search)
    
    if video_path:
        post_to_facebook(video_path, "Real Madrid Goal (Automated Post)")
    else:
        logger.error("Could not find or download a video.")

if __name__ == "__main__":
    asyncio.run(main())
