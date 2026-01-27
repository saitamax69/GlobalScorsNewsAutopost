# Global Score News Autopost

Automated Facebook posting for football match updates.

## Setup

1. Clone this repository
2. Add the following secrets to your GitHub repository:
   - `SPORTDB_API_KEY` - Your SportDB API key
   - `GEMINI_API_KEY` - Your Google Gemini API key
   - `FB_PAGE_ID` - Your Facebook Page ID
   - `FB_PAGE_ACCESS_TOKEN` - Long-lived Facebook Page Access Token

3. The workflow runs automatically every 15 minutes

## Manual Trigger

Go to Actions > Global Score News Autopost > Run workflow

## Local Testing

```bash
npm install
export SPORTDB_API_KEY="your-key"
export GEMINI_API_KEY="your-key"
export FB_PAGE_ID="your-page-id"
export FB_PAGE_ACCESS_TOKEN="your-token"
npm start
