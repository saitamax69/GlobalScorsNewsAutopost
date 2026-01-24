import feedparser
import facebook
import os
import requests
import json
import google.generativeai as genai
import time
import random
from bs4 import BeautifulSoup

# --- CONFIGURATION ---

# 1. YOUR TELEGRAM LINK (Inserted Here)
TELEGRAM_LINK = "https://t.me/+9uDCOJXm_R1hMzM0"

# 2. CLEAN DATA SOURCES (Sky, TalkSport, Metro, Express - No ESPN/BBC)
RSS_FEEDS = [
    "https://www.skysports.com/rss/12040",           # Sky Sports (Best Images)
    "https://talksport.com/football/feed/",          # TalkSport (Viral News)
    "https://www.90min.com/posts.rss",               # 90min (Fan Culture)
    "https://metro.co.uk/sport/football/feed/",      # Metro (Transfers)
    "https://www.express.co.uk/posts/rss/78/football" # Express (Rumors)
]

# 3. VIP KEYWORDS (Post these immediately)
ALWAYS_POST_TEAMS = [
    "man utd", "manchester united", "liverpool", "arsenal", "chelsea", "man city", 
    "tottenham", "newcastle", "real madrid", "barcelona", "bayern", "juventus", 
    "mbappe", "haaland", "bellingham", "salah", "yamal", "vinicius",
    "transfers", "here we go", "official", "confirmed", "agreement"
]

# 4. BLACKLIST (Filter out junk & Women's football)
BLACKLIST_KEYWORDS = [
    "podcast", "how to watch", "live stream", "betting", "odds", "quiz", "fantasy", 
    "women", "women's", "wsl", "lionesses", "ladies", "netball", "cricket", "rugby"
]

HISTORY_FILE = "history.json"

def setup_env():
    fb_token = os.environ.get("FB_PAGE_ACCESS_TOKEN")
    page_id = os.environ.get("FB_PAGE_ID")
    gemini_key = os.environ.get("GEMINI_API_KEY")
    if not all([fb_token, page_id, gemini_key]):
        raise Exception("Missing Environment Variables. Check GitHub Secrets.")
    genai.configure(api_key=gemini_key)
    return fb_token, page_id

def collect_and_sort_news():
    """ Gather all news and sort by Newest First """
    all_articles = []
    print("--- Gathering News from Sources ---")

    for url in RSS_FEEDS:
        try:
            feed = feedparser.parse(url)
            for entry in feed.entries:
                # Get time or default to 0
                published_time = entry.get('published_parsed', entry.get('updated_parsed'))
                timestamp = time.mktime(published_time) if published_time else 0 

                article = {
                    "title": entry.title,
                    "link": entry.link,
                    "summary": entry.get('summary', ''),
                    "timestamp": timestamp,
                    "raw_entry": entry
                }
                all_articles.append(article)
        except:
            print(f"Skipping feed: {url}")

    # Sort: Newest is Index 0
    return sorted(all_articles, key=lambda x: x['timestamp'], reverse=True)

def is_top_tier(title):
    title_lower = title.lower()
    
    # Check VIP
    for vip in ALWAYS_POST_TEAMS:
        if vip in title_lower:
            print(f"-> HOT NEWS DETECTED: {vip}")
            return True
            
    # Check Blacklist
    if any(bad in title_lower for bad in BLACKLIST_KEYWORDS):
        return False

    # Ask AI to filter "boring" news
    try:
        model = genai.GenerativeModel('gemini-pro')
        prompt = (
            f"Is this news headline interesting enough for a global football audience? "
            f"Headline: '{title}'. "
            f"Reply 'YES' if it is about Big Teams (Premier League, La Liga, UCL), Transfers, or Big Drama. "
            f"Reply 'NO' if it is boring, lower league, or irrelevant."
        )
        response = model.generate_content(prompt)
        return "YES" in response.text.strip().upper()
    except:
        return False

def get_fabrizio_rewrite(title, description):
    """ 
    The 'Fabrizio Romano' + Affiliate Persona 
    """
    try:
        model = genai.GenerativeModel('gemini-pro')
        
        # Randomize the question to keep engagement high
        question_styles = [
            "Do you agree with this decision?",
            "Is this the right move?",
            "Rate this news 1-10! 👇",
            "What is your opinion on this?",
            "Will this change the season?"
        ]
        q_style = random.choice(question_styles)

        prompt = (
            f"Act as the famous insider Fabrizio Romano managing the Facebook page 'Global Score Updates'. "
            f"News: '{title}'. Details: '{description}'. "
            f"Write a professional, hype, and engaging post (approx 80 words). "
            f"Structure: "
            f"1. Start with a Hook (e.g., 🚨 HERE WE GO, 🚨 EXCLUSIVE, 🔴 OFFICIAL). "
            f"2. Explain the news clearly using football insider terms. "
            f"3. Ask the fans: '{q_style}'. "
            f"4. END WITH THIS EXACT CALL TO ACTION: '🔥 Want 100% fixed predictions and free tips? Join our VIP Channel now! 👇 {TELEGRAM_LINK}' "
            f"Use emojis like 🚨, ⚽, 📝, ✅. Do NOT mention the original source name."
        )
        
        response = model.generate_content(prompt)
        return response.text.strip()
    except Exception as e:
        print(f"AI Error: {e}")
        # Fallback
        return f"🚨 BREAKING: {title}\n\nJoin for Free Tips: {TELEGRAM_LINK}\n#Football"

def get_hd_image(article_url):
    try:
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
        response = requests.get(article_url, headers=headers, timeout=10)
        soup = BeautifulSoup(response.content, 'html.parser')
        og_image = soup.find("meta", property="og:image")
        
        if og_image and og_image.get("content"):
            img_url = og_image["content"]
            # Filter out placeholders
            if "placeholder" in img_url or "default" in img_url:
                return None
            return img_url
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
    
    # 1. Get Sorted News (Newest First)
    articles = collect_and_sort_news()
    
    posted = False

    for article in articles:
        if posted: break
        
        title = article['title']
        link = article['link']
        
        if link in history: continue

        print(f"\nChecking: {title}")
        
        # Filter Logic
        if not is_top_tier(title):
            print("-> Skipped (Not Top Tier)")
            continue

        print("-> SELECTED! Generating Content...")

        # Get Image
        img_url = get_hd_image(link)
        if not img_url:
            img_url = extract_backup_image(article['raw_entry'])
        
        if not img_url:
            print("-> No image found. Skipping.")
            continue

        # Generate Text
        ai_caption = get_fabrizio_rewrite(title, article['summary'])
        print(f"-> Posting to Global Score Updates...")

        # Post to Facebook
        try:
            headers = {'User-Agent': 'Mozilla/5.0'} 
            img_data = requests.get(img_url, headers=headers).content
            graph.put_photo(image=img_data, message=ai_caption)
            
            print(f"SUCCESS! Posted.")
            history.append(link)
            save_history(history)
            posted = True
            
        except Exception as e:
            print(f"FB Upload Error: {e}")

if __name__ == "__main__":
    main()
