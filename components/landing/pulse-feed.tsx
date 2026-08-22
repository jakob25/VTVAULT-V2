import Link from 'next/link'
import { Film, Palette, Sparkles, Trophy, MessageSquare, ExternalLink, ArrowRight, HandHelping } from 'lucide-react'
import { GlitchHeading } from '@/components/vault/glitch-heading'
import { VaultDivider, VaultPanel, GalleryWall, GalleryWallItem, StatCard } from '@/components/vault/vault-surfaces'
import { PulseSectionShell } from '@/components/landing/pulse-section-shell'
import { supabaseAdmin } from '@/lib/supabase'
import { resolveClipThumbnail } from '@/lib/embed-utils'

export const revalidate = 30

async function safeQuery<T>(fn: () => PromiseLike<{ data: T | null; error?: any }>, fallback: T): Promise<T> {
  try {
    const res = await fn()
    return (res.data ?? fallback) as T
  } catch {
    return fallback
  }
}

async function getPulse() {
  const [
    clipsRaw,
    fanArt,
    vtubers,
    posts,
    predictions,
    vtuberCount,
    clipCount,
    userCount,
    needsHelp,
  ] = await Promise.all([
    safeQuery(
      () =>
        supabaseAdmin
          .from('clips')
          .select('id,title,clip_url,profile_id,submitter,upvotes,created_at,vtuber_name,thumbnail_url')
          .order('created_at', { ascending: false })
          .limit(6),
      [] as any[]
    ),
    safeQuery(
      () =>
        supabaseAdmin
          .from('fan_art')
          .select('id,vtuber_id,submitted_by,twitter_url,image_url,created_at')
          .eq('reported', false)
          .order('created_at', { ascending: false })
          .limit(6),
      [] as any[]
    ),
    safeQuery(
      () =>
        supabaseAdmin
          .from('vtubers')
          .select('id,name,avatar_url,bio,created_at')
          .eq('approved', true)
          .order('created_at', { ascending: false })
          .limit(6),
      [] as any[]
    ),
    safeQuery(
      () =>
        supabaseAdmin
          .from('cluster_posts')
          .select('id,constellation_id,username,content,created_at')
          .order('created_at', { ascending: false })
          .limit(5),
      [] as any[]
    ),
    safeQuery(
      () =>
        supabaseAdmin
          .from('bets')
          .select('id,title,vtuber_name,status,created_at')
          .eq('status', 'open')
          .order('created_at', { ascending: false })
          .limit(5),
      [] as any[]
    ),
    safeQuery(
      async () => {
        const res = await supabaseAdmin
          .from('vtubers')
          .select('id', { count: 'exact', head: true })
          .eq('approved', true)
        return { data: res.count ?? 0 }
      },
      0
    ),
    safeQuery(
      async () => {
        const res = await supabaseAdmin.from('clips').select('id', { count: 'exact', head: true })
        return { data: res.count ?? 0 }
      },
      0
    ),
    safeQuery(
      async () => {
        const res = await supabaseAdmin.from('users').select('username', { count: 'exact', head: true })
        return { data: res.count ?? 0 }
      },
      0
    ),
    safeQuery(
      () =>
        supabaseAdmin
          .from('vtubers')
          .select('id,name,avatar_url,bio,tags,created_at')
          .eq('approved', true)
          .order('created_at', { ascending: false })
          .limit(24),
      [] as any[]
    ),
  ])

  // Ensure each clip has a preview image (resolve + cache if missing)
  const clips = await Promise.all(
    (clipsRaw as any[]).map(async c => {
      if (c.thumbnail_url) return c
      if (!c.clip_url) return c
      try {
        const thumb = await resolveClipThumbnail(c.clip_url)
        if (thumb) {
          await supabaseAdmin.from('clips').update({ thumbnail_url: thumb }).eq('id', c.id)
          return { ...c, thumbnail_url: thumb }
        }
      } catch {
        /* ignore */
      }
      return c
    })
  )

  const needsHelpList = (needsHelp as any[])
    .filter(v => {
      const bioEmpty = !(v.bio && String(v.bio).trim())
      const tagsEmpty = !Array.isArray(v.tags) || v.tags.length === 0
      return bioEmpty && tagsEmpty
    })
    .slice(0, 6)

  return {
    clips,
    fanArt,
    vtubers,
    posts,
    predictions,
    needsHelpList,
    stats: {
      vtuberCount,
      clipCount,
      userCount,
    },
  }
}

function SectionHeader({
  icon: Icon,
  title,
  href,
}: {
  icon: React.ElementType
  title: string
  href: string
}) {
  return (
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-2">
        <Icon className="h-5 w-5 text-vault-gold" />
        <h2 className="text-xl font-bold text-vault-cream">{title}</h2>
      </div>
      <Link href={href} className="text-sm text-vault-gold hover:text-vault-amber flex items-center gap-1">
        View all <ArrowRight className="h-3 w-3" />
      </Link>
    </div>
  )
}

export default async function PulseFeed() {
  const { clips, fanArt, vtubers, posts, predictions, needsHelpList, stats } = await getPulse()

  return (
    <div className="min-h-screen">
      <section className="border-b border-border bg-vault-deep/60">
        <div className="mx-auto w-full max-w-[1600px] px-2 sm:px-3 py-5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <GlitchHeading as="h1" className="text-2xl font-bold text-vault-cream">
                The Vault Pulse
              </GlitchHeading>
              <p className="text-sm text-muted-foreground mt-1">
                Everything the community posted, dropped, and pitched — live. The more people who join and share, the better this gets.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <StatCard label="Creators" value={stats.vtuberCount.toLocaleString()} />
              <StatCard label="Clips" value={stats.clipCount.toLocaleString()} />
              <StatCard label="Fans in the Vault" value={stats.userCount.toLocaleString()} />
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto w-full max-w-[1600px] px-2 sm:px-3 py-5 space-y-5">
        {needsHelpList.length > 0 && (
          <PulseSectionShell accent="from-vault-gold/45 via-vault-gold/20 to-transparent" staggerIndex={0}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <HandHelping className="h-5 w-5 text-vault-gold" />
                <h2 className="text-xl font-bold text-vault-cream">Needs your help</h2>
              </div>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              These creators were added from clips and still have empty files. Sign in and fill in what you know.
            </p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {needsHelpList.map((v: any) => (
                <Link
                  key={v.id}
                  href={`/vtuber/${v.id}`}
                  className="vault-card rounded-xl p-4 hover:border-vault-gold/40 transition-all flex items-center gap-3 border border-vault-gold/20 bg-vault-deep/40"
                >
                  {v.avatar_url ? (
                    <img
                      src={v.avatar_url}
                      alt=""
                      className="h-10 w-10 rounded-full object-cover flex-shrink-0"
                    />
                  ) : (
                    <div className="h-10 w-10 rounded-full bg-vault-gold/20 flex items-center justify-center text-vault-gold font-bold flex-shrink-0">
                      {v.name?.[0] ?? '?'}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-vault-cream truncate">{v.name}</p>
                    <p className="text-xs text-vault-gold">Incomplete dossier · help fill it out</p>
                  </div>
                </Link>
              ))}
            </div>
          </PulseSectionShell>
        )}

        <PulseSectionShell accent="from-sky-500/40 via-sky-500/15 to-transparent" staggerIndex={1}>
          <SectionHeader icon={Film} title="Fresh Clips" href="/clips" />
          {clips.length === 0 ? (
            <p className="text-muted-foreground text-sm">No clips yet. Be the first.</p>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {clips.map((c: any) => (
                <a
                  key={c.id}
                  href={c.clip_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="vault-card rounded-xl overflow-hidden hover:border-vault-gold/30 transition-all block bg-vault-deep/40 border border-border"
                >
                  <div className="relative aspect-video bg-vault-deep">
                    {c.thumbnail_url ? (
                      <img
                        src={c.thumbnail_url}
                        alt=""
                        className="absolute inset-0 h-full w-full object-cover"
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-xs">
                        No preview
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-vault-deep/80 via-transparent to-transparent" />
                  </div>
                  <div className="p-3">
                    <p className="font-medium text-vault-cream text-sm line-clamp-2 mb-2">{c.title}</p>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>by {c.submitter ?? c.vtuber_name ?? 'unknown'}</span>
                      <span className="flex items-center gap-1 text-vault-gold">
                        <ExternalLink className="h-3 w-3" /> {c.upvotes ?? 0} ▲
                      </span>
                    </div>
                  </div>
                </a>
              ))}
            </div>
          )}
        </PulseSectionShell>

        <PulseSectionShell accent="from-rose-500/40 via-rose-500/15 to-transparent" staggerIndex={2}>
          <SectionHeader icon={Palette} title="Fan Art" href="/fan-art" />
          {fanArt.length === 0 ? (
            <p className="text-muted-foreground text-sm">Blank wall. Hang something.</p>
          ) : (
            <GalleryWall>
              {fanArt
                .filter((a: any) => a.image_url)
                .map((a: any, i: number) => (
                  <GalleryWallItem
                    key={a.id}
                    tilt={i % 3 === 0 ? 'right' : i % 3 === 1 ? 'left' : 'none'}
                  >
                    <div className="bg-muted/20">
                      <img src={a.image_url} alt="fan art" className="w-full object-cover" />
                      <div className="p-2 bg-vault-deep/80">
                        <span className="text-[10px] text-muted-foreground">
                          fan art · {a.submitted_by}
                        </span>
                      </div>
                    </div>
                  </GalleryWallItem>
                ))}
            </GalleryWall>
          )}
        </PulseSectionShell>

        <PulseSectionShell accent="from-[#e056a0]/40 via-[#e056a0]/15 to-transparent" staggerIndex={3}>
          <SectionHeader icon={Sparkles} title="New in the Vault" href="/discover" />
          {vtubers.length === 0 ? (
            <p className="text-muted-foreground text-sm">No new creators this cycle.</p>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {vtubers.map((v: any) => (
                <Link
                  key={v.id}
                  href={`/vtuber/${v.id}`}
                  className="vault-card rounded-xl p-4 hover:border-vault-gold/30 transition-all flex items-center gap-3 bg-vault-deep/40"
                >
                  {v.avatar_url ? (
                    <img
                      src={v.avatar_url}
                      alt=""
                      className="h-10 w-10 rounded-full object-cover flex-shrink-0"
                    />
                  ) : (
                    <div className="h-10 w-10 rounded-full bg-vault-gold/20 flex items-center justify-center text-vault-gold font-bold flex-shrink-0">
                      {v.name?.[0] ?? '?'}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="font-semibold text-vault-cream truncate">{v.name}</p>
                    {v.bio && (
                      <p className="text-xs text-muted-foreground line-clamp-1">{v.bio}</p>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </PulseSectionShell>

        <div className="grid md:grid-cols-2 gap-5">
          <PulseSectionShell accent="from-vault-gold/40 via-vault-gold/15 to-transparent" staggerIndex={4}>
            <SectionHeader icon={Trophy} title="Live Predictions" href="/bets" />
            {predictions.length === 0 ? (
              <p className="text-muted-foreground text-sm">No open predictions right now.</p>
            ) : (
              <div className="space-y-2">
                {predictions.map((p: any) => (
                  <VaultPanel key={p.id} className="p-3 bg-vault-deep/40">
                    <p className="text-sm text-vault-cream line-clamp-1">{p.title}</p>
                    <p className="text-xs text-vault-gold mt-0.5">{p.vtuber_name}</p>
                  </VaultPanel>
                ))}
              </div>
            )}
          </PulseSectionShell>

          <PulseSectionShell accent="from-sky-500/40 via-sky-500/15 to-transparent" staggerIndex={5}>
            <SectionHeader icon={MessageSquare} title="From the Forums" href="/forums" />
            {posts.length === 0 ? (
              <p className="text-muted-foreground text-sm">Crickets. Say something.</p>
            ) : (
              <div className="space-y-2">
                {posts.map((p: any) => (
                  <VaultPanel key={p.id} className="p-3 bg-vault-deep/40">
                    <p className="text-sm text-vault-cream line-clamp-2">{p.content}</p>
                    <p className="text-xs text-muted-foreground mt-1">{p.username}</p>
                  </VaultPanel>
                ))}
              </div>
            )}
          </PulseSectionShell>
        </div>

        <VaultDivider />
        <p className="text-center text-sm text-muted-foreground">
          The algorithm didn&apos;t show you this.{' '}
          <span className="text-vault-gold">You did.</span>
        </p>
      </div>
    </div>
  )
}
