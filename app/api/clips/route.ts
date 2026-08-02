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
      .maybeSingle()
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

  // Match existing by name (case-insensitive exact)
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
    handle: nameFromBody.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 24) || id.slice(0, 16),
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
    console.error('stub vtuber create failed:', insertError.message, insertError.code, insertError.details)
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

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const profile_id = typeof body.profile_id === 'string' && body.profile_id.trim() ? body.profile_id.trim() : null
  const title = typeof body.title === 'string' ? body.title : ''
  const url = typeof body.url === 'string' ? body.url : ''
  const description = typeof body.description === 'string' ? body.description : null
  const tags = Array.isArray(body.tags) ? body.tags.filter((t): t is string => typeof t === 'string') : []
  const nameFromBody = typeof body.vtuber_name === 'string' ? body.vtuber_name.trim() : ''
  const username = session.username

  if (!title.trim())
    return NextResponse.json({ error: 'Title is required.' }, { status: 400 })
  if (!url.trim())
    return NextResponse.json({ error: 'Video URL is required.' }, { status: 400 })

  if (!profile_id && !nameFromBody) {
    return NextResponse.json(
      { error: 'Select a VTuber or enter their name.' },
      { status: 400 }
    )
  }

  // Duplicate URL check (maybeSingle avoids error when 0 rows)
  const { data: existing } = await supabaseAdmin
    .from('clips')
    .select('id')
    .eq('clip_url', url.trim())
    .maybeSingle()

  if (existing)
    return NextResponse.json({ error: 'This clip has already been submitted.' }, { status: 409 })

  const resolved = await resolveOrCreateStubProfile({
    profileId: profile_id,
    nameFromBody,
    clipUrl: url.trim(),
    submittedBy: username,
  })

  const clipId = randomUUID()
  const baseRow: Record<string, unknown> = {
    id: clipId,
    profile_id: resolved.profileId,
    submitter: username,
    title: title.trim(),
    clip_url: url.trim(),
    description: description?.trim() || null,
    tags,
    vtuber_name: resolved.resolvedName,
    upvotes: 0,
    created_at: new Date().toISOString(),
  }

  let { error } = await supabaseAdmin.from('clips').insert(baseRow)

  // FK / invalid profile → retry without profile_id
  if (error && resolved.profileId && (error.code === '23503' || /foreign key|profile_id/i.test(error.message))) {
    console.error('clips insert FK retry without profile_id:', error.message)
    const retryRow = { ...baseRow, profile_id: null }
    const retry = await supabaseAdmin.from('clips').insert(retryRow)
    error = retry.error
  }

  // Unknown column (schema drift) → strip optional fields and retry
  if (error && /column|vtuber_name|description|does not exist/i.test(error.message)) {
    console.error('clips insert schema retry:', error.message)
    const minimal: Record<string, unknown> = {
      id: clipId,
      profile_id: resolved.profileId,
      submitter: username,
      title: title.trim(),
      clip_url: url.trim(),
      tags,
      upvotes: 0,
      created_at: new Date().toISOString(),
    }
    // Drop profile if it was the problem too
    if (/profile_id/i.test(error.message)) minimal.profile_id = null
    // Drop tags if needed
    if (/tags/i.test(error.message)) delete minimal.tags
    const retry = await supabaseAdmin.from('clips').insert(minimal)
    error = retry.error
  }

  if (error) {
    console.error('clips insert failed:', error.message, error.code, error.details, error.hint)
    return NextResponse.json(
      {
        error: 'Failed to submit clip.',
        detail: error.message,
        code: error.code ?? null,
        hint: error.hint ?? null,
      },
      { status: 500 }
    )
  }

  return NextResponse.json(
    {
      ok: true,
      profile_id: resolved.profileId,
      created_stub: resolved.createdStub,
    },
    { status: 201 }
  )
}
