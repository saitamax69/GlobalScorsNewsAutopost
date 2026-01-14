import os
import sys
import logging
import requests
import yt_dlp

# Logging Setup
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger()

FB_PAGE_ACCESS_TOKEN = os.getenv("FB_PAGE_ACCESS_TOKEN")
FB_PAGE_ID = os.getenv("FB_PAGE_ID")

def find_twitter_video():
    # Search for "Goal" videos on Twitter
    # We use a specific URL that yt-dlp understands as a search
    # "min_faves:500" ensures it's a popular/real goal, not spam
    search_query = "https://twitter.com/search?q=goal filter:videos min_faves:500&src=typed_query&f=live"
    
    logger.info(f"📡 Searching Twitter for goals...")
    
    ydl_opts = {
        'quiet': True,
        'extract_flat': True,
        'playlistend': 1, 
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            # yt-dlp search syntax: "bvsearch1:[QUERY]"
            # This searches specifically for a video
            result = ydl.extract_info("bvsearch1:football goal highlight", download=False)
            
            if 'entries' in result and len(result['entries']) > 0:
                video = result['entries'][0]
                url = video.get('url') or video.get('webpage_url')
                title = video.get('title', 'Football Goal')
                
                logger.info(f"✅ Found Video: {title}")
                return {"title": title, "link": url}
            
            logger.warning("No videos found.")
            return None
    except Exception as e:
        logger.error(f"❌ Search Error: {e}")
        return None

def download_video(url):
    filename = "temp_video.mp4"
    if os.path.exists(filename): os.remove(filename)
    
    logger.info(f"⬇️ Downloading: {url}")

    ydl_opts = {
        'outtmpl': filename,
        'format': 'best[ext=mp4]',
        'quiet': True,
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
            if os.path.exists(filename):
                return filename
        return None
    except Exception as e:
        logger.error(f"❌ Download Error: {e}")
        return None

def post_to_facebook(video_path, title):
    url = f"https://graph.facebook.com/v19.0/{FB_PAGE_ID}/videos"
    caption = f"⚽ {title} \n\n#football #soccer #goals"
    
    files = {'source': open(video_path, 'rb')}
    payload = {'access_token': FB_PAGE_ACCESS_TOKEN, 'description': caption}
    
    try:
        logger.info("📤 Uploading to Facebook...")
        requests.post(url, data=payload, files=files, timeout=300)
        logger.info("✅ Upload attempted (Async). Check Facebook.")
    except Exception as e:
        logger.error(f"Upload Error: {e}")
    finally:
        files['source'].close()
        if os.path.exists(video_path): os.remove(video_path)

def main():
    logger.info("🚀 STARTING TWITTER/SEARCH BOT")
    match = find_twitter_video()
    if match:
        video_path = download_video(match['link'])
        if video_path:
            post_to_facebook(video_path, match['title'])

if __name__ == "__main__":
    main()
