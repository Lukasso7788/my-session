import type { FocusShieldPreset } from "./policy";

const site = (id: string, label: string, domains: string[]): FocusShieldPreset => ({
  id,
  label,
  domains,
  group: "common",
});

const category = (id: string, label: string, domains: string[], hint: string): FocusShieldPreset => ({
  id,
  label,
  domains,
  group: "category",
  hint,
});

export const FOCUS_SHIELD_PRESETS: FocusShieldPreset[] = [
  site("amazon", "Amazon", ["amazon.com"]),
  site("apple-news", "Apple News", ["news.apple.com"]),
  site("discord", "Discord", ["discord.com"]),
  site("ebay", "eBay", ["ebay.com"]),
  site("facebook", "Facebook", ["facebook.com"]),
  site("gmail", "Gmail", ["mail.google.com", "gmail.com"]),
  site("instagram", "Instagram", ["instagram.com"]),
  site("linkedin", "LinkedIn", ["linkedin.com"]),
  site("netflix", "Netflix", ["netflix.com"]),
  site("nytimes", "NY Times", ["nytimes.com"]),
  site("pinterest", "Pinterest", ["pinterest.com"]),
  site("reddit", "Reddit", ["reddit.com"]),
  site("slack", "Slack", ["slack.com"]),
  site("snapchat", "Snapchat", ["snapchat.com"]),
  site("spotify", "Spotify", ["spotify.com"]),
  site("telegram", "Telegram", ["web.telegram.org", "t.me"]),
  site("tiktok", "TikTok", ["tiktok.com"]),
  site("tumblr", "Tumblr", ["tumblr.com"]),
  site("x", "X / Twitter", ["x.com", "twitter.com"]),
  site("whatsapp", "WhatsApp", ["web.whatsapp.com"]),
  site("youtube", "YouTube", ["youtube.com", "youtu.be"]),
  category("social", "Social", ["facebook.com", "instagram.com", "x.com", "twitter.com", "reddit.com", "tiktok.com", "snapchat.com", "tumblr.com", "pinterest.com"], "Facebook, Instagram, X, Reddit, TikTok, Snapchat, Tumblr, Pinterest"),
  category("meta", "Meta", ["facebook.com", "instagram.com", "threads.net", "messenger.com"], "Facebook, Instagram, Threads, Messenger"),
  category("messaging", "Messaging", ["discord.com", "slack.com", "web.telegram.org", "t.me", "web.whatsapp.com", "messenger.com"], "Discord, Slack, Telegram, WhatsApp, Messenger"),
  category("search", "Search", ["google.com", "bing.com", "duckduckgo.com", "yahoo.com"], "Google, Bing, DuckDuckGo, Yahoo"),
  category("news", "News", ["cnn.com", "bbc.com", "nytimes.com", "theguardian.com", "washingtonpost.com", "reuters.com", "apnews.com", "news.ycombinator.com", "news.apple.com"], "CNN, BBC, NY Times, The Guardian, Reuters, Hacker News"),
  category("shopping", "Shopping", ["amazon.com", "ebay.com", "aliexpress.com", "etsy.com", "walmart.com", "target.com"], "Amazon, eBay, AliExpress, Etsy, Walmart, Target"),
  category("video", "TV / Video", ["youtube.com", "youtu.be", "netflix.com", "twitch.tv", "hulu.com", "disneyplus.com", "primevideo.com"], "YouTube, Netflix, Twitch, Hulu, Disney+, Prime Video"),
  category("time-wasters", "Time wasters", ["youtube.com", "reddit.com", "x.com", "twitter.com", "tiktok.com", "instagram.com", "facebook.com"], "YouTube, Reddit, X, TikTok, Instagram, Facebook"),
];

export const FOCUS_SHIELD_DURATIONS = [
  { minutes: 25, label: "25 min" },
  { minutes: 50, label: "50 min" },
  { minutes: 90, label: "90 min" },
  { minutes: 120, label: "2 hours" },
  { minutes: 240, label: "4 hours" },
];
