import { NextRequest, NextResponse } from 'next/server'
import {
  extractVideoId,
  extractTwitchChannel,
  validateClipUrl,
  resolveClipThumbnail,
} from '@/lib/embed-utils'

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url')?.trim()
  if (!url) {
    return NextResponse.json({ error: 'url is required' }, { status: 400 })
  }

  const validation = validateClipUrl(url)
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error || 'Invalid URL' }, { status: 400 })
  }

  const extracted = extractVideoId(url)
  if (!extracted) {
    return NextResponse.json({ error: 'Could not parse video id' }, { status: 400 })
  }

  try {
    let title: string | null = null
    let thumbnail: string | null = null
    let author: string | null = null

    const twitchChannel = extracted.platform === 'twitch' ? extractTwitchChannel(url) : null
    if (twitchChannel) {
      author = twitchChannel
    }

    if (extracted.platform === 'youtube') {
      const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`
      const res = await fetch(oembedUrl, { next: { revalidate: 3600 } })
      if (res.ok) {
        const data = await res.json()
        title = data.title ?? null
        thumbnail = data.thumbnail_url ?? null
        author = data.author_name ?? null
      }
      if (!thumbnail) {
        thumbnail = `https://i.ytimg.com/vi/${extracted.videoId}/hqdefault.jpg`
      }
    } else if (extracted.platform === 'twitch') {
      // Twitch oEmbed is dead — scrape og:image from the clip page
      thumbnail = await resolveClipThumbnail(url)
    } else if (extracted.platform === 'twitter') {
      const oembedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}&omit_script=true`
      const res = await fetch(oembedUrl, { next: { revalidate: 3600 } })
      if (res.ok) {
        const data = await res.json()
        author = data.author_name ?? null
        title = data.author_name
          ? `${data.author_name} on X`
          : `X post ${extracted.videoId}`
      }
    }

    return NextResponse.json({
      platform: extracted.platform,
      videoId: extracted.videoId,
      title,
      thumbnail,
      author,
      channel: twitchChannel,
    })
  } catch (e) {
    console.error('clip-meta error:', e)
    const twitchChannel = extracted.platform === 'twitch' ? extractTwitchChannel(url) : null
    return NextResponse.json(
      {
        platform: extracted.platform,
        videoId: extracted.videoId,
        title: null,
        thumbnail:
          extracted.platform === 'youtube'
            ? `https://i.ytimg.com/vi/${extracted.videoId}/hqdefault.jpg`
            : null,
        author: twitchChannel,
        channel: twitchChannel,
      },
      { status: 200 }
    )
  }
}
