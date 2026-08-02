'use client'

import { useState } from 'react'
import { useAuth } from '@/lib/auth-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { AlertCircle, CheckCircle, Loader2, HandHelping } from 'lucide-react'

interface NeedsHelpContributeProps {
  vtuberId: string
  vtuberName: string
  /** true when bio empty and tags empty */
  needsHelp: boolean
}

export function NeedsHelpContribute({ vtuberId, vtuberName, needsHelp }: NeedsHelpContributeProps) {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [bio, setBio] = useState('')
  const [handle, setHandle] = useState('')
  const [platform, setPlatform] = useState('Twitch')
  const [link, setLink] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  if (!needsHelp) return null

  if (done) {
    return (
      <div className="mb-6 rounded-lg border border-vault-gold/40 bg-vault-gold/10 p-4 flex items-center gap-3">
        <CheckCircle className="h-5 w-5 text-vault-gold flex-shrink-0" />
        <p className="text-sm text-vault-cream">
          Thanks — you helped fill out <span className="font-semibold">{vtuberName}</span>.
        </p>
      </div>
    )
  }

  return (
    <div className="mb-6 rounded-lg border border-vault-gold/30 bg-vault-gold/5 p-4 space-y-3">
      <div className="flex items-start gap-3">
        <HandHelping className="h-5 w-5 text-vault-gold flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-vault-cream">This file needs your help</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {vtuberName} was added from a clip and still has almost no details. Signed-in fans can fill in the blanks.
          </p>
        </div>
        {!open && (
          <Button
            type="button"
            size="sm"
            className="bg-vault-gold hover:bg-vault-amber text-vault-deep font-semibold flex-shrink-0"
            onClick={() => {
              if (!user) return
              setOpen(true)
            }}
            disabled={!user}
          >
            Help fill out
          </Button>
        )}
      </div>

      {!user && (
        <p className="text-xs text-vault-gold flex items-center gap-1.5">
          <AlertCircle className="h-3.5 w-3.5" />
          Sign in to contribute details.
        </p>
      )}

      {open && user && (
        <form
          className="space-y-3 pt-2 border-t border-border"
          onSubmit={async e => {
            e.preventDefault()
            setSubmitting(true)
            setError(null)
            const res = await fetch('/api/vtubers/contribute', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                vtuber_id: vtuberId,
                bio: bio.trim() || undefined,
                handle: handle.trim() || undefined,
                platform: platform.trim() || undefined,
                link: link.trim() || undefined,
              }),
            })
            const data = await res.json()
            if (!res.ok) {
              setError(data.error ?? 'Something went wrong.')
              setSubmitting(false)
              return
            }
            setDone(true)
            setSubmitting(false)
          }}
        >
          <div>
            <label className="block text-xs font-medium text-vault-cream mb-1">Bio / field notes</label>
            <Textarea
              value={bio}
              onChange={e => setBio(e.target.value)}
              placeholder="Short description of this creator…"
              maxLength={500}
              rows={3}
              className="bg-muted/30 border-border text-vault-cream text-sm"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-vault-cream mb-1">Handle</label>
              <Input
                value={handle}
                onChange={e => setHandle(e.target.value)}
                placeholder="@username"
                className="bg-muted/30 border-border text-vault-cream text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-vault-cream mb-1">Platform</label>
              <select
                value={platform}
                onChange={e => setPlatform(e.target.value)}
                className="w-full px-3 py-2 rounded-md bg-muted/30 border border-border text-vault-cream text-sm"
              >
                <option value="Twitch">Twitch</option>
                <option value="YouTube">YouTube</option>
                <option value="Twitter">Twitter</option>
                <option value="Twitch/YouTube">Twitch + YouTube</option>
                <option value="Other">Other</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-vault-cream mb-1">Channel link</label>
            <Input
              type="url"
              value={link}
              onChange={e => setLink(e.target.value)}
              placeholder="https://…"
              className="bg-muted/30 border-border text-vault-cream text-sm"
            />
          </div>
          {error && (
            <p className="text-xs text-destructive flex items-center gap-1.5">
              <AlertCircle className="h-3.5 w-3.5" />
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setOpen(false)}
              className="border-border text-vault-cream"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={submitting || (!bio.trim() && !handle.trim() && !link.trim())}
              className="bg-vault-gold hover:bg-vault-amber text-vault-deep font-semibold"
            >
              {submitting && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Save details
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
