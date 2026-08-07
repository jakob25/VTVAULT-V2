'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import type { VTuber, Constellation, Clip, Bet, BetOption, VibeTag } from '@/lib/types'

// ── Types matching Supabase rows ──────────────────────────────────────────────

interface DbVTuber {
  id: string
  name: string
  handle: string
  platform: string
  link: string
  bio: string
  tags: string[]
  approved: boolean
  spotlight: boolean
  avatar_url?: string | null
  silhouette_url?: string | null
}

interface DbBet {
  id: string
  title: string
  description: string
  vtuber_name: string
  options: string[]
  status: string
  created_at: string
  result: string | null
  category: string
}

interface DbBetEntry {
  option: string
  amount: number
}

interface DbClip {
  id: string
  profile_id: string | null
  submitter: string
  title: string
  clip_url: string
  description: string | null
  tags: string[] | null
  upvotes: number
  created_at: string
  vtuber_name: string | null
}

interface DbCanonicalTag {
  id: string
  tag: string
  category: string
  sort_order: number
}

// ── Mappers ───────────────────────────────────────────────────────────────────

export function dbVTuberToType(row: DbVTuber): VTuber {
  const clusterTag = (row.tags ?? []).find((t: string) => t.startsWith('clust_')) ?? 'clust_variety'
  const externalLinks: VTuber['externalLinks'] = []
  if (row.link) {
    const p = row.platform?.toLowerCase() ?? ''
    if (p.includes('twitch')) externalLinks.push({ platform: 'twitch', url: row.link })
    else if (p.includes('youtube')) externalLinks.push({ platform: 'youtube', url: row.link })
    else externalLinks.push({ platform: 'website', url: row.link })
  }
  const avatarUrl = row.avatar_url?.trim() ||
    `https://api.dicebear.com/7.x/bottts-neutral/svg?seed=${encodeURIComponent(row.id)}&backgroundColor=d4a574`
  return {
    id: row.id,
    name: row.name,
    avatarUrl,
    silhouetteUrl: row.silhouette_url ?? null,
    vibeTags: (row.tags ?? []).filter((t: string) => !t.startsWith('clust_')),
    category: clusterTag,
    externalLinks,
    timezone: '',
    interests: [],
    interestedInMaking: [],
    bio: row.bio ?? '',
    scraps: 0,
  }
}

export function dbTagToVibeTag(row: DbCanonicalTag): VibeTag {
  const colorMap: Record<string, string> = {
    vibe: '#d4a574',
    content: '#c9a227',
    cluster: '#8b7355',
  }
  return {
    id: row.id,
    name: row.tag,
    category: row.category === 'vibe' ? 'personality' : row.category === 'content' ? 'content' : 'theme',
    color: colorMap[row.category] ?? '#888',
  }
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

export function useVTubers() {
  const [vtubers, setVtubers] = useState<VTuber[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('vtubers')
      .select('*')
      .eq('approved', true)
      .then(({ data }) => {
        setVtubers((data ?? []).map(r => dbVTuberToType(r as DbVTuber)))
        setLoading(false)
      })
  }, [])

  return { vtubers, loading }
}

export function useVTuberById(id: string) {
  const [vtuber, setVtuber] = useState<VTuber | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) return
    supabase
      .from('vtubers')
      .select('*')
      .eq('id', id)
      .single()
      .then(({ data }) => {
        setVtuber(data ? dbVTuberToType(data as DbVTuber) : null)
        setLoading(false)
      })
  }, [id])

  return { vtuber, loading }
}

export function useVibeTags() {
  const [vibeTags, setVibeTags] = useState<VibeTag[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('canonical_tags')
      .select('*')
      .in('category', ['vibe', 'content'])
      .order('sort_order')
      .then(({ data }) => {
        setVibeTags((data ?? []).map(r => dbTagToVibeTag(r as DbCanonicalTag)))
        setLoading(false)
      })
  }, [])

  return { vibeTags, loading }
}

export function useBets(refreshKey?: number) {
  const [bets, setBets] = useState<Bet[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const { data: betRows } = await supabase
        .from('bets')
        .select('*')
        .order('created_at', { ascending: false })

      if (!betRows) { setLoading(false); return }

      // For each bet get entry totals per option
      const mapped: Bet[] = await Promise.all(
        betRows.map(async (b: DbBet) => {
          const { data: entries } = await supabase
            .from('bet_entries')
            .select('option, amount')
            .eq('bet_id', b.id)

          const totals: Record<string, number> = {}
          ;(entries ?? []).forEach((e: DbBetEntry) => {
            totals[e.option] = (totals[e.option] ?? 0) + e.amount
          })

          const options: BetOption[] = (b.options ?? []).map((label: string, i: number) => ({
            id: `${b.id}-opt-${i}`,
            label,
            odds: 1,
            totalScraps: totals[label] ?? 0,
          }))

          return {
            id: b.id,
            title: b.title,
            description: b.description ?? '',
            vtuberId: undefined,
            options,
            status: b.status as Bet['status'],
            endsAt: b.created_at,
            createdAt: b.created_at,
          }
        })
      )

      setBets(mapped)
      setLoading(false)
    }
    load()
  }, [refreshKey]) // eslint-disable-line react-hooks/exhaustive-deps

  return { bets, loading }
}

export function useClips() {
  const [clips, setClips] = useState<Clip[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Route through /api/clips (service role). Direct anon supabase.select is
    // blocked by RLS on the clips table, so the page always looked empty.
    fetch('/api/clips')
      .then(r => (r.ok ? r.json() : []))
      .then((data: DbClip[] | { error?: string }) => {
        const rows = Array.isArray(data) ? data : []
        const mapped: Clip[] = rows.map((c: DbClip) => {
          const url = c.clip_url ?? ''
          const isYoutube = /youtube\.com|youtu\.be/i.test(url)
          return {
            id: c.id,
            vtuberId: c.profile_id ?? '',
            title: c.title,
            platform: isYoutube ? 'youtube' : 'twitch',
            // Keep full URL for Twitch (ClipCard uses videoId as the external href).
            // For YouTube, prefer the raw id when we can parse it; otherwise keep URL.
            videoId: url,
            vibeTags: c.tags ?? [],
            type: 'raw' as const,
            submittedBy: c.submitter ?? c.vtuber_name ?? '',
            votes: { up: c.upvotes ?? 0, down: 0 },
            createdAt: c.created_at,
          }
        })
        setClips(mapped)
        setLoading(false)
      })
      .catch(() => {
        setClips([])
        setLoading(false)
      })
  }, [])

  return { clips, loading }
}

export function useCanonicalTags(category?: string) {
  const [tags, setTags] = useState<VibeTag[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let q = supabase.from('canonical_tags').select('id, tag, category, sort_order, color').order('category').order('sort_order')
    if (category) q = (q as typeof q).eq('category', category)
    q.then(({ data }) => {
      setTags((data ?? []).map(r => ({
        id: r.id as string,
        name: r.tag as string,
        category: (r.category === 'vibe' ? 'personality' : r.category === 'content' ? 'content' : 'theme') as VibeTag['category'],
        color: (r.color as string | null) ?? '#888',
      })))
      setLoading(false)
    })
  }, [category])

  return { tags, loading }
}
