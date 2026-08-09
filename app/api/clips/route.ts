import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/session'
import { rateLimits } from '@/lib/rate-limit'
import { supabaseAdmin } from '@/lib/supabase'
import { extractVideoId, extractTwitchChannel, resolveClipThumbnail } from '@/lib/embed-utils'
import { randomUUID } from 'crypto'

function platformLabelFromUrl(url: string): string {
  const extracted = extractVideoId(url)
  if (!extracted) return ''
  if (extracted.platform === 'youtube') return 'YouTube'
  if (extracted.platform === 'twitch') return 'Twitch'
  if (extracted.platform === 'twitter') return 'Twitter'
  return ''
}

function compactName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function twitchLinkFromUrl(clipUrl: string): string {
  const channel = extractTwitchChannel(clipUrl)
  return channel ? `https://www.twitch.tv/${channel}` : ''
}

async function resolveOrCreateStubProfile(opts: {
  profileId: string | null | undefined
  nameFromBody: string
  clipUrl: string
  submittedBy: string
}): Promise<{ profileId: string | null; resolvedName: string | null; createdStub: boolean; stubError?: string }> {
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

  const compact = compactName(nameFromBody)

  const { data: existingExact } = await supabaseAdmin
    .from('vtubers')
    .select('id, name')
    .ilike('name', nameFromBody)
    .limit(1)
    .maybeSingle()

  if (existingExact) {
    return {
      profileId: existingExact.id,
      resolvedName: existingExact.name,
      createdStub: false,
    }
  }

  if (compact) {
    const { data: byHandle } = await supabaseAdmin
      .from('vtubers')
      .select('id, name, handle')
      .ilike('handle', compact)
      .limit(1)
      .maybeSingle()

    if (byHandle) {
      return {
        profileId: byHandle.id,
        resolvedName: byHandle.name,
        createdStub: false,
      }
    }

    const { data: candidates } = await supabaseAdmin
      .from('vtubers')
      .select('id, name, handle')
      .limit(3000)

    const byCompact = (candidates ?? []).find(
      (v: { id: string; name: string; handle?: string }) =>
        compactName(v.name) === compact || compactName(v.handle ?? '') === compact
    )
    if (byCompact) {
      return {
        profileId: byCompact.id,
        resolvedName: byCompact.name,
        createdStub: false,
      }
    }
  }

  const id = `vt_${(compact || 'unknown').slice(0, 16)}_${randomUUID().slice(0, 6)}`
  const platform = platformLabelFromUrl(clipUrl)
  const link = twitchLinkFromUrl(clipUrl)
  const handle = (compact || id).slice(0, 24)

  let insertError = (
    await supabaseAdmin.from('vtubers').insert({
      id,
      name: nameFromBody,
      handle,
      platform,
      link,
      bio: '',
      tags: [],
      avatar_url: null,
      approved: true,
      nominated_by: submittedBy,
      spotlight: false,
    })
  ).error

  if (insertError && /nominated_by|foreign key|users/i.test(insertError.message)) {
    insertError = (
      await supabaseAdmin.from('vtubers').insert({
        id,
        name: nameFromBody,
        handle,
        platform,
        link,
        bio: '',
        tags: [],
        avatar_url: null,
        approved: true,
        spotlight: false,
      })
    ).error
  }

  if (insertError) {
    insertError = (
      await supabaseAdmin.from('vtubers').insert({
        id,
        name: nameFromBody,
        handle,
        approved: true,
      })
    ).error
  }

  if (insertError) {
    console.error('stub vtuber create failed:', insertError.message, insertError.code)
    return {
      profileId: null,
      resolvedName: nameFromBody,
      createdStub: false,
      stubError: insertError.message,
    }
  }

  return { profileId: id, resolvedName: nameFromBody, createdStub: true }
}

async function backfillStubProfilesForOrphanClips() {
  const { data: orphans } = await supabaseAdmin
    .from('clips')
    .select('id, vtuber_name, clip_url, submitter, profile_id')
    .is('profile_id', null)
    .not('vtuber_name', 'is', null)
    .limit(50)

  if (!orphans?.length) return

  for (const row of orphans) {
    const name = (row.vtuber_name as string | null)?.trim()
    if (!name) continue

    const resolved = await resolveOrCreateStubProfile({
      profileId: null,
      nameFromBody: name,
      clipUrl: (row.clip_url as string) || '',
      submittedBy: (row.submitter as string) || 'system',
    })

    if (!resolved.profileId) continue

    const { error } = await supabaseAdmin
      .from('clips')
      .update({ profile_id: resolved.profileId })
      .eq('id', row.id)
      .is('profile_id', null)

    if (error) {
      console.error('orphan clip profile_id link skipped:', row.id, error.message)
    }
  }
}

/** Resolve missing thumbs and cache on the row when column exists. */
async function enrichClipThumbnails(rows: any[]) {
  const out = []
  for (const row of rows) {
    if (row.thumbnail_url) {
      out.push(row)
      continue
    }
    const url = row.clip_url as string | undefined
    if (!url) {
      out.push(row)
      continue
    }
    const thumb = await resolveClipThumbnail(url)
    if (thumb) {
      // Best-effort persist (no-op if column missing)
      await supabaseAdmin.from('clips').update({ thumbnail_url: thumb }).eq('id', row.id)
      out.push({ ...row, thumbnail_url: thumb })
    } else {
      out.push(row)
    }
  }
  return out
}

export async function GET() {
  try {
    await backfillStubProfilesForOrphanClips()
  } catch (e) {
    console.error('clip stub backfill error:', e)
  }

  const { data, error } = await supabaseAdmin
    .from('clips')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: 'Failed to fetch clips.' }, { status: 500 })

  try {
    const enriched = await enrichClipThumbnails(data ?? [])
    return NextResponse.json(enriched)
  } catch (e) {
    console.error('clip thumb enrich error:', e)
    return NextResponse.json(data)
  }
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

  // Resolve preview image (YouTube formula / Twitch og:image)
  let thumbnail_url: string | null = null
  try {
    thumbnail_url = await resolveClipThumbnail(url.trim())
  } catch {
    thumbnail_url = null
  }

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
    thumbnail_url,
  }

  let { error } = await supabaseAdmin.from('clips').insert(baseRow)

  if (error && resolved.profileId && (error.code === '23503' || /foreign key|profile_id|uuid|invalid input/i.test(error.message))) {
    console.error('clips insert retry without profile_id:', error.message)
    const retryRow = { ...baseRow, profile_id: null }
    const retry = await supabaseAdmin.from('clips').insert(retryRow)
    error = retry.error
  }

  if (error && /column|thumbnail_url|vtuber_name|description|does not exist/i.test(error.message)) {
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
    if (/profile_id/i.test(error.message)) minimal.profile_id = null
    if (/tags/i.test(error.message)) delete minimal.tags
    // Retry without thumbnail if that was the problem
    if (!/thumbnail_url/i.test(error.message) && thumbnail_url) {
      minimal.thumbnail_url = thumbnail_url
    }
    const retry = await supabaseAdmin.from('clips').insert(minimal)
    error = retry.error
    // Last resort: strip thumbnail
    if (error && /thumbnail_url/i.test(error.message)) {
      delete minimal.thumbnail_url
      const retry2 = await supabaseAdmin.from('clips').insert(minimal)
      error = retry2.error
    }
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
      stub_error: resolved.stubError ?? null,
      thumbnail_url,
    },
    { status: 201 }
  )
}
