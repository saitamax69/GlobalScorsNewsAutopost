# src/api/rapidapi_client.py
"""
RapidAPI Client for Free Football Videos API
API Documentation: https://rapidapi.com/developer/api/free-football-soccer-videos
"""

import aiohttp
import asyncio
from typing import Optional
from datetime import datetime, timedelta

from src.utils.logger import get_logger


logger = get_logger(__name__)


class RapidAPIError(Exception):
    """Custom exception for RapidAPI errors."""
    pass


class RapidAPIClient:
    """Client for fetching football videos from RapidAPI."""
    
    BASE_URL = "https://free-football-soccer-videos.p.rapidapi.com"
    
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.headers = {
            "X-RapidAPI-Key": api_key,
            "X-RapidAPI-Host": "free-football-soccer-videos.p.rapidapi.com"
        }
        self._session: Optional[aiohttp.ClientSession] = None
    
    async def _get_session(self) -> aiohttp.ClientSession:
        """Get or create aiohttp session."""
        if self._session is None or self._session.closed:
            timeout = aiohttp.ClientTimeout(total=30)
            self._session = aiohttp.ClientSession(
                headers=self.headers,
                timeout=timeout
            )
        return self._session
    
    async def close(self):
        """Close the aiohttp session."""
        if self._session and not self._session.closed:
            await self._session.close()
    
    async def fetch_goal_videos(
        self,
        max_retries: int = 3,
        filter_hours: int = 24
    ) -> list:
        """
        Fetch latest goal videos from the API.
        
        Args:
            max_retries: Number of retry attempts on failure
            filter_hours: Only return videos from the last N hours
            
        Returns:
            List of video dictionaries
        """
        session = await self._get_session()
        
        for attempt in range(max_retries):
            try:
                logger.debug(f"Fetching videos (attempt {attempt + 1}/{max_retries})")
                
                async with session.get(f"{self.BASE_URL}/") as response:
                    if response.status == 200:
                        videos = await response.json()
                        
                        # Filter by recency
                        filtered_videos = self._filter_recent_videos(videos, filter_hours)
                        
                        # Filter for goal content
                        goal_videos = self._filter_goal_videos(filtered_videos)
                        
                        logger.info(f"Fetched {len(goal_videos)} goal videos from last {filter_hours}h")
                        return goal_videos
                    
                    elif response.status == 429:
                        # Rate limited
                        retry_after = int(response.headers.get('Retry-After', 60))
                        logger.warning(f"Rate limited. Waiting {retry_after}s...")
                        await asyncio.sleep(retry_after)
                        continue
                    
                    elif response.status == 401:
                        raise RapidAPIError("Invalid API key")
                    
                    elif response.status == 403:
                        raise RapidAPIError("API access forbidden - check subscription")
                    
                    else:
                        error_text = await response.text()
                        logger.warning(f"API error {response.status}: {error_text[:200]}")
                        
                        if attempt < max_retries - 1:
                            wait_time = 2 ** attempt  # Exponential backoff
                            logger.info(f"Retrying in {wait_time}s...")
                            await asyncio.sleep(wait_time)
                        
            except aiohttp.ClientError as e:
                logger.error(f"Network error: {e}")
                if attempt < max_retries - 1:
                    await asyncio.sleep(2 ** attempt)
                else:
                    raise RapidAPIError(f"Network error after {max_retries} attempts: {e}")
            
            except asyncio.TimeoutError:
                logger.error("Request timeout")
                if attempt < max_retries - 1:
                    await asyncio.sleep(2 ** attempt)
                else:
                    raise RapidAPIError(f"Timeout after {max_retries} attempts")
        
        logger.error("Max retries exceeded")
        return []
    
    def _filter_recent_videos(self, videos: list, hours: int) -> list:
        """Filter videos to only include recent ones."""
        if not videos:
            return []
        
        cutoff_time = datetime.utcnow() - timedelta(hours=hours)
        filtered = []
        
        for video in videos:
            try:
                # Parse the date field
                date_str = video.get('date', '')
                if date_str:
                    # Handle various date formats
                    for fmt in ['%Y-%m-%d', '%Y-%m-%dT%H:%M:%S', '%Y-%m-%dT%H:%M:%SZ']:
                        try:
                            video_date = datetime.strptime(date_str[:19], fmt[:len(date_str)])
                            if video_date >= cutoff_time:
                                filtered.append(video)
                            break
                        except ValueError:
                            continue
                else:
                    # No date, include by default
                    filtered.append(video)
            except Exception as e:
                logger.debug(f"Error parsing date for video: {e}")
                filtered.append(video)  # Include if we can't parse
        
        return filtered
    
    def _filter_goal_videos(self, videos: list) -> list:
        """Filter videos to only include goals/highlights."""
        if not videos:
            return []
        
        goal_keywords = [
            'goal', 'goals', 'score', 'scored',
            'highlight', 'highlights', 'all goals',
            'résumé', 'but', 'buts',  # French
            'gol', 'goles',  # Spanish
            'tor', 'tore',  # German
        ]
        
        filtered = []
        for video in videos:
            title = video.get('title', '').lower()
            
            # Check if title contains goal-related keywords
            if any(keyword in title for keyword in goal_keywords):
                filtered.append(video)
                continue
            
            # Check side field
            side = video.get('side', '').lower()
            if side in ['home', 'away']:
                filtered.append(video)
        
        # If no goal videos found, return all (API might return goals by default)
        return filtered if filtered else videos
    
    async def get_video_by_id(self, video_id: str) -> Optional[dict]:
        """Fetch a specific video by ID."""
        session = await self._get_session()
        
        try:
            async with session.get(f"{self.BASE_URL}/{video_id}") as response:
                if response.status == 200:
                    return await response.json()
                else:
                    logger.warning(f"Could not fetch video {video_id}: HTTP {response.status}")
                    return None
        except Exception as e:
            logger.error(f"Error fetching video {video_id}: {e}")
            return None
    
    async def health_check(self) -> bool:
        """Check if the API is accessible."""
        try:
            session = await self._get_session()
            async with session.get(f"{self.BASE_URL}/") as response:
                return response.status == 200
        except Exception:
            return False


# Synchronous wrapper for testing
def fetch_videos_sync(api_key: str) -> list:
    """Synchronous wrapper for fetching videos."""
    async def _fetch():
        client = RapidAPIClient(api_key)
        try:
            return await client.fetch_goal_videos()
        finally:
            await client.close()
    
    return asyncio.run(_fetch())
