import feedparser
import facebook
import os
import requests
import json
import google.generativeai as genai
import random

# --- CONFIGURATION ---
RSS_FEEDS = [
    "https://www.skysports.com/rss/12040",          # Sky Sports Football
    "https://www.espn.com/espn/rss/soccer/news",    # ESPN Soccer
    "http://feeds.bbci.co.uk/sport/football/rss.xml", # BBC Football
    "https://www.90min.com/posts.rss"               # 90min
]

# Words to ignore. If the title has these, we skip it.
BLACKLIST = [
    "podcast", "live stream", "how to watch", "betting", "odds", 
    "sky sports", "subscribe", "fantasy", "quiz", "preview", "prediction"
]

HISTORY_FILE = "history.json"

def setup_env():
    # Load keys
    fb_token = os.environ.get("FB_PAGE_ACCESS_TOKEN")
    page_id = os.environ.get("FB_PAGE_ID")
    gemini_key = os.environ.get("GEMINI_API_KEY")

    if not all([fb_token, page_id, gemini_key]):
        raise Exception("Missing Environment Variables (FB or GEMINI).")
    
    # Configure AI
    genai.configure(api_key=gemini_key)
    return fb_token, page_id

def get_ai_rewrite(title, description):
    """ Sends the news to Google Gemini to rewrite nicely """
    try:
        model = genai.GenerativeModel('gemini-pro')
        
        prompt = (
            f"Act as a professional football social media manager. "
            f"Here is a news headline: '{title}'. "
            f"Here is the summary: '{description}'. "
            f"Write a short, engaging Facebook post about this news. "
            f"Use emojis. Add 3 relevant hashtags. "
            f"Do NOT mention the source (like Sky or ESPN). "
            f"Do NOT include 'Read more' links. Just the text."
        )
        
        response = model.generate_content(prompt)
        return response.text.strip()
    except Exception as e:
        print(f"AI Error: {e}")
        # Fallback if AI fails: just use the title
        return f"⚽ {title}\n\n#Football"

def extract_image(entry):
    """ extract image from RSS """
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
    # Keep only last 100
    with open(HISTORY_FILE, 'w') as f:
        json.dump(history[-100:], f)

def main():
    print("--- Starting AI Football Bot ---")
    fb_token, page_id = setup_env()
    graph = facebook.GraphAPI(fb_token)
    history = load_history()

    # Shuffle feeds so we don't always post from Sky first
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
                
                # Filter Logic
                if link in history: continue
                if any(bad in title.lower() for bad in BLACKLIST): 
                    print(f"Skipped Junk: {title}")
                    continue
                
                img_url = extract_image(entry)
                if not img_url: continue # We only want posts with images

                print(f"Found new article: {title}")

                # --- AI MAGIC HAPPENS HERE ---
                description = entry.get('summary', title)
                ai_caption = get_ai_rewrite(title, description)
                print(f"AI Generated: {ai_caption}")

                # --- POST TO FACEBOOK ---
                # 1. Download Image
                img_data = requests.get(img_url).content
                
                # 2. Upload to FB
                graph.put_photo(image=img_data, message=ai_caption)
                
                print("Posted successfully!")
                
                # 3. Save to History
                history.append(link)
                save_history(history)
                posted = True
                break # Stop processing entries
                
        except Exception as e:
            print(f"Error with feed {url}: {e}")

if __name__ == "__main__":
    main()
