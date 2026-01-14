import os
import sys
import logging
import requests
import feedparser
import yt_dlp
import re

# Logging Setup
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger()

# Configuration
FB_PAGE_ACCESS_TOKEN = os.getenv("FB_PAGE_ACCESS_TOKEN")
FB_PAGE_ID = os.getenv("FB_PAGE_ID")

def get_latest_highlight():
    """
    Reads OurMatch RSS feed to get the latest highlight link.
    """
    rss_url = "https://ourmatch.net/videos/feed/"
    logger.info("📡 Fetching latest highlights from OurMatch...")
    
    feed = feedparser.parse(rss_url)
    
    if not feed.entries:
        logger.error("❌ Failed to fetch RSS feed.")
        return None

    # Get the very first entry (latest match)
    entry = feed.entries[0]
    title = entry.title
    link = entry.link
    
    logger.info(f"✅ Found Match: {title}")
    logger.info(f"🔗 Link: {link}")
    
    return {"title": title, "link": link}

def download_video(url):
    filename = "temp_video.mp4"
    if os.path.exists(filename): os.remove(filename)
    
    logger.info(f"⬇️ Attempting download via yt-dlp...")

    # We use 'best' format but ensure it's mp4 for Facebook compatibility
    ydl_opts = {
        'outtmpl': filename,
        'format': 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
        'quiet': True,
        'no_warnings': True,
        'ignoreerrors': True, # Keep trying different embedded players
        'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
            
        if os.path.exists(filename):
            file_size = os.path.getsize(filename) / (1024 * 1024)
            # Filter out tiny files (sometimes it downloads a 0kb error file)
            if file_size < 1: 
                logger.warning(f"❌ File too small ({file_size:.2f} MB). Probably failed.")
                return None
                
            logger.info(f"✅ Downloaded! Size: {file_size:.2f} MB")
            return filename
        else:
            logger.warning("❌ Download finished but file not found.")
            return None
    except Exception as e:
        logger.error(f"❌ yt-dlp Error: {e}")
        return None

def post_to_facebook(video_path, title):
    url = f"https://graph.facebook.com/v19.0/{FB_PAGE_ID}/videos"
    caption = f"🔥 Match Highlights: {title} ⚽️ \n\n#football #soccer #highlights #goals"
    
    if not FB_PAGE_ACCESS_TOKEN or not FB_PAGE_ID:
        logger.error("❌ Missing Facebook Credentials!")
        return

    files = {'source': open(video_path, 'rb')}
    payload = {'access_token': FB_PAGE_ACCESS_TOKEN, 'description': caption}
    
    try:
        logger.info("📤 Uploading to Facebook...")
        # Uploads can take time, set timeout to 3 minutes
        r = requests.post(url, data=payload, files=files, timeout=180)
        
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
    logger.info("🚀 STARTING OURMATCH BOT")
    
    # 1. Get Match Info
    match = get_latest_highlight()
    
    if not match:
        return

    # 2. Download
    # OurMatch pages contain embedded players. yt-dlp scans the page to find them.
    video_path = download_video(match['link'])
    
    # 3. Post
    if video_path:
        post_to_facebook(video_path, match['title'])
    else:
        logger.error("Could not download video from the page.")

if __name__ == "__main__":
    main()
