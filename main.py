import feedparser
import facebook
import os
import requests

# --- CONFIGURATION ---
# RSS Feed URL (Sky Sports Football is reliable for images/titles)
RSS_URL = "https://www.skysports.com/rss/12040"

# File to store the ID of the last posted article
ID_FILE = "last_id.txt"

def get_access_token():
    # We retrieve keys from GitHub Secrets
    token = os.environ.get("FB_PAGE_ACCESS_TOKEN")
    page_id = os.environ.get("FB_PAGE_ID")
    if not token or not page_id:
        raise Exception("Error: FB_PAGE_ACCESS_TOKEN or FB_PAGE_ID not found in environment variables.")
    return token, page_id

def get_last_posted_id():
    if not os.path.exists(ID_FILE):
        return None
    with open(ID_FILE, "r") as f:
        return f.read().strip()

def save_last_posted_id(new_id):
    with open(ID_FILE, "w") as f:
        f.write(new_id)

def main():
    print("--- Starting Football News Bot ---")
    
    # 1. Parse the RSS Feed
    feed = feedparser.parse(RSS_URL)
    if not feed.entries:
        print("No entries found in RSS feed.")
        return

    # Get the latest news item
    latest_item = feed.entries[0]
    
    # Unique ID for the article (usually the link or a guid)
    article_id = latest_item.guid if 'guid' in latest_item else latest_item.link
    
    # 2. Check if already posted
    last_id = get_last_posted_id()
    if article_id == last_id:
        print("Latest article already posted. Skipping.")
        return

    print(f"New article found: {latest_item.title}")

    # 3. Connect to Facebook
    token, page_id = get_access_token()
    graph = facebook.GraphAPI(token)

    # 4. Prepare Post Data
    title = latest_item.title
    link = latest_item.link
    message = f"⚽ {title}\n\nRead more here: {link}\n\n#FootballNews #SkySports"

    # 5. Extract Image URL (RSS feeds vary, this covers most standard ones)
    image_url = None
    
    # Check standard media_content tag (SkySports/ESPN uses this)
    if 'media_content' in latest_item:
        image_url = latest_item.media_content[0]['url']
    # Check enclosures (BBC sometimes uses this)
    elif 'media_thumbnail' in latest_item:
        image_url = latest_item.media_thumbnail[0]['url']
    # Fallback: Check links for image type
    elif 'links' in latest_item:
        for l in latest_item.links:
            if 'image' in l.get('type', ''):
                image_url = l['href']
                break

    # 6. Post to Facebook
    try:
        if image_url:
            print(f"Posting with image: {image_url}")
            # Download image to memory to upload
            img_data = requests.get(image_url).content
            graph.put_photo(image=img_data, message=message)
        else:
            print("No image found, posting as link.")
            # If no image found, post the link (FB will generate the preview)
            graph.put_object(
                parent_object=page_id, 
                connection_name='feed', 
                message=message, 
                link=link
            )
            
        print("Successfully posted to Facebook!")
        
        # 7. Update the ID file
        save_last_posted_id(article_id)

    except Exception as e:
        print(f"Error posting to Facebook: {e}")

if __name__ == "__main__":
    main()
