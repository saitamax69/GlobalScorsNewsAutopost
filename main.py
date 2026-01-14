import os
import sys
import logging
import requests
import yt_dlp

# Logging Setup
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger()

# Configuration
FB_PAGE_ACCESS_TOKEN = os.getenv("FB_PAGE_ACCESS_TOKEN")
FB_PAGE_ID = os.getenv("FB_PAGE_ID")

# Instagram Page to scrape (Open public profile)
INSTAGRAM_URL = "https://www.instagram.com/433/reels/"

def get_latest_reel():
    logger.info(f"📡 Fetching latest reel from: {INSTAGRAM_URL}")
    
    ydl_opts = {
        'quiet': True,
        'extract_flat': True, 
        'playlistend': 1, # Get latest 1
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(INSTAGRAM_URL, download=False)
            
            if 'entries' in info and len(info['entries']) > 0:
                video = info['entries'][0]
                url = video['url']
                title = video.get('title', 'Football Clip')
                
                logger.info(f"✅ Found Reel: {title[:30]}...")
                logger.info(f"🔗 Link: {url}")
                return {"title": title, "link": url}
            
            logger.warning("No videos found.")
            return None
    except Exception as e:
        logger.error(f"❌ Fetch Error: {e}")
        return None

def download_video(url):
    filename = "temp_video.mp4"
    if os.path.exists(filename): os.remove(filename)
    
    logger.info(f"⬇️ Downloading: {url}")

    ydl_opts = {
        'outtmpl': filename,
        'format': 'mp4', # Instagram is always mp4
        'quiet': True,
        'no_warnings': True,
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
            
        if os.path.exists(filename):
            size = os.path.getsize(filename) / (1024 * 1024)
            logger.info(f"✅ Downloaded! Size: {size:.2f} MB")
            return filename
        return None
    except Exception as e:
        logger.error(f"❌ Download Error: {e}")
        return None

def post_to_facebook(video_path, title):
    url = f"https://graph.facebook.com/v19.0/{FB_PAGE_ID}/videos"
    # Clean up title
    clean_title = title.split('\n')[0] if title else "Football Highlight"
    caption = f"⚽ {clean_title} \n\n#football #soccer #goals #highlights"
    
    files = {'source': open(video_path, 'rb')}
    payload = {'access_token': FB_PAGE_ACCESS_TOKEN, 'description': caption}
    
    try:
        logger.info("📤 Uploading to Facebook...")
        r = requests.post(url, data=payload, files=files, timeout=300)
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
    logger.info("🚀 STARTING INSTAGRAM REELS BOT")
    match = get_latest_reel()
    if not match: return

    video_path = download_video(match['link'])
    if video_path:
        post_to_facebook(video_path, match['title'])
    else:
        logger.error("Download failed.")

if __name__ == "__main__":
    main()
