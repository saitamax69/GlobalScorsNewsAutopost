import os
import sys
import logging
import asyncio
import requests
import time
import yt_dlp
from datetime import datetime

# Logging Setup
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger()

# Configuration
RAPIDAPI_KEY = os.getenv("RAPIDAPI_KEY")
FB_PAGE_ACCESS_TOKEN = os.getenv("FB_PAGE_ACCESS_TOKEN")
FB_PAGE_ID = os.getenv("FB_PAGE_ID")

def get_latest_goal_video():
    """
    Fetches the latest football video URL from RapidAPI.
    """
    if not RAPIDAPI_KEY:
        logger.error("❌ Missing RAPIDAPI_KEY in GitHub Secrets.")
        return None, None

    url = "https://free-football-soccer-videos.p.rapidapi.com/"
    headers = {
        "X-RapidAPI-Key": RAPIDAPI_KEY,
        "X-RapidAPI-Host": "free-football-soccer-videos.p.rapidapi.com"
    }

    try:
        logger.info("📡 Fetching latest videos from API...")
        response = requests.get(url, headers=headers)
        data = response.json()
        
        # Get the very first video (latest)
        if data and len(data) > 0:
            video_data = data[0]
            title = video_data.get('title', 'Football Goal')
            
            # The API returns a 'url' (usually ScoreBat) or embedded 'videos' list
            # We prefer the direct URL to pass to yt-dlp
            video_url = video_data.get('url')
            
            logger.info(f"✅ Found Video: {title}")
            logger.info(f"🔗 Link: {video_url}")
            return video_url, title
            
    except Exception as e:
        logger.error(f"❌ API Error: {e}")
    
    return None, None

def download_video(url):
    filename = "temp_video.mp4"
    if os.path.exists(filename): os.remove(filename)
    
    logger.info(f"⬇️ Downloading: {url}")

    ydl_opts = {
        'outtmpl': filename,
        'format': 'best', # Get best quality
        'quiet': True,
        'no_warnings': True,
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
            
        if os.path.exists(filename):
            file_size = os.path.getsize(filename) / (1024 * 1024)
            logger.info(f"✅ Downloaded successfully! Size: {file_size:.2f} MB")
            return filename
        else:
            logger.warning("❌ Download finished but file not found.")
            return None
    except Exception as e:
        logger.error(f"❌ yt-dlp Error: {e}")
        return None

def post_to_facebook(video_path, title):
    url = f"https://graph.facebook.com/v19.0/{FB_PAGE_ID}/videos"
    caption = f"⚽ {title} \n\n#football #soccer #goals #highlights"
    
    files = {'source': open(video_path, 'rb')}
    payload = {'access_token': FB_PAGE_ACCESS_TOKEN, 'description': caption}
    
    try:
        logger.info("📤 Uploading to Facebook...")
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

def main():
    logger.info("🚀 STARTING API-BASED BOT")
    
    # 1. Get Video URL from API
    video_url, title = get_latest_goal_video()
    
    if not video_url:
        logger.error("Could not find a video URL. Exiting.")
        return

    # 2. Download
    video_path = download_video(video_url)
    
    # 3. Post
    if video_path:
        post_to_facebook(video_path, title)
    else:
        logger.error("Could not download video.")

if __name__ == "__main__":
    main()
