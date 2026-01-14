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
    Returns True if the title looks like a real goal video.
    Filters out quotes, stats, and discussions.
    """
    # Reject text-heavy keywords
    bad_words = ["Quote", "Interview", "Stats", "Analysis", "Discussion", "Thread", "List", "Question"]
    if any(w in title for w in bad_words):
        return False
        
    # Must have "Goal" or "Highlight"
    if "Goal" not in title and "highlight" not in title.lower():
        return False
        
    # Strong indicator: Contains score or 'vs' (e.g., "Team A 1-0 Team B", "Team A [2]-0 Team B")
    # Regex looks for digit-digit pattern or 'vs'
    if re.search(r'\d+-\d+', title) or " vs " in title.lower():
        return True
        
    return False

def get_reddit_goal_candidates():
    """
    Reads r/soccer RSS feed and returns a LIST of potential video links.
    """
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
        # IMPORTANT: Ignore errors so we can try the next video
        'ignoreerrors': True,
        'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
            
        if os.path.exists(filename):
            file_size = os.path.getsize(filename) / (1024 * 1024)
            if file_size < 0.1: # Skip empty/broken files
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
    logger.info("🚀 STARTING BOT (SMART LOOP)")
    
    # 1. Get List of Candidates
    candidates = get_reddit_goal_candidates()
    
    if not candidates:
        logger.warning("No valid goal posts found right now.")
        return

    # 2. Loop until we successfully post ONE video
    for link, title in candidates:
        logger.info(f"👉 Processing: {title}")
        
        # Try Download
        video_path = download_video(link)
        
        if video_path:
            # Try Post
            success = post_to_facebook(video_path, title)
            if success:
                logger.info("🎉 Mission Accomplished. Exiting.")
                return # Stop after posting 1 video
            
        logger.info("🔄 Trying next candidate...")

    logger.error("❌ Could not download or post any of the candidates.")

if __name__ == "__main__":
    main()
