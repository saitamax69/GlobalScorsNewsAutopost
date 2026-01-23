import feedparser
import facebook
import os
import requests
import json
import google.generativeai as genai
import random
from bs4 import BeautifulSoup # New library for HD images

# --- CONFIGURATION ---
RSS_FEEDS = [
    "https://www.skysports.com/rss/12040",
    "https://www.espn.com/espn/rss/soccer/news",
    "http://feeds.bbci.co.uk/sport/football/rss.xml",
    "https://www.90min.com/posts.rss"
]

BLACKLIST = [
    "podcast", "live stream", "how to watch", "betting", "odds", 
    "sky sports", "subscribe", "fantasy", "quiz", "preview", "prediction"
]

HISTORY_FILE = "history.json"

def setup_env():
    fb_token = os.environ.get("FB_PAGE_ACCESS_TOKEN")
    page_id = os.environ.get("FB_PAGE_ID")
    gemini_key = os.environ.get("GEMINI_API_KEY")

    if not all([fb_token, page_id, gemini_key]):
        raise Exception("Missing Environment Variables.")
    
    genai.configure(api_key=gemini_key)
    return fb_token, page_id

def get_ai_rewrite(title, description):
    """ Rewrite text using Gemini AI """
    try:
        model = genai.GenerativeModel('gemini-pro')
        prompt = (
            f"Act as a viral football news page. "
            f"Headline: '{title}'. Summary: '{description}'. "
            f"Write a short, hype Facebook post (max 2 sentences). "
            f"Use emojis. Add 3 hashtags. "
            f"No 'read more'. No source names."
        )
        response = model.generate_content(prompt)
        return response.text.strip()
    except:
        return f"⚽ {title}\n\n#Football"

def get_hd_image(article_url):
    """ 
    Visits the article URL to find the High-Res 'og:image' 
    This fixes the 'blurry image' issue.
    """
    try:
        # User-Agent makes us look like a real browser (Chrome) so we don't get blocked
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
        response = requests.get(article_url, headers=headers, timeout=10)
        soup = BeautifulSoup(response.content, 'html.parser')
        
        # Look for the Open Graph image tag
        og_image = soup.find("meta", property="og:image")
        
        if og_image and og_image.get("content"):
            return og_image["content"]
            
    except Exception as e:
        print(f"Failed to fetch HD image: {e}")
    
    return None

def extract_backup_image(entry):
    """ Fallback: If scraping fails, use the blurry RSS image """
    if 'media_content' in entry:
        return entry.media_content[0]['url']
    if 'media_thumbnail' in entry:
        return entry.media_thumbnail[0]['url']
    if 'enclosures' in entry:
        for enc in entry.enclosures:
            if 'image' in enc.type:
                return enc.href
    return None

def load_history():
    if os.path.exists(HISTORY_FILE):
        with open(HISTORY_FILE, 'r') as f:
            return json.load(f)
    return []

def save_history(history):
    with open(HISTORY_FILE, 'w') as f:
        json.dump(history[-100:], f)

def main():
    print("--- Starting HD Football Bot ---")
    fb_token, page_id = setup_env()
    graph = facebook.GraphAPI(fb_token)
    history = load_history()
    
    random.shuffle(RSS_FEEDS)
    posted = False

    for url in RSS_FEEDS:
        if posted: break
        print(f"Checking {url}...")
        
        try:
            feed = feedparser.parse(url)
            for entry in feed.entries:
                link = entry.link
                title = entry.title
                
                if link in history: continue
                if any(bad in title.lower() for bad in BLACKLIST): continue

                print(f"Analyzing: {title}")

                # 1. Try to get HD Image from the website
                img_url = get_hd_image(link)
                
                # 2. If HD failed, fall back to RSS image
                if not img_url:
                    print("HD fetch failed, checking RSS for backup...")
                    img_url = extract_backup_image(entry)
                
                # 3. If still no image, skip this article
                if not img_url: 
                    print("No image found. Skipping.")
                    continue

                print(f"Found Image: {img_url}")

                # 4. Generate Text
                description = entry.get('summary', title)
                ai_caption = get_ai_rewrite(title, description)

                # 5. Post
                # Download image data
                # Need headers for download too, or some sites block the image download
                headers = {'User-Agent': 'Mozilla/5.0'} 
                img_data = requests.get(img_url, headers=headers).content
                
                graph.put_photo(image=img_data, message=ai_caption)
                print("Posted successfully!")
                
                history.append(link)
                save_history(history)
                posted = True
                break 
                
        except Exception as e:
            print(f"Error processing feed {url}: {e}")

if __name__ == "__main__":
    main()
