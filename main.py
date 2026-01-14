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

def is_goal_post(title):
    """
    Relaxed filter: Returns True if it looks like a video.
    """
    title_lower = title.lower()
    
    # Reject obvious text discussions
    bad_words = ["discussion", "thread", "daily discussion", "question", "quote", "interview", "stat", "analysis", "official"]
    if any(w in title_lower for w in bad_words):
        return False
        
    # Accept anything with "goal", "highlight", "vs", or a score like "1-0"
    if "goal" in title_lower or "highlight" in title_lower:
        return True
    
    if " vs " in title_lower:
        return True
        
    if re.search(r'\d+-\d+', title):
        return True
        
    return False

def get_reddit_goal_candidates():
    """
    Reads r/soccer RSS feed and returns a LIST of potential video links.
    """
    # Increased limit to 100 to find older goals if today is slow
    rss_url = "https://www.reddit.com/r/soccer/new/.rss?limit=100"
    logger.info("📡 Fetching latest posts from r/soccer...")
    
    feedparser.USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
    feed = feedparser.parse(rss_url)
    
    candidates = []
    
    if not feed.entries:
        logger.error("❌ Failed to fetch RSS feed.")
        return []

    for entry in feed.entries:
        if is_goal_post(entry.title):
            candidates.append((entry.link, entry.title))
            
    logger.info(f"🔍 Found {len(candidates)} potential goal videos.")
    return candidates

def download_video(url):
    filename = "temp_video.mp4"
    if os.path.exists(filename): os.remove(filename)
    
    logger.info(f"⬇️ Trying to download: {url}")

    ydl_opts = {
        'outtmpl': filename,
        'format': 'best[ext=mp4]/best',
        'quiet': True,
        'no_warnings': True,
        'ignoreerrors': True,
        'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
            
        if os.path.exists(filename):
            file_size = os.path.getsize(filename) / (1024 * 1024)
            if file_size < 0.1: 
                return None
            logger.info(f"✅ Downloaded! Size: {file_size:.2f} MB")
            return filename
        return None
    except Exception as e:
        logger.warning(f"⚠️ Download skipped: {e}")
        return None

def post_to_facebook(video_path, title):
    url = f"https://graph.facebook.com/v19.0/{FB_PAGE_ID}/videos"
    caption = f"⚽ {title} \n\n#football #soccer #goals #highlights"
    
    if not FB_PAGE_ACCESS_TOKEN or not FB_PAGE_ID:
        logger.error("❌ Missing Facebook Credentials!")
        return False

    files = {'source': open(video_path, 'rb')}
    payload = {'access_token': FB_PAGE_ACCESS_TOKEN, 'description': caption}
    
    try:
        logger.info("📤 Uploading to Facebook...")
        r = requests.post(url, data=payload, files=files, timeout=120)
        
        if r.status_code == 200:
            logger.info(f"✅ SUCCESS! Posted ID: {r.json().get('id')}")
            return True
        else:
            logger.error(f"❌ FB Failed: {r.text}")
            return False
    except Exception as e:
        logger.error(f"FB Error: {e}")
        return False
    finally:
        files['source'].close()
        if os.path.exists(video_path):
            os.remove(video_path)

def main():
    logger.info("🚀 STARTING BOT (RELAXED FILTER)")
    
    candidates = get_reddit_goal_candidates()
    
    if not candidates:
        logger.warning("No valid posts found.")
        return

    for link, title in candidates:
        logger.info(f"👉 Processing: {title}")
        video_path = download_video(link)
        
        if video_path:
            success = post_to_facebook(video_path, title)
            if success:
                logger.info("🎉 Mission Accomplished. Exiting.")
                return 
            
        logger.info("🔄 Trying next candidate...")

    logger.error("❌ Could not download or post any candidates.")

if __name__ == "__main__":
    main()
