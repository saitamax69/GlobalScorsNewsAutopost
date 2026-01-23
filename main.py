import feedparser
import facebook
import os
import requests
import json
import google.generativeai as genai
import random
from bs4 import BeautifulSoup

# --- CONFIGURATION ---
RSS_FEEDS = [
    "https://www.skysports.com/rss/12040",          # Sky Sports
    "https://www.espn.com/espn/rss/soccer/news",    # ESPN
    "http://feeds.bbci.co.uk/sport/football/rss.xml", # BBC
    "https://www.90min.com/posts.rss"               # 90min
]

# Even though we use AI, this blacklist helps save time on obvious junk
BLACKLIST_KEYWORDS = [
    "podcast", "betting", "odds", "preview", "prediction", "quiz", 
    "fantasy", "how to watch", "live stream", "women's super league", # Remove if you want women's football
    "u21", "u18", "championship", "league one", "league two" # Lower leagues
]

HISTORY_FILE = "history.json"

def setup_env():
    fb_token = os.environ.get("FB_PAGE_ACCESS_TOKEN")
    page_id = os.environ.get("FB_PAGE_ID")
    gemini_key = os.environ.get("GEMINI_API_KEY")

    if not all([fb_token, page_id, gemini_key]):
        raise Exception("Missing Keys. Check GitHub Secrets.")
    
    genai.configure(api_key=gemini_key)
    return fb_token, page_id

def is_top_tier(title):
    """
    Asks AI: Is this news about the top leagues/cups?
    Returns: True or False
    """
    try:
        model = genai.GenerativeModel('gemini-pro')
        prompt = (
            f"Analyze this football headline: '{title}'. "
            f"Reply with 'YES' strictly and only if the news is about: "
            f"Premier League, La Liga, Bundesliga, Serie A, Ligue 1, "
            f"Champions League, Europa League, World Cup, Euros, Copa America, "
            f"or Major International Teams (England, Brazil, France, Argentina, etc). "
            f"If it is about lower leagues, minor cups, or gossip, reply 'NO'."
        )
        response = model.generate_content(prompt)
        answer = response.text.strip().upper()
        
        # If AI says YES, it's good news.
        return "YES" in answer
    except:
        # If AI fails, we default to True to be safe, or False to be strict.
        # Let's default False to avoid spam.
        return False

def get_ai_rewrite(title, description):
    """ Rewrites the post to be engaging """
    try:
        model = genai.GenerativeModel('gemini-pro')
        prompt = (
            f"Act as a football journalist. Headline: '{title}'. "
            f"Context: '{description}'. "
            f"Write a viral Facebook post (max 2 short sentences). "
            f"Use emojis. Add 3 hashtags. "
            f"Do not mention the source link."
        )
        response = model.generate_content(prompt)
        return response.text.strip()
    except:
        return f"⚽ {title}\n\n#Football"

def get_hd_image(article_url):
    """ Scrapes the HD Og:Image """
    try:
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0'}
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
    print("--- Starting Top-Tier Football Bot ---")
    fb_token, page_id = setup_env()
    graph = facebook.GraphAPI(fb_token)
    history = load_history()
    
    random.shuffle(RSS_FEEDS)
    posted = False

    for url in RSS_FEEDS:
        if posted: break
        print(f"Checking feed: {url}...")
        
        try:
            feed = feedparser.parse(url)
            for entry in feed.entries:
                link = entry.link
                title = entry.title
                
                # 1. Check History
                if link in history: continue
                
                # 2. Check Blacklist (Fast filter)
                if any(bad in title.lower() for bad in BLACKLIST_KEYWORDS): 
                    continue

                print(f"Analyzing title: {title}")

                # 3. AI FILTER (The Gatekeeper)
                # We ask Gemini if this is top tier news
                if not is_top_tier(title):
                    print("-> AI said: Not top tier. Skipping.")
                    continue
                
                print("-> AI said: TOP TIER! Processing...")

                # 4. Get Images
                img_url = get_hd_image(link)
                if not img_url:
                    img_url = extract_backup_image(entry)
                
                if not img_url: continue # No image, no post

                # 5. Generate Content
                description = entry.get('summary', title)
                ai_caption = get_ai_rewrite(title, description)

                # 6. Post
                headers = {'User-Agent': 'Mozilla/5.0'} 
                img_data = requests.get(img_url, headers=headers).content
                graph.put_photo(image=img_data, message=ai_caption)
                
                print("Successfully Posted!")
                history.append(link)
                save_history(history)
                posted = True
                break 
                
        except Exception as e:
            print(f"Error: {e}")

if __name__ == "__main__":
    main()
