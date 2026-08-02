import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/session'
import { rateLimits } from '@/lib/rate-limit'
import { supabaseAdmin } from '@/lib/supabase'

/**
 * Community contribute for incomplete (stub) VTuber profiles.
 * Only updates profiles that still need help: empty bio and no tags.
 */
export async function POST(req: NextRequest) {
  const rl = await rateLimits.write(req)
  if (!rl.ok) return rl.response!

  const session = await requireAuth(req)
  if (session instanceof NextResponse) return session

  const body = await req.json()
  const { vtuber_id, bio, handle, platform, link, tags } = body

  if (!vtuber_id || typeof vtuber_id !== 'string') {
    return NextResponse.json({ error: 'vtuber_id is required.' }, { status: 400 })
  }

  const { data: vtuber, error: fetchError } = await supabaseAdmin
    .from('vtubers')
    .select('id, name, bio, tags, approved')
    .eq('id', vtuber_id)
    .single()

  if (fetchError || !vtuber) {
    return NextResponse.json({ error: 'VTuber not found.' }, { status: 404 })
  }

  if (vtuber.approved === false) {
    return NextResponse.json({ error: 'This profile is not open for community edits.' }, { status: 403 })
  }

  const currentBio = (vtuber.bio ?? '').trim()
  const currentTags: string[] = Array.isArray(vtuber.tags) ? vtuber.tags : []
  const needsHelp = currentBio.length === 0 && currentTags.length === 0

  if (!needsHelp) {
    return NextResponse.json(
      { error: 'This profile is already filled out. Only incomplete stubs accept community help.' },
      { status: 403 }
    )
  }

  const updates: Record<string, unknown> = {}

  if (typeof bio === 'string' && bio.trim()) {
    updates.bio = bio.trim().slice(0, 500)
  }
  if (typeof handle === 'string' && handle.trim()) {
    updates.handle = handle.trim().slice(0, 64)
  }
  if (typeof platform === 'string' && platform.trim()) {
    updates.platform = platform.trim().slice(0, 64)
  }
  if (typeof link === 'string' && link.trim()) {
    updates.link = link.trim().slice(0, 500)
  }
  if (Array.isArray(tags) && tags.length > 0) {
    updates.tags = tags.filter((t: unknown) => typeof t === 'string').slice(0, 12)
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })
  }

  const { error: updateError } = await supabaseAdmin
    .from('vtubers')
    .update(updates)
    .eq('id', vtuber_id)

  if (updateError) {
    console.error('contribute update failed:', updateError)
    return NextResponse.json({ error: 'Failed to update profile.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, updated_by: session.username })
}
