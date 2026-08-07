import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/session'
import { rateLimits } from '@/lib/rate-limit'
import { supabaseAdmin } from '@/lib/supabase'
import { extractVideoId, extractTwitchChannel } from '@/lib/embed-utils'
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

/**
 * Find existing VTuber by name/handle (spaces ignored) or create an approved stub.
 * Stubs are intentional for clip-sourced creators not yet fully in the Vault.
 */
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

  // Exact name match
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
    // Handle match (Twitch login without spaces)
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

    // Compact name match across approved + unapproved (stubs may be either)
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

  // Auto-create approved stub so they get a live profile immediately
  const id = `vt_${(compact || 'unknown').slice(0, 16)}_${randomUUID().slice(0, 6)}`
  const platform = platformLabelFromUrl(clipUrl)
  const link = twitchLinkFromUrl(clipUrl)
  const handle = (compact || id).slice(0, 24)

  // Full row (same shape as /api/vtubers nominator)
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

  // nominated_by FK / case mismatch → retry without it
  if (insertError && /nominated_by|foreign key|users/i.test(insertError.message)) {
    console.error('stub insert retry without nominated_by:', insertError.message)
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

  // Schema drift → minimal required columns only
  if (insertError) {
    console.error('stub insert minimal retry:', insertError.message, insertError.code)
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
    console.error('stub vtuber create failed:', insertError.message, insertError.code, insertError.details)
    return {
      profileId: null,
      resolvedName: nameFromBody,
      createdStub: false,
      stubError: insertError.message,
    }
  }

  return { profileId: id, resolvedName: nameFromBody, createdStub: true }
}

/**
 * For clips that landed with vtuber_name but no profile_id (stub failed or
 * profile_id column rejected text ids), ensure a VTuber row exists so they
 * show up in Needs Help / maps. Best-effort link update when schema allows.
 */
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

    // Best-effort: attach profile_id if the column accepts text vt_ ids
    const { error } = await supabaseAdmin
      .from('clips')
      .update({ profile_id: resolved.profileId })
      .eq('id', row.id)
      .is('profile_id', null)

    if (error) {
      // Column type/FK mismatch is expected on some schemas — stub still exists.
      console.error('orphan clip profile_id link skipped:', row.id, error.message)
    }
  }
}

export async function GET() {
  // Ensure clip-sourced creators get profiles even if original submit missed it
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
  return NextResponse.json(data)
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

  // FK / type mismatch on profile_id → keep the clip, drop the link
  if (error && resolved.profileId && (error.code === '23503' || /foreign key|profile_id|uuid|invalid input/i.test(error.message))) {
    console.error('clips insert retry without profile_id:', error.message)
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
    if (/profile_id/i.test(error.message)) minimal.profile_id = null
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
      stub_error: resolved.stubError ?? null,
    },
    { status: 201 }
  )
}
