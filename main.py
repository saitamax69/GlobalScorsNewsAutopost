import os
import sys
import logging
import asyncio
import requests
import feedparser
import yt_dlp
import time

# Logging Setup
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger()

# Configuration
FB_PAGE_ACCESS_TOKEN = os.getenv("FB_PAGE_ACCESS_TOKEN")
FB_PAGE_ID = os.getenv("FB_PAGE_ID")

def get_latest_reddit_goal():
    """
    Reads r/soccer RSS feed and finds the latest goal.
    """
    rss_url = "https://www.reddit.com/r/soccer/new/.rss"
    logger.info("📡 Fetching latest posts from r/soccer...")
    
    # Custom User Agent is required for Reddit
    feedparser.USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
    feed = feedparser.parse(rss_url)
    
    if not feed.entries:
        logger.error("❌ Failed to fetch RSS feed.")
        return None, None

    # Loop through posts to find a goal
    for entry in feed.entries:
        title = entry.title
        link = entry.link
        
        # Filter: Must be a Goal, ignore "Goal Kick" or text posts
        if "Goal" in title and "Discussion" not in title:
            logger.info(f"✅ Found Goal: {title}")
            logger.info(f"🔗 Link: {link}")
            return link, title
            
    logger.warning("⚠️ No recent goals found in the feed.")
    return None, None

def download_video(url):
    filename = "temp_video.mp4"
    if os.path.exists(filename): os.remove(filename)
    
    logger.info(f"⬇️ Attempting download via yt-dlp...")

    ydl_opts = {
        'outtmpl': filename,
        'format': 'best[ext=mp4]/best',
        'quiet': True,
        'no_warnings': True,
        # Reddit specific settings
        'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
            
        if os.path.exists(filename):
            file_size = os.path.getsize(filename) / (1024 * 1024)
            logger.info(f"✅ Downloaded successfully! Size: {file_size:.2f} MB")
            return filename
        else:
            logger.warning("❌ Download finished but file not found (might be an unsupported host).")
            return None
    except Exception as e:
        logger.error(f"❌ yt-dlp Error: {e}")
        return None

def post_to_facebook(video_path, title):
    url = f"https://graph.facebook.com/v19.0/{FB_PAGE_ID}/videos"
    caption = f"⚽ {title} \n\n#football #soccer #goals #highlights #premierleague"
    
    if not FB_PAGE_ACCESS_TOKEN or not FB_PAGE_ID:
        logger.error("❌ Missing Facebook Credentials in Secrets!")
        return

    files = {'source': open(video_path, 'rb')}
    payload = {'access_token': FB_PAGE_ACCESS_TOKEN, 'description': caption}
    
    try:
        logger.info("📤 Uploading to Facebook...")
        # Increase timeout for video uploads
        r = requests.post(url, data=payload, files=files, timeout=60)
        
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
    logger.info("🚀 STARTING REDDIT-BASED BOT")
    
    # 1. Get Reddit Link
    video_url, title = get_latest_reddit_goal()
    
    if not video_url:
        logger.error("Exiting.")
        return

    # 2. Download
    video_path = download_video(video_url)
    
    # 3. Post
    if video_path:
        post_to_facebook(video_path, title)
    else:
        logger.error("Could not download video (unsupported host or deleted).")

if __name__ == "__main__":
    main()
