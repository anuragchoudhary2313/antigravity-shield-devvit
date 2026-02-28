# 🚀 AntiGravity Shield

AntiGravity Shield is an advanced, privacy-first automated moderation and analytics tool for Reddit communities, built natively on the **Reddit Devvit** platform.

It silently watches all new posts and comments, evaluates them using a multi-engine scoring system (Spam, Toxicity, and User Risk), and flags potentially harmful content to human moderators.

## ✨ Features

- **Multi-Engine Scoring Pipeline:**
  - **Spam Engine:** Rules-based detection for URL density, excessive repetition, capitalization ratio, and a customizable keyword blocklist.
  - **Toxicity Engine:** Integrates with the Google Perspective API for advanced NLP-based detection of toxicity, insults, and profanity.
  - **User Risk Assessment:** Analyzes account age and karma velocity to assess the overall risk of the poster.
- **Smart Cost-Gating:** Only sends content to the external Perspective API if it surpasses a local spam-score threshold to keep API usage (and costs) extremely low.
- **Rate-Limiting & Caching:** Built-in deduplication cache and rate limiting (100 calls/min) ensure stability even in high-traffic subreddits.
- **Privacy-First (No PII):** Automatically strips usernames (`u/`) and subreddits (`r/`) from texts before calling external APIs. The app uses the KV store strictly for numerical counters and scores without permanently persisting any raw comment text or user PII.
- **"Suggest & Report" Model:** No automated bans or content removals. High-risk content is pushed to the Mod Queue with detailed, human-readable reasons (e.g. `Score: 85/100 — Matched blocklist keyword(s): "airdrop"; Toxicity: 90%`), leaving the final decision to human moderators.
- **Moderator Dashboard UI:**
  - A comprehensive mod-only view accessible via Subreddit Menu Actions.
  - **KPI Metrics:** Daily scanned content, flagged volume, and running average toxicity score.
  - **Leaderboards:** Top flagged offenders and top matched blocklist keywords.
  - **Recent Alerts:** A real-time log of the latest high-risk flags.
- **Inline Contextual Flags:** Renders color-coded severity badges directly beneath flagged comments (visible only to mods) with quick-action Approve/Remove buttons.
- **Settings configuration:** Easily configure toxicity and spam thresholds and input custom blocklist keywords directly from the Dashboard.

## 🛠 Installation

1. Select your target subreddit.
2. Ensure you have the right moderator permissions (Manage Settings, Manage Posts/Comments).
3. If installing via the app directory, simply hit **Install**.

## ⚙️ Configuration

After installation, go to your subreddit's Mod Tools and access the AntiGravity Shield Dashboard.

1. **Provide an API Key:** Provide a valid Google Perspective API key in the Devvit settings. Without it, AntiGravity Shield will fall back quietly to Spam-scoring only.
2. **Access the Dashboard:** Go to your Subreddit's menu and launch the `🚀 AntiGravity Shield Dashboard`.
3. **Customize Settings:** Navigate to the **Configuration Settings** panel.
   - Adjust the **Spam Threshold** (default 70).
   - Adjust the **Toxicity Threshold** (default 85).
   - Add targeted **Custom Blocklist** keywords specifically for your community.

## 🛡️ Privacy & Compliance

This tool strictly adheres to Reddit's Developer Terms.

- Acts solely in an advisory capacity ("Suggest & Report").
- No external automated enforcement actions.
- Zero persistence of unanonymized user data.

## 👨‍💻 Development

### Setup

```bash
npm install -g @devvit/cli
devvit login
```

### Running Locally

```bash
devvit playtest <target-subreddit>
```

Navigate to your target subreddit and watch the logs in your terminal. Submit test comments to test the pipeline.
