import PulseFeed from '@/components/landing/pulse-feed'

// Segment config must live on the page route — nested component exports are ignored.
// Without this, the homepage freezes on an old ISR snapshot and new clips never appear.
export const dynamic = 'force-dynamic'
export const revalidate = 0

export default function HomePage() {
  return <PulseFeed />
}
