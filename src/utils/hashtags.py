# src/utils/hashtags.py
"""
Hashtag generation for football video posts.
"""

from typing import List, Optional


# Competition name to hashtag mapping
COMPETITION_HASHTAGS = {
    'premier league': ['#PremierLeague', '#EPL', '#PL'],
    'la liga': ['#LaLiga', '#LaLigaSantander'],
    'bundesliga': ['#Bundesliga'],
    'serie a': ['#SerieA', '#SerieATIM'],
    'ligue 1': ['#Ligue1', '#Ligue1UberEats'],
    'champions league': ['#UCL', '#ChampionsLeague'],
    'europa league': ['#UEL', '#EuropaLeague'],
    'conference league': ['#UECL', '#ConferenceLeague'],
    'fa cup': ['#FACup', '#EmiratesFACup'],
    'carabao cup': ['#CarabaoCup', '#EFLCup'],
    'copa del rey': ['#CopaDelRey'],
    'dfb pokal': ['#DFBPokal'],
    'coppa italia': ['#CoppaItalia'],
    'coupe de france': ['#CoupeDeFrance'],
    'world cup': ['#WorldCup', '#FIFAWorldCup'],
    'euro': ['#EURO2024', '#EURO'],
    'copa america': ['#CopaAmerica'],
    'nations league': ['#NationsLeague', '#UNL'],
    'mls': ['#MLS'],
    'saudi pro league': ['#SPL', '#RoshnSaudiLeague'],
}

# Team name to hashtag mapping (popular teams)
TEAM_HASHTAGS = {
    'manchester united': '#MUFC',
    'manchester city': '#MCFC',
    'liverpool': '#LFC',
    'arsenal': '#AFC',
    'chelsea': '#CFC',
    'tottenham': '#THFC',
    'newcastle': '#NUFC',
    'real madrid': '#RealMadrid',
    'barcelona': '#FCBarcelona',
    'atletico madrid': '#AtleticoMadrid',
    'bayern munich': '#FCBayern',
    'borussia dortmund': '#BVB',
    'juventus': '#Juventus',
    'inter milan': '#Inter',
    'ac milan': '#ACMilan',
    'napoli': '#Napoli',
    'psg': '#PSG',
    'paris saint-germain': '#PSG',
}

# Default hashtags
DEFAULT_HASHTAGS = ['#Football', '#Soccer', '#Goals', '#FootballHighlights']


def generate_hashtags(video_data: dict, max_hashtags: int = 8) -> List[str]:
    """
    Generate relevant hashtags based on video data.
    
    Args:
        video_data: Video metadata from the API
        max_hashtags: Maximum number of hashtags to return
        
    Returns:
        List of hashtag strings
    """
    hashtags = []
    
    # Extract competition hashtags
    competition = video_data.get('competition', {})
    competition_name = competition.get('name', '').lower()
    
    for comp_key, comp_tags in COMPETITION_HASHTAGS.items():
        if comp_key in competition_name:
            hashtags.extend(comp_tags[:2])  # Max 2 per competition
            break
    
    # Extract team hashtags from title
    title = video_data.get('title', '').lower()
    
    teams_found = 0
    for team_key, team_tag in TEAM_HASHTAGS.items():
        if team_key in title and teams_found < 2:
            hashtags.append(team_tag)
            teams_found += 1
    
    # Add goal-specific hashtags if applicable
    if any(word in title for word in ['goal', 'score', 'scored', 'goals']):
        hashtags.append('#Goal')
    
    if any(word in title for word in ['highlight', 'highlights']):
        hashtags.append('#Highlights')
    
    # Add general football hashtags
    if len(hashtags) < max_hashtags:
        for tag in DEFAULT_HASHTAGS:
            if tag not in hashtags and len(hashtags) < max_hashtags:
                hashtags.append(tag)
    
    # Remove duplicates while preserving order
    seen = set()
    unique_hashtags = []
    for tag in hashtags:
        if tag.lower() not in seen:
            seen.add(tag.lower())
            unique_hashtags.append(tag)
    
    return unique_hashtags[:max_hashtags]


def extract_team_names(title: str) -> List[str]:
    """Extract team names from a match title."""
    # Common patterns: "Team A vs Team B", "Team A - Team B"
    separators = [' vs ', ' vs. ', ' v ', ' - ', ' – ']
    
    title_lower = title.lower()
    for sep in separators:
        if sep in title_lower:
            parts = title_lower.split(sep)
            if len(parts) >= 2:
                return [parts[0].strip(), parts[1].split()[0].strip()]
    
    return []
