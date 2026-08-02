'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useVibeTags, useVTubers } from '@/hooks/use-data'
import { useAuth } from '@/lib/auth-context'
import { validateClipUrl, extractVideoId, extractTwitchChannel } from '@/lib/embed-utils'
import { Plus, AlertCircle, CheckCircle, Link as LinkIcon, Loader2 } from 'lucide-react'
import type { VTuber } from '@/lib/types'

interface ClipSubmitFormProps {
  prefillVtuberId?: string
  onSuccess?: () => void
  onCancel?: () => void
}

function matchVtuberFromHint(vtubers: VTuber[], hint: string): VTuber | undefined {
  const h = hint.trim().toLowerCase()
  if (!h) return undefined

  // Exact name
  const exact = vtubers.find(v => v.name.toLowerCase() === h)
  if (exact) return exact

  // Twitch/YouTube link contains the login (e.g. twitch.tv/maikyua)
  const byLink = vtubers.find(v =>
    (v.externalLinks ?? []).some(l => l.url.toLowerCase().includes(`/${h}`))
  )
  if (byLink) return byLink

  // Name contains login (common for display names)
  return vtubers.find(v => v.name.toLowerCase().includes(h))
}

export function ClipSubmitForm({ prefillVtuberId, onSuccess, onCancel }: ClipSubmitFormProps) {
  const { vibeTags } = useVibeTags()
  const { vtubers } = useVTubers()
  const { user } = useAuth()

  const [url, setUrl] = useState('')
  const [urlError, setUrlError] = useState<string | null>(null)
  const [urlValid, setUrlValid] = useState(false)
  const [extractedInfo, setExtractedInfo] = useState<{ platform: string; videoId: string } | null>(null)
  const [title, setTitle] = useState('')
  const [selectedVTuber, setSelectedVTuber] = useState(prefillVtuberId ?? '')
  const [freeTextName, setFreeTextName] = useState('')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [clipType, setClipType] = useState<'raw' | 'edited'>('raw')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  // Auto-pull meta from link
  const [metaLoading, setMetaLoading] = useState(false)
  const [thumbnail, setThumbnail] = useState<string | null>(null)
  const [titleAutoFilled, setTitleAutoFilled] = useState(false)
  const [authorFromMeta, setAuthorFromMeta] = useState<string | null>(null)
  const titleTouchedRef = useRef(false)
  const nameTouchedRef = useRef(false)
  const lastFetchedUrlRef = useRef('')

  const applyCreatorHint = (hint: string) => {
    if (!hint || nameTouchedRef.current || prefillVtuberId) return
    const match = matchVtuberFromHint(vtubers, hint)
    if (match) {
      setSelectedVTuber(match.id)
      setFreeTextName('')
    } else if (!selectedVTuber) {
      setFreeTextName(hint)
    }
    setAuthorFromMeta(hint)
  }

  const handleUrlChange = (value: string) => {
    setUrl(value)
    setUrlError(null)
    setUrlValid(false)
    setExtractedInfo(null)
    setThumbnail(null)
    setAuthorFromMeta(null)
    if (!value) return
    const validation = validateClipUrl(value)
    if (!validation.valid) {
      setUrlError(validation.error || 'Invalid URL')
    } else {
      const info = extractVideoId(value)
      if (info) {
        setExtractedInfo(info)
        setUrlValid(true)
        // Instant Twitch channel from path (no network wait)
        const channel = extractTwitchChannel(value)
        if (channel) applyCreatorHint(channel)
      }
    }
  }

  // Fetch title + thumbnail + author when URL becomes valid
  useEffect(() => {
    if (!urlValid || !url || url === lastFetchedUrlRef.current) return

    let cancelled = false
    setMetaLoading(true)
    lastFetchedUrlRef.current = url

    fetch(`/api/clip-meta?url=${encodeURIComponent(url)}`)
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (cancelled || !data) return
        if (data.thumbnail) setThumbnail(data.thumbnail)
        if (data.title && !titleTouchedRef.current) {
          setTitle(data.title)
          setTitleAutoFilled(true)
        }
        const hint = (data.channel || data.author) as string | undefined
        if (hint) applyCreatorHint(hint)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setMetaLoading(false)
      })

    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, urlValid, vtubers, prefillVtuberId])

  const toggleTag = (tagId: string) => {
    setSelectedTags(prev =>
      prev.includes(tagId) ? prev.filter(t => t !== tagId) : prev.length < 5 ? [...prev, tagId] : prev
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user) { setSubmitError('You must be signed in to submit a clip.'); return }
    if (!urlValid || !extractedInfo || !title) return
    if (!selectedVTuber && !freeTextName.trim()) return

    setSubmitting(true)
    setSubmitError(null)

    const selectedName = selectedVTuber
      ? (vtubers.find(v => v.id === selectedVTuber)?.name ?? '')
      : freeTextName.trim()

    const res = await fetch('/api/clips', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profile_id: selectedVTuber || null,
        username: user.username,
        title,
        url,
        type: clipType,
        tags: selectedTags,
        vtuber_name: selectedName || freeTextName.trim() || null,
      }),
    })

    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const detail = typeof data.detail === 'string' ? data.detail : null
      const base = typeof data.error === 'string' ? data.error : 'Something went wrong.'
      setSubmitError(detail ? `${base} (${detail})` : base)
      setSubmitting(false)
      return
    }

    setDone(true)
    setSubmitting(false)
    setTimeout(() => onSuccess?.(), 1200)
  }

  const isValid = urlValid && !!title && (!!selectedVTuber || !!freeTextName.trim())

  if (done) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <CheckCircle className="h-10 w-10 text-vault-gold" />
        <p className="font-semibold text-vault-cream">Clip submitted!</p>
        <p className="text-sm text-muted-foreground">Thanks for contributing to the Vault.</p>
        {!selectedVTuber && freeTextName.trim() && (
          <p className="text-xs text-muted-foreground max-w-sm">
            This creator isn&apos;t in the Vault yet.{' '}
            <Link href="/nominator" className="text-vault-gold hover:underline">
              Nominate them
            </Link>{' '}
            so they can get a full profile.
          </p>
        )}
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {!user && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-vault-gold/10 border border-vault-gold/30 text-sm text-vault-gold">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          You need to be signed in to submit clips.
        </div>
      )}

      {/* URL */}
      <div>
        <label className="block text-sm font-medium text-vault-cream mb-1.5">Video URL</label>
        <div className="relative">
          <Input
            type="url"
            placeholder="https://youtube.com/watch?v=... or https://twitch.tv/..."
            value={url}
            onChange={e => handleUrlChange(e.target.value)}
            className={`bg-muted/30 border-border text-vault-cream placeholder:text-muted-foreground pr-10 ${urlError ? 'border-destructive' : ''} ${urlValid ? 'border-vault-gold' : ''}`}
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            {metaLoading && <Loader2 className="h-4 w-4 text-vault-gold animate-spin" />}
            {!metaLoading && urlError && <AlertCircle className="h-4 w-4 text-destructive" />}
            {!metaLoading && urlValid && <CheckCircle className="h-4 w-4 text-vault-gold" />}
          </div>
        </div>
        {urlError && <p className="mt-1 text-xs text-destructive">{urlError}</p>}
        {extractedInfo && (
          <p className="mt-1 text-xs text-vault-gold flex items-center gap-1">
            <LinkIcon className="h-3 w-3" /> Detected: {extractedInfo.platform}
            {authorFromMeta && ` · ${authorFromMeta}`}
            {metaLoading && ' · pulling title…'}
            {!metaLoading && titleAutoFilled && ' · title pulled from link'}
          </p>
        )}
      </div>

      {/* Thumbnail preview when available */}
      {thumbnail && (
        <div className="rounded-lg overflow-hidden border border-border bg-muted/20">
          <img
            src={thumbnail}
            alt="Clip preview"
            className="w-full aspect-video object-cover"
          />
        </div>
      )}

      {/* Title */}
      <div>
        <label className="block text-sm font-medium text-vault-cream mb-1.5">
          Clip Title
          {titleAutoFilled && !titleTouchedRef.current && (
            <span className="ml-2 text-xs text-vault-gold font-normal">auto-filled from link</span>
          )}
        </label>
        <Input
          placeholder="Give this moment a memorable title..."
          value={title}
          onChange={e => {
            titleTouchedRef.current = true
            setTitleAutoFilled(false)
            setTitle(e.target.value)
          }}
          className="bg-muted/30 border-border text-vault-cream placeholder:text-muted-foreground"
        />
      </div>

      {/* VTuber — existing or not-yet-in-Vault */}
      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-vault-cream mb-1.5">VTuber</label>
          <select
            value={selectedVTuber}
            onChange={e => {
              setSelectedVTuber(e.target.value)
              if (e.target.value) {
                setFreeTextName('')
                nameTouchedRef.current = false
              }
            }}
            className="w-full px-3 py-2 rounded-md bg-muted/30 border border-border text-vault-cream text-sm"
          >
            <option value="">Not in the Vault yet / type name below</option>
            {vtubers.map(v => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
        </div>

        {!selectedVTuber && (
          <div>
            <label className="block text-sm font-medium text-vault-cream mb-1.5">
              Creator name
              {authorFromMeta && !nameTouchedRef.current && freeTextName.toLowerCase() === authorFromMeta.toLowerCase() && (
                <span className="ml-2 text-xs text-vault-gold font-normal">from link</span>
              )}
            </label>
            <Input
              placeholder="Name of the VTuber in this clip"
              value={freeTextName}
              onChange={e => {
                nameTouchedRef.current = true
                setFreeTextName(e.target.value)
              }}
              className="bg-muted/30 border-border text-vault-cream placeholder:text-muted-foreground"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Clip still goes through. You can{' '}
              <Link href="/nominator" className="text-vault-gold hover:underline">
                nominate this creator
              </Link>{' '}
              so they get a full profile later.
            </p>
          </div>
        )}
      </div>

      {/* Type */}
      <div>
        <label className="block text-sm font-medium text-vault-cream mb-1.5">Clip Type</label>
        <div className="flex gap-3">
          {(['raw', 'edited'] as const).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => setClipType(t)}
              className={`flex-1 p-3 rounded-lg border text-left transition-colors ${
                clipType === t
                  ? 'bg-vault-gold/10 border-vault-gold text-vault-gold'
                  : 'bg-muted/20 border-border text-muted-foreground hover:border-vault-bronze/50'
              }`}
            >
              <div className="font-medium text-sm">{t === 'raw' ? 'Raw Highlight' : 'Edited Clip'}</div>
              <div className="text-xs opacity-70 mt-0.5">
                {t === 'raw' ? 'Unedited, straight from stream' : 'Has been edited or compiled'}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Tags */}
      <div>
        <label className="block text-sm font-medium text-vault-cream mb-1.5">
          Vibe Tags <span className="text-muted-foreground font-normal">(up to 5)</span>
        </label>
        <div className="flex flex-wrap gap-2">
          {vibeTags.slice(0, 20).map(tag => (
            <button
              key={tag.id}
              type="button"
              onClick={() => toggleTag(tag.id)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                selectedTags.includes(tag.id)
                  ? 'bg-vault-gold/20 border-vault-gold text-vault-gold'
                  : 'bg-muted/20 border-border text-muted-foreground hover:border-vault-bronze/50'
              }`}
            >
              {tag.name}
            </button>
          ))}
        </div>
      </div>

      {submitError && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {submitError}
        </div>
      )}

      <div className="flex gap-3 pt-2 border-t border-border">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} className="border-border text-vault-cream">
            Cancel
          </Button>
        )}
        <Button
          type="submit"
          disabled={!isValid || submitting || !user}
          className="flex-1 bg-vault-gold hover:bg-vault-amber text-vault-deep font-semibold disabled:opacity-50"
        >
          {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
          Submit Clip
        </Button>
      </div>
    </form>
  )
}
