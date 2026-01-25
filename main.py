#!/usr/bin/env python3
"""
Football Data Automation Bot - SYNDICATE EDITION V4
Features:
1. HTML Hyperlinks (No ugly URLs)
2. Strict Future-Only Filter (No started/finished games)
3. Dual Predictions
"""

import os
import sys
import json
import requests
from datetime import datetime, timedelta
from typing import Optional, Dict, List
import pytz
import logging
import hashlib

# =============================================================================
# CONFIGURATION
# =============================================================================

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(message)s')
logger = logging.getLogger(__name__)

GMT = pytz.timezone('GMT')
API_REQUESTS_THIS_RUN = 0
MAX_API_CALLS_PER_RUN = 1

# Affiliate Links (HTML Format will be applied later)
AFFILIATE_LINKS = {
    "🎰 Stake": "https://stake.com/?c=GlobalScoreUpdates",
    "📊 Linebet": "https://linebet.com?bf=695d695c66d7a_13053616523",
    "🏆 1xBet": "https://ma-1xbet.com?bf=695d66e22c1b5_7531017325"
}

TELEGRAM_CHANNEL_LINK = "https://t.me/+xAQ3DCVJa8A2ZmY8"

RAPIDAPI_HOST = "livescore6.p.rapidapi.com"
RAPIDAPI_BASE_URL = f"https://{RAPIDAPI_HOST}"

# League Profiles
LEAGUE_PROFILES = {
    "HIGH_SCORING": ["Bundesliga", "Eredivisie", "MLS", "Saudi", "Jupiler", "Allsvenskan"],
    "DEFENSIVE": ["Serie A", "Ligue 1", "Segunda", "Brasileiro", "Argentina", "Greece"],
    "BALANCED": ["Premier League", "La Liga", "Championship", "Champions League", "Europa"]
}

MAJOR_COMPETITIONS = [
    "Premier League", "La Liga", "Serie A", "Bundesliga", "Ligue 1",
    "Champions League", "Europa", "Conference", "World Cup", "Euro",
    "FA Cup", "Copa", "Eredivisie", "Primeira", "Saudi", "MLS", 
    "Championship", "League One", "Super Lig"
]

POWERHOUSE_TEAMS = [
    "Man City", "Liverpool", "Arsenal", "Real Madrid", "Barcelona",
    "Bayern", "Leverkusen", "Inter", "Juve", "Milan", "PSG",
    "Benfica", "Porto", "Al Hilal", "Al Nassr", "Chelsea"
]

# =============================================================================
# 🎨 PREMIUM TYPOGRAPHY
# =============================================================================

class TextStyler:
    @staticmethod
    def to_bold_sans(text):
        """Converts text to Unicode Bold Sans-Serif"""
        normal = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
        mapped = "".join([chr(0x1D5D4 + i) for i in range(26)]) + \
                 "".join([chr(0x1D5EE + i) for i in range(26)]) + \
                 "".join([chr(0x1D7EC + i) for i in range(10)])
        return text.translate(str.maketrans(normal, mapped))

    @staticmethod
    def to_mono(text):
        """Converts text to Unicode Monospace"""
        normal = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
        mapped = "".join([chr(0x1D670 + i) for i in range(26)]) + \
                 "".join([chr(0x1D68A + i) for i in range(26)]) + \
                 "".join([chr(0x1D7F6 + i) for i in range(10)])
        return text.translate(str.maketrans(normal, mapped))

# =============================================================================
# INSIGHT DICTIONARY
# =============================================================================

class Insights:
    DOMINANT_HOME = [
        "Home side xG metrics trending 20% above league avg.",
        "Visitors struggle against high-press systems away.",
        "Host defense has conceded zero open-play goals in last 3.",
    ]
    GOALS_EXPECTED = [
        "Both sides ranking top 5 for shots on target created.",
        "Defensive injury crisis creating massive value on Over.",
        "Historical H2H indicates an open, end-to-end game.",
        "Both teams averaging over 2.5 goals per match recently."
    ]
    TIGHT_MATCH = [
        "Midfield congestion expected to limit chances.",
        "Both managers prioritize defensive structure.",
        "Late season pressure suggests a cautious approach."
    ]
    UNDERDOG_VALUE = [
        "Market overreacting to home side's brand name.",
        "Visitors have best counter-attacking stats in the league.",
        "Home side resting key players for upcoming cup fixture."
    ]

# =============================================================================
# API CLIENT (STRICT FUTURE FILTER)
# =============================================================================

class FootballAPI:
    def __init__(self, api_key: str):
        self.session = requests.Session()
        self.session.headers.update({"X-RapidAPI-Key": api_key, "X-RapidAPI-Host": RAPIDAPI_HOST})
        self.request_count = 0

    def get_matches(self):
        global API_REQUESTS_THIS_RUN
        if self.request_count >= MAX_API_CALLS_PER_RUN: return []
        
        date_str = datetime.now(GMT).strftime("%Y%m%d")
        try:
            url = f"{RAPIDAPI_BASE_URL}/matches/v2/list-by-date"
            resp = self.session.get(url, params={"Category": "soccer", "Date": date_str, "Timezone": "0"}, timeout=30)
            self.request_count += 1
            API_REQUESTS_THIS_RUN += 1
            resp.raise_for_status()
            return self._parse(resp.json().get('Stages', []))
        except Exception as e:
            logger.error(f"API Error: {e}")
            return []

    def _parse(self, stages):
        matches = []
        now = datetime.now(GMT)
        
        for stage in stages:
            comp = stage.get('Snm', stage.get('Cnm', 'Unknown'))
            is_major = any(m.lower() in comp.lower() for m in MAJOR_COMPETITIONS)
            
            for evt in stage.get('Events', []):
                # 1. Parse Time Object
                start_str = str(evt.get('Esd', ''))
                match_dt = None
                
                try:
                    if len(start_str) >= 12:
                        match_dt = datetime.strptime(start_str[:14], "%Y%m%d%H%M%S")
                        match_dt = GMT.localize(match_dt)
                except:
                    continue # Skip if no valid time

                # 2. STRICT FILTER: Is the match in the past?
                # If match start time is less than NOW, skip it.
                if match_dt <= now:
                    continue

                # 3. Exclude weird statuses just in case
                status = evt.get('Eps', 'NS')
                if status in ['FT', 'AET', 'PEN', 'Canc', 'Abd', 'Post', 'LIVE', 'HT', '1H', '2H']:
                    continue # We only want PURE UPCOMING games

                t1 = evt.get('T1', [{}])[0]
                t2 = evt.get('T2', [{}])[0]
                
                r1 = int(t1.get('Rnk', 50)) if str(t1.get('Rnk', '')).isdigit() else 50
                r2 = int(t2.get('Rnk', 50)) if str(t2.get('Rnk', '')).isdigit() else 50
                
                match = {
                    'competition': comp,
                    'home': t1.get('Nm', 'Unknown'),
                    'away': t2.get('Nm', 'Unknown'),
                    'home_rank': r1,
                    'away_rank': r2,
                    'start_time': match_dt.strftime("%H:%M"), # Just the time string
                    'is_major': is_major,
                    'priority': 1 if is_major else 2
                }
                matches.append(match)
        
        # Sort by Major First, then Time
        matches.sort(key=lambda x: (x['priority'], x['start_time']))
        return matches

# =============================================================================
# LOGIC ENGINE
# =============================================================================

class LogicEngine:
    @staticmethod
    def analyze(match):
        h, a = match['home'], match['away']
        comp = match['competition']
        
        style = "BALANCED"
        for k, v in LEAGUE_PROFILES.items():
            if any(l in comp for l in v): style = k; break
        
        h_pow = any(p in h for p in POWERHOUSE_TEAMS)
        a_pow = any(p in a for p in POWERHOUSE_TEAMS)
        match_hash = int(hashlib.md5(f"{h}{a}".encode()).hexdigest(), 16)

        if h_pow and not a_pow:
            insight = Insights.DOMINANT_HOME[match_hash % len(Insights.DOMINANT_HOME)]
            return {"edge": "📉 𝙼𝚊𝚛𝚔𝚎𝚝 𝙳𝚛𝚒𝚏𝚝: Sharp Action Home", "insight": insight, "main": f"{h} -1.0 AH", "alt": f"{h} to Win & Over 1.5"}

        if a_pow and not h_pow:
            insight = Insights.UNDERDOG_VALUE[match_hash % len(Insights.UNDERDOG_VALUE)]
            return {"edge": "📉 𝙼𝚊𝚛𝚔𝚎𝚝 𝙳𝚛𝚒𝚏𝚝: Visitors undervalued", "insight": "Class disparity favors the visitors.", "main": f"{a} to Win", "alt": "Over 1.5 Goals"}
        
        if style == "HIGH_SCORING":
            insight = Insights.GOALS_EXPECTED[match_hash % len(Insights.GOALS_EXPECTED)]
            if match_hash % 2 == 0:
                return {"edge": "🔥 𝚅𝚘𝚕𝚊𝚝𝚒𝚕𝚒𝚝𝚢 𝙰𝚕𝚎𝚛𝚝", "insight": insight, "main": "Over 2.5 Goals", "alt": "Both Teams to Score"}
            else:
                return {"edge": "🔥 𝙾𝚙𝚎𝚗 𝙶𝚊𝚖𝚎 𝚂𝚌𝚛𝚒𝚙𝚝", "insight": insight, "main": "Both Teams to Score & Over 2.5", "alt": "Over 1.5 1st Half"}

        if style == "DEFENSIVE":
            insight = Insights.TIGHT_MATCH[match_hash % len(Insights.TIGHT_MATCH)]
            return {"edge": "⚖️ 𝚃𝚊𝚌𝚝𝚒𝚌𝚊𝚕 𝚂𝚝𝚊𝚗𝚍𝚘𝚏𝚏", "insight": insight, "main": "Under 3.5 Goals", "alt": "Draw at Halftime"}

        # Balanced
        seed = len(h) + len(a)
        if seed % 3 == 0:
            return {"edge": "📈 𝙵𝚘𝚛𝚖 𝙼𝚘𝚖𝚎𝚗𝚝𝚞𝚖", "insight": "Both teams scoring consistently.", "main": "Both Teams to Score", "alt": "Over 2.5 Goals"}
        elif seed % 3 == 1:
            return {"edge": "🛡️ 𝚂𝚊𝚏𝚎𝚝𝚢 𝙵𝚒𝚛𝚜𝚝", "insight": "Home advantage is key.", "main": f"{h} Win or Draw", "alt": f"{h} Draw No Bet"}
        else:
            return {"edge": "🔥 𝙾𝚙𝚎𝚗 𝙶𝚊𝚖𝚎", "insight": "Weak transition defense.", "main": "Over 2.0 Goal Line", "alt": "Goal in Both Halves"}

# =============================================================================
# CONTENT GENERATOR (HTML LINKS)
# =============================================================================

class ContentGenerator:
    @staticmethod
    def telegram_feed(matches):
        now_str = datetime.now(GMT).strftime("%d %b")
        title = TextStyler.to_bold_sans("SYNDICATE INTELLIGENCE")
        subtitle = TextStyler.to_mono(f"Daily Briefing | {now_str}")
        
        msg = f"💎 {title}\n{subtitle}\n\n"
        
        selected = matches[:5]
        
        if not selected:
            return f"💎 {title}\n\nNo market opportunities detected for the rest of the day.\nSystem standby."

        for m in selected:
            data = LogicEngine.analyze(m)
            comp = TextStyler.to_bold_sans(m['competition'].upper())
            teams = f"{m['home']} vs {m['away']}"
            time = m['start_time']
            
            msg += f"┌── {comp} ──────────\n"
            msg += f"│ ⚔️ {teams}\n"
            msg += f"│ ⏰ {time} GMT\n"
            msg += f"│\n"
            msg += f"│ {data['edge']}\n"
            msg += f"│ 🧠 {data['insight']}\n"
            msg += f"│\n"
            msg += f"│ 🎯 𝗠𝗔𝗜𝗡: {TextStyler.to_bold_sans(data['main'])}\n"
            msg += f"└─ 🛡️ 𝗔𝗟𝗧:  {data['alt']}\n\n"

        msg += "────── 🔒 𝗣𝗥𝗘𝗠𝗜𝗨𝗠 𝗔𝗖𝗖𝗘𝗦𝗦 ──────\n"
        msg += "Maximize your edge with our partners:\n\n"
        
        # HTML HYPERLINKS GENERATION
        for name, link in AFFILIATE_LINKS.items():
            # Clean name for display (remove emoji for the link text to keep it clean, add emoji before)
            # <a href="URL">TEXT</a>
            clean_name = name.split(" ")[1] if " " in name else name
            emoji = name.split(" ")[0] if " " in name else "👉"
            
            # This creates: 👉 [Stake](link) using HTML
            msg += f"👉 <b><a href=\"{link}\">{name}</a></b>\n"
            
        return msg

    @staticmethod
    def facebook_teaser(matches):
        if not matches: return "Market Analysis pending..."
        h, a = matches[0]['home'], matches[0]['away']
        header = TextStyler.to_bold_sans("SMART MONEY MOVE")
        teams = TextStyler.to_bold_sans(f"{h} vs {a}")
        
        return f"""💎 {header}
        
We have detected a significant liquidity spike in today's fixture:

⚽ {teams}

📉 𝗠𝗮𝗿𝗸𝗲𝘁 𝗔𝗻𝗮𝗹𝘆𝘀𝗶𝘀:
The sharps are moving heavily on one side. The public is on the other. 

Don't be on the wrong side of the variance.

👇 𝗦𝗘𝗘 𝗧𝗛𝗘 𝗢𝗙𝗙𝗜𝗖𝗜𝗔𝗟 𝗣𝗜𝗖𝗞 𝗛𝗘𝗥𝗘:
📲 {TELEGRAM_CHANNEL_LINK}

#Syndicate #ValueBet #SmartMoney #FootballTips"""

# =============================================================================
# MAIN
# =============================================================================

class Config:
    def __init__(self):
        self.rapidapi_key = os.environ.get('RAPIDAPI_KEY')
        self.telegram_bot_token = os.environ.get('TELEGRAM_BOT_TOKEN')
        self.telegram_chat_id = os.environ.get('TELEGRAM_CHAT_ID')
        self.facebook_page_access_token = os.environ.get('FACEBOOK_PAGE_ACCESS_TOKEN')
        self.facebook_page_id = os.environ.get('FACEBOOK_PAGE_ID')

    def validate(self):
        return all([self.rapidapi_key, self.telegram_bot_token, self.telegram_chat_id, 
                   self.facebook_page_access_token, self.facebook_page_id])

def main():
    config = Config()
    if not config.validate(): return
    
    bot = FootballAPI(config.rapidapi_key)
    logger.info("🚀 Fetching market data...")
    matches = bot.get_matches()
    
    # Send Telegram
    tg_content = ContentGenerator.telegram_feed(matches)
    try:
        url = f"https://api.telegram.org/bot{config.telegram_bot_token}/sendMessage"
        # PARSE MODE IS NOW HTML
        requests.post(url, json={
            "chat_id": config.telegram_chat_id, 
            "text": tg_content, 
            "parse_mode": "HTML", 
            "disable_web_page_preview": True
        })
        logger.info("✅ Telegram Sent")
    except Exception as e: logger.error(f"Telegram Error: {e}")

    # Send Facebook (Only if matches exist)
    if matches:
        fb_content = ContentGenerator.facebook_teaser(matches)
        try:
            url = f"https://graph.facebook.com/v18.0/{config.facebook_page_id}/feed"
            requests.post(url, data={"message": fb_content, "access_token": config.facebook_page_access_token})
            logger.info("✅ Facebook Sent")
        except Exception as e: logger.error(f"Facebook Error: {e}")

if __name__ == "__main__":
    main()
