// Utility functions for handling YouTube/Twitch embeds

export function parseTimestamp(timestamp: string): number {
  // Handle various formats: "1:23:45", "83:45", "5045", "1h23m45s"
  
  // Already in seconds
  if (/^\d+$/.test(timestamp)) {
    return parseInt(timestamp, 10);
  }
  
  // Format: 1h23m45s
  const hmsMatch = timestamp.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/);
  if (hmsMatch && (hmsMatch[1] || hmsMatch[2] || hmsMatch[3])) {
    const hours = parseInt(hmsMatch[1] || '0', 10);
    const minutes = parseInt(hmsMatch[2] || '0', 10);
    const seconds = parseInt(hmsMatch[3] || '0', 10);
    return hours * 3600 + minutes * 60 + seconds;
  }
  
  // Format: 1:23:45 or 23:45
  const colonMatch = timestamp.match(/^(\d+):(\d+)(?::(\d+))?$/);
  if (colonMatch) {
    if (colonMatch[3]) {
      // H:M:S
      return parseInt(colonMatch[1], 10) * 3600 + 
             parseInt(colonMatch[2], 10) * 60 + 
             parseInt(colonMatch[3], 10);
    } else {
      // M:S
      return parseInt(colonMatch[1], 10) * 60 + parseInt(colonMatch[2], 10);
    }
  }
  
  return 0;
}

export function formatTimestamp(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  
  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}

export function getYouTubeEmbedUrl(videoId: string, startTime?: number, endTime?: number): string {
  let url = `https://www.youtube.com/embed/${videoId}?rel=0&modestbranding=1`;
  
  if (startTime !== undefined) {
    url += `&start=${startTime}`;
  }
  if (endTime !== undefined) {
    url += `&end=${endTime}`;
  }
  
  return url;
}

export function getTwitchClipEmbedUrl(clipId: string, parent: string): string {
  return `https://clips.twitch.tv/embed?clip=${clipId}&parent=${parent}`;
}

export function getTwitchVodEmbedUrl(videoId: string, parent: string, timestamp?: number): string {
  let url = `https://player.twitch.tv/?video=${videoId}&parent=${parent}`;
  
  if (timestamp !== undefined) {
    const hours = Math.floor(timestamp / 3600);
    const minutes = Math.floor((timestamp % 3600) / 60);
    const seconds = timestamp % 60;
    url += `&time=${hours}h${minutes}m${seconds}s`;
  }
  
  return url;
}

// New: Twitter/X support

export function getTwitterEmbedUrl(tweetId: string): string {
  return `https://twitter.com/i/web/status/${tweetId}`;
}

/**
 * Pull broadcaster login from Twitch clip/channel URLs.
 * e.g. https://www.twitch.tv/maikyua/clip/HappyBloodyEgg... → "maikyua"
 */
export function extractTwitchChannel(url: string): string | null {
  const channelClip = url.match(/twitch\.tv\/([a-zA-Z0-9_]{2,25})\/clip\//i)
  if (channelClip) return channelClip[1].toLowerCase()

  const channelVideos = url.match(/twitch\.tv\/([a-zA-Z0-9_]{2,25})\/videos?\//i)
  if (channelVideos) return channelVideos[1].toLowerCase()

  return null
}

export function extractVideoId(url: string): { platform: 'youtube' | 'twitch' | 'twitter'; videoId: string } | null {
  // YouTube patterns
  const youtubePatterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/live\/([a-zA-Z0-9_-]{11})/,
  ];
  
  for (const pattern of youtubePatterns) {
    const match = url.match(pattern);
    if (match) {
      return { platform: 'youtube', videoId: match[1] };
    }
  }
  
  // Twitch patterns
  const twitchClipPattern = /clips\.twitch\.tv\/([a-zA-Z0-9_-]+)/;
  const twitchVodPattern = /twitch\.tv\/videos\/(\d+)/;
  const twitchClipAlt = /twitch\.tv\/\w+\/clip\/([a-zA-Z0-9_-]+)/;
  
  let match = url.match(twitchClipPattern);
  if (match) {
    return { platform: 'twitch', videoId: match[1] };
  }
  
  match = url.match(twitchVodPattern);
  if (match) {
    return { platform: 'twitch', videoId: `v${match[1]}` };
  }
  
  match = url.match(twitchClipAlt);
  if (match) {
    return { platform: 'twitch', videoId: match[1] };
  }
  
  // Twitter/X patterns
  const twitterPattern = /(?:twitter\.com|x\.com)\/\w+\/status\/(\d+)/;
  match = url.match(twitterPattern);
  if (match) {
    return { platform: 'twitter', videoId: match[1] };
  }
  
  return null;
}

export function isYouTubeShortsUrl(url: string): boolean {
  return /youtube\.com\/shorts\//.test(url);
}

export function validateClipUrl(url: string): { valid: boolean; error?: string } {
  // Reject YouTube Shorts
  if (isYouTubeShortsUrl(url)) {
    return { 
      valid: false, 
      error: 'YouTube Shorts are not accepted. VTVault is focused on raw, unedited clips and longer highlights that preserve context.' 
    };
  }
  
  const extracted = extractVideoId(url);
  if (!extracted) {
    return { 
      valid: false, 
      error: 'Could not recognize this URL. Please use a YouTube video/VOD, Twitch clip/VOD, or Twitter status link.' 
    };
  }
  
  return { valid: true };
}

export function getEmbedUrl(platform: 'youtube' | 'twitch' | 'twitter', videoId: string, parent?: string): string {
  if (platform === 'youtube') {
    return getYouTubeEmbedUrl(videoId);
  } else if (platform === 'twitch') {
    return getTwitchClipEmbedUrl(videoId, parent || 'obscuravt.com');
  } else if (platform === 'twitter') {
    return getTwitterEmbedUrl(videoId);
  }
  return videoId;
}

/** Sync YouTube thumb from a full URL or bare 11-char id. */
export function getYouTubeThumbnailUrl(urlOrId: string): string | null {
  if (/^[a-zA-Z0-9_-]{11}$/.test(urlOrId)) {
    return `https://i.ytimg.com/vi/${urlOrId}/hqdefault.jpg`
  }
  const extracted = extractVideoId(urlOrId)
  if (extracted?.platform === 'youtube') {
    return `https://i.ytimg.com/vi/${extracted.videoId}/hqdefault.jpg`
  }
  return null
}

/**
 * Resolve a thumbnail for a clip URL.
 * YouTube: i.ytimg.com (instant).
 * Twitch: scrape og:image from the clip page (oEmbed is deprecated).
 */
export async function resolveClipThumbnail(url: string): Promise<string | null> {
  const extracted = extractVideoId(url)
  if (!extracted) return null

  if (extracted.platform === 'youtube') {
    return `https://i.ytimg.com/vi/${extracted.videoId}/hqdefault.jpg`
  }

  if (extracted.platform === 'twitch') {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (compatible; ObscuraVT/1.0; +https://obscuravt.com)',
          Accept: 'text/html',
        },
        // Cache thumbs for a day at the edge when available
        next: { revalidate: 86400 },
      } as RequestInit)
      if (!res.ok) return null
      const html = await res.text()
      const m =
        html.match(/property=["']og:image["']\s+content=["']([^"']+)["']/i) ||
        html.match(/content=["']([^"']+)["']\s+property=["']og:image["']/i)
      const thumb = m?.[1]?.trim() || null
      // Ignore generic Twitch logo fallbacks
      if (thumb && /twitch_logo|ttv-static-metadata\/twitch/i.test(thumb)) return null
      return thumb
    } catch {
      return null
    }
  }

  return null
}
