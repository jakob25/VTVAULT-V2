import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/session'
import { rateLimits } from '@/lib/rate-limit'
import { supabaseAdmin } from '@/lib/supabase'
import { extractVideoId } from '@/lib/embed-utils'
import { randomUUID } from 'crypto'

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('clips')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: 'Failed to fetch clips.' }, { status: 500 })
  return NextResponse.json(data)
}

function platformLabelFromUrl(url: string): string {
  const extracted = extractVideoId(url)
  if (!extracted) return ''
  if (extracted.platform === 'youtube') return 'YouTube'
  if (extracted.platform === 'twitch') return 'Twitch'
  if (extracted.platform === 'twitter') return 'Twitter'
  return ''
}

async function resolveOrCreateStubProfile(opts: {
  profileId: string | null | undefined
  nameFromBody: string
  clipUrl: string
  submittedBy: string
}): Promise<{ profileId: string | null; resolvedName: string | null; createdStub: boolean }> {
  const { profileId, nameFromBody, clipUrl, submittedBy } = opts

  if (profileId) {
    const { data: vtuber } = await supabaseAdmin
      .from('vtubers')
      .select('id, name')
      .eq('id', profileId)
      .single()
    if (vtuber) {
      return {
        profileId: vtuber.id,
        resolvedName: nameFromBody || vtuber.name,
        createdStub: false,
      }
    }
  }

  if (!nameFromBody) {
    return { profileId: null, resolvedName: null, createdStub: false }
  }

  // Match existing by name (case-insensitive)
  const { data: existing } = await supabaseAdmin
    .from('vtubers')
    .select('id, name')
    .ilike('name', nameFromBody)
    .limit(1)
    .maybeSingle()

  if (existing) {
    return {
      profileId: existing.id,
      resolvedName: existing.name,
      createdStub: false,
    }
  }

  // Auto-create approved stub so they get a live profile immediately
  const id = `vt_${nameFromBody.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16)}_${randomUUID().slice(0, 6)}`
  const platform = platformLabelFromUrl(clipUrl)

  const { error: insertError } = await supabaseAdmin.from('vtubers').insert({
    id,
    name: nameFromBody,
    handle: '',
    platform,
    link: '',
    bio: '',
    tags: [],
    avatar_url: null,
    approved: true,
    nominated_by: submittedBy,
    spotlight: false,
  })

  if (insertError) {
    console.error('stub vtuber create failed:', insertError)
    // Fall back to name-only clip (no profile link)
    return { profileId: null, resolvedName: nameFromBody, createdStub: false }
  }

  return { profileId: id, resolvedName: nameFromBody, createdStub: true }
}

export async function POST(req: NextRequest) {
  const rl = await rateLimits.write(req)
  if (!rl.ok) return rl.response!

  const session = await requireAuth(req)
  if (session instanceof NextResponse) return session

  const body = await req.json()
  const { profile_id, title, url, description, tags, vtuber_name } = body
  const username = session.username
  if (!title?.trim())
    return NextResponse.json({ error: 'Title is required.' }, { status: 400 })
  if (!url?.trim())
    return NextResponse.json({ error: 'Video URL is required.' }, { status: 400 })

  const nameFromBody = typeof vtuber_name === 'string' ? vtuber_name.trim() : ''
  if (!profile_id && !nameFromBody) {
    return NextResponse.json(
      { error: 'Select a VTuber or enter their name.' },
      { status: 400 }
    )
  }

  // Duplicate URL check
  const { data: existing } = await supabaseAdmin
    .from('clips')
    .select('id')
    .eq('clip_url', url.trim())
    .single()

  if (existing)
    return NextResponse.json({ error: 'This clip has already been submitted.' }, { status: 409 })

  const resolved = await resolveOrCreateStubProfile({
    profileId: profile_id || null,
    nameFromBody,
    clipUrl: url.trim(),
    submittedBy: username,
  })

  const { error } = await supabaseAdmin.from('clips').insert({
    id: randomUUID(),
    profile_id: resolved.profileId,
    submitter: username,
    title: title.trim(),
    clip_url: url.trim(),
    description: description?.trim() ?? null,
    tags: tags ?? [],
    vtuber_name: resolved.resolvedName,
    upvotes: 0,
    created_at: new Date().toISOString(),
  })

  if (error) return NextResponse.json({ error: 'Failed to submit clip.' }, { status: 500 })
  return NextResponse.json(
    {
      ok: true,
      profile_id: resolved.profileId,
      created_stub: resolved.createdStub,
    },
    { status: 201 }
  )
}
