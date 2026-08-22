import { ImageResponse } from 'next/og'
import { getSupabaseClient } from '@/lib/supabase'

export const runtime = 'edge'
export const alt = 'ObscuraVT Subject File'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

interface Props {
  params: Promise<{ id: string }>
}

function buildCaseId(id: string) {
  return `OVT-${String(id).replace(/[^a-zA-Z0-9]/g, '').slice(-5).toUpperCase().padStart(5, '0')}`
}

export default async function Image({ params }: Props) {
  const { id } = await params
  const supabase = getSupabaseClient()

  let name = 'UNKNOWN SUBJECT'
  let avatarUrl: string | null = null
  let platform = ''
  let claimed = false
  let handle = ''

  try {
    const { data } = await supabase
      .from('vtubers')
      .select('id, name, avatar_url, platform, claimed_by, handle')
      .eq('id', id)
      .eq('approved', true)
      .single()

    if (data) {
      name = data.name || name
      avatarUrl = data.avatar_url ?? null
      platform = (data.platform || '').toUpperCase()
      claimed = Boolean(data.claimed_by)
      handle = data.handle || ''
    }
  } catch {
    // fall through with defaults so the image still renders
  }

  const caseId = buildCaseId(id)
  const statusLabel = claimed ? 'VERIFIED SUBJECT' : 'UNCLAIMED FILE'
  const statusColor = claimed ? '#4fd6a8' : '#5a8a99'

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          background: '#0d0d14',
          position: 'relative',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        }}
      >
        {/* outer archive frame */}
        <div
          style={{
            position: 'absolute',
            inset: 18,
            border: '2px solid #1e3a4a',
            borderRadius: 8,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            background: 'linear-gradient(160deg, #0a1620 0%, #081119 100%)',
          }}
        >
          {/* header strip */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 28px',
              borderBottom: '1px dashed rgba(60, 200, 220, 0.35)',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div
                style={{
                  color: '#4fc9d6',
                  fontSize: 13,
                  letterSpacing: '0.18em',
                  textTransform: 'uppercase',
                }}
              >
                OBSCURAVT // SUBJECT ARCHIVE
              </div>
              <div style={{ color: statusColor, fontSize: 12, letterSpacing: '0.1em' }}>
                ● {statusLabel}
              </div>
            </div>
            <div style={{ color: '#5a8a99', fontSize: 13, letterSpacing: '0.08em' }}>
              CASE NO. {caseId}
            </div>
          </div>

          {/* paper body */}
          <div
            style={{
              flex: 1,
              margin: '18px 22px 22px',
              background: 'linear-gradient(135deg, #e9dfc4 0%, #ddd0ac 50%, #d3c49b 100%)',
              borderRadius: 2,
              display: 'flex',
              padding: '28px 32px',
              gap: 36,
              position: 'relative',
              boxShadow: 'inset 0 0 0 1px rgba(80, 60, 20, 0.15)',
            }}
          >
            {/* polaroid */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                background: '#f4f1e6',
                padding: '10px 10px 18px',
                boxShadow: '0 6px 18px rgba(0,0,0,0.35)',
                transform: 'rotate(-2deg)',
                width: 280,
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  width: 260,
                  height: 260,
                  background: '#181420',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                }}
              >
                {avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={avatarUrl}
                    alt=""
                    width={260}
                    height={260}
                    style={{ objectFit: 'cover', width: '100%', height: '100%' }}
                  />
                ) : (
                  <div
                    style={{
                      color: '#d4a843',
                      fontSize: 72,
                      fontWeight: 700,
                      letterSpacing: '0.02em',
                    }}
                  >
                    {(name || '?').charAt(0).toUpperCase()}
                  </div>
                )}
              </div>
              <div
                style={{
                  marginTop: 10,
                  fontSize: 12,
                  color: '#5a4f2e',
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                }}
              >
                FIG. 1 — SUBJECT
              </div>
            </div>

            {/* text column */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                flex: 1,
                gap: 10,
                minWidth: 0,
              }}
            >
              <div
                style={{
                  fontSize: 14,
                  color: '#5a4f2e',
                  letterSpacing: '0.16em',
                  textTransform: 'uppercase',
                }}
              >
                CODENAME
              </div>
              <div
                style={{
                  fontSize: 56,
                  fontWeight: 800,
                  color: '#1a1510',
                  lineHeight: 1.05,
                  letterSpacing: '-0.02em',
                  maxWidth: 720,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {name}
              </div>

              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  marginTop: 14,
                  fontSize: 18,
                  color: '#2c2616',
                  letterSpacing: '0.04em',
                }}
              >
                {handle ? (
                  <div style={{ display: 'flex', gap: 12 }}>
                    <span style={{ color: '#5a4f2e', width: 110 }}>HANDLE</span>
                    <span style={{ fontWeight: 700 }}>{handle}</span>
                  </div>
                ) : null}
                {platform ? (
                  <div style={{ display: 'flex', gap: 12 }}>
                    <span style={{ color: '#5a4f2e', width: 110 }}>PLATFORM</span>
                    <span style={{ fontWeight: 700 }}>{platform}</span>
                  </div>
                ) : null}
                <div style={{ display: 'flex', gap: 12 }}>
                  <span style={{ color: '#5a4f2e', width: 110 }}>STATUS</span>
                  <span style={{ fontWeight: 700 }}>{statusLabel}</span>
                </div>
              </div>

              <div
                style={{
                  marginTop: 28,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 18px',
                  background: '#0d0d14',
                  borderRadius: 4,
                  width: 'fit-content',
                }}
              >
                <span
                  style={{
                    color: '#d4a843',
                    fontSize: 16,
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                  }}
                >
                  VIEW FULL FILE
                </span>
                <span style={{ color: '#4fc9d6', fontSize: 16 }}>→</span>
                <span style={{ color: '#c9d9df', fontSize: 15, letterSpacing: '0.04em' }}>
                  obscuravt.com
                </span>
              </div>
            </div>

            {/* small stamp */}
            <div
              style={{
                position: 'absolute',
                top: 18,
                right: 22,
                border: '3px solid #8a2317',
                color: '#8a2317',
                fontSize: 14,
                fontWeight: 700,
                letterSpacing: '0.12em',
                padding: '6px 10px',
                transform: 'rotate(8deg)',
                opacity: 0.85,
              }}
            >
              FILED
            </div>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
    },
  )
}
