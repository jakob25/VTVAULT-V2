'use client'

import type { ReactNode } from 'react'
import { VaultPanel } from '@/components/vault/vault-surfaces'
import { CardRgbTearOverlay } from '@/components/vault/card-rgb-tear-overlay'
import { cn } from '@/lib/utils'

interface PulseSectionShellProps {
  children: ReactNode
  /** Tailwind gradient classes after bg-gradient-to-br, e.g. from-vault-gold/15 to-transparent */
  accent?: string
  staggerIndex?: number
  className?: string
}

/**
 * Same visual language as marketing FeatureCardBlock:
 * VaultPanel + colored gradient wash + CardRgbTearOverlay glitch.
 * Sized for full Pulse sections, not the small marketing cards.
 */
export function PulseSectionShell({
  children,
  accent = 'from-vault-gold/15 to-transparent',
  staggerIndex = 0,
  className,
}: PulseSectionShellProps) {
  return (
    <VaultPanel
      className={cn(
        'group relative overflow-hidden transition-all duration-300 hover:border-vault-gold/35 p-5 md:p-6',
        className,
      )}
    >
      <div
        className={cn(
          'pointer-events-none absolute inset-0 bg-gradient-to-br opacity-80',
          accent,
        )}
      />
      <CardRgbTearOverlay staggerIndex={staggerIndex} />
      <div className="relative z-[2]">{children}</div>
    </VaultPanel>
  )
}
