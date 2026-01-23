import feedparser
import facebook
import os
import requests
import json
import google.generativeai as genai
import time
from datetime import datetime
from bs4 import BeautifulSoup

# --- CONFIGURATION ---
RSS_FEEDS = [
    "https://www.skysports.com/rss/12040",          # Sky Sports
    "https://www.espn.com/espn/rss/soccer/news",    # ESPN
    "http://feeds.bbci.co.uk/sport/football/rss.xml", # BBC
    "https://www.90min.com/posts.rss"               # 90min
]

# VIP LIST: If title contains these, it is "Hot" news.
ALWAYS_POST_TEAMS = [
    "man utd", "manchester united", "liverpool", "arsenal", "chelsea", "man city", 
    "tottenham", "spurs", "newcastle", "aston villa",
    "real madrid", "barcelona", "bayern", "juventus", "psg", "inter milan",
    "messi", "ronaldo", "mbappe", "haaland", "bellingham", "kane", "salah", "yamal",
    "breaking", "official", "confirmed", "agreement reached", "here we go"
]

# JUNK LIST
BLACKLIST_KEYWORDS = [
    "podcast", "how to watch", "live stream", "betting", "odds", "quiz", 
    "fantasy", "prediction", "women's super league", "u21", "u18", 
    "league one", "league two", "championship"
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

def collect_and_sort_news():
    """
    1. Fetches ALL feeds.
    2. Merges them into one list.
    3. Sorts by DATE (Newest first).
    """
    all_articles = []
    print("--- Gathering News from All Sources ---")

    for url in RSS_FEEDS:
        try:
            feed = feedparser.parse(url)
            for entry in feed.entries:
                # Get the timestamp. If missing, use current time (safeguard)
                published_time = entry.get('published_parsed', entry.get('updated_parsed'))
                
                # Convert struct_time to a sortable timestamp
                if published_time:
                    timestamp = time.mktime(published_time)
                else:
                    timestamp = 0 

                article = {
                    "title": entry.title,
                    "link": entry.link,
                    "summary": entry.get('summary', ''),
                    "timestamp": timestamp,
                    "raw_entry": entry, # Keep original data for image extraction
                    "source": feed.feed.get('title', 'Unknown')
                }
                all_articles.append(article)
        except Exception as e:
            print(f"Error fetching {url}: {e}")

    # SORTING MAGIC: Sort by timestamp, descending (Newest first)
    sorted_articles = sorted(all_articles, key=lambda x: x['timestamp'], reverse=True)
    
    print(f"Collected {len(sorted_articles)} articles. Sorting by newest...")
    return sorted_articles

def is_top_tier(title):
    title_lower = title.lower()

    # 1. VIP Check (Fast)
    for vip in ALWAYS_POST_TEAMS:
        if vip in title_lower:
            print(f"-> HOT TOPIC DETECTED: {vip}")
            return True

    # 2. AI Check (Slower but smart)
    print("-> Checking relevance with AI...")
    try:
        model = genai.GenerativeModel('gemini-pro')
        prompt = (
            f"Is this headline about a major football team or player? "
            f"Headline: '{title}'. "
            f"Reply 'YES' only for Top 5 Leagues, UCL, or Major International Teams. "
            f"Reply 'NO' for lower leagues, rumors from unreliable sources, or boring match previews."
        )
        response = model.generate_content(prompt)
        answer = response.text.strip().upper()
        return "YES" in answer
    except:
        return False

def get_ai_rewrite(title, description):
    try:
        model = genai.GenerativeModel('gemini-pro')
        prompt = (
            f"Act as a viral sports news page. Headline: '{title}'. "
            f"Write a very short, exciting Facebook caption. "
            f"Include emojis. Add 3 hashtags. No links."
        )
        response = model.generate_content(prompt)
        return response.text.strip()
    except:
        return f"🚨 {title}\n\n#FootballNews"

def get_hd_image(article_url):
    try:
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
        response = requests.get(article_url, headers=headers, timeout=10)
        soup = BeautifulSoup(response.content, 'html.parser')
        og_image = soup.find("meta", property="og:image")
        if og_image and og_image.get("content"):
            return og_image["content"]
    except:
        pass
    return None

def extract_backup_image(entry):
    if 'media_content' in entry: return entry.media_content[0]['url']
    if 'media_thumbnail' in entry: return entry.media_thumbnail[0]['url']
    if 'enclosures' in entry:
        for enc in entry.enclosures:
            if 'image' in enc.type: return enc.href
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
    fb_token, page_id = setup_env()
    graph = facebook.GraphAPI(fb_token)
    history = load_history()
    
    # 1. GET ALL NEWS SORTED BY TIME
    articles = collect_and_sort_news()
    
    posted = False

    # 2. Iterate from Newest -> Oldest
    for article in articles:
        if posted: break
        
        title = article['title']
        link = article['link']
        
        # SKIP LOGIC
        if link in history: continue
        if any(bad in title.lower() for bad in BLACKLIST_KEYWORDS): continue

        print(f"\nEvaluating: {title}")
        
        # 3. APPLY FILTER
        if not is_top_tier(title):
            print("-> Skipped (Not Top Tier)")
            continue

        print("-> SELECTED! Fetching image...")

        # 4. GET IMAGE
        img_url = get_hd_image(link)
        if not img_url:
            img_url = extract_backup_image(article['raw_entry'])
        
        if not img_url:
            print("-> No image found. Skipping.")
            continue

        # 5. GENERATE & POST
        ai_caption = get_ai_rewrite(title, article['summary'])
        
        try:
            headers = {'User-Agent': 'Mozilla/5.0'} 
            img_data = requests.get(img_url, headers=headers).content
            graph.put_photo(image=img_data, message=ai_caption)
            
            print(f"SUCCESS! Posted: {title}")
            history.append(link)
            save_history(history)
            posted = True
            
        except Exception as e:
            print(f"FB Upload Error: {e}")

if __name__ == "__main__":
    main()
