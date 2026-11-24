// Bộ icon nét mảnh, màu theo currentColor (cam của app), thay cho emoji trên các ô.
import type { ReactNode } from 'react'

const P: Record<string, ReactNode> = {
  scan: <>
    <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
    <path d="M8.5 7.5h5l2 2v7h-7z" /><path d="M10.5 12h3M10.5 14.5h3" />
  </>,
  review: <>
    <circle cx="10.5" cy="10.5" r="6" /><path d="M15 15l5 5" /><path d="M8 10.7l1.8 1.8 3.2-3.5" />
  </>,
  archive: <>
    <path d="M3.5 7.5V6a1.5 1.5 0 0 1 1.5-1.5h4l2 2h8a1.5 1.5 0 0 1 1.5 1.5v1" />
    <path d="M3.5 9h17l-1.2 9.2a1.5 1.5 0 0 1-1.5 1.3H6.2a1.5 1.5 0 0 1-1.5-1.3z" />
  </>,
  book: <>
    <path d="M6 3.5h11.5a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H6a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2z" />
    <path d="M8 3.5v17" /><path d="M11 8h5M11 11h5M11 14h3" />
  </>,
  chart: <>
    <path d="M4 20h16" /><rect x="5.5" y="12" width="3" height="6" rx=".6" /><rect x="10.5" y="7" width="3" height="11" rx=".6" /><rect x="15.5" y="9.5" width="3" height="8.5" rx=".6" />
  </>,
  trend: <>
    <path d="M4 20h16" /><path d="M5 16l4.5-4.5 3 3L19 8" /><path d="M15 8h4v4" />
  </>,
  cash: <>
    <rect x="3" y="6.5" width="18" height="11" rx="1.8" /><circle cx="12" cy="12" r="2.6" /><path d="M6.5 9.5v5M17.5 9.5v5" />
  </>,
  inbox: <>
    <path d="M12 3.5v9M8.5 9l3.5 3.5L15.5 9" /><path d="M4 13.5l1.8-5h1.7M16.5 8.5h1.7l1.8 5v4.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18z" /><path d="M4 13.5h4.5l1 2h5l1-2H20" />
  </>,
  outbox: <>
    <path d="M12 12.5v-9M8.5 7L12 3.5 15.5 7" /><path d="M4 13.5l1.8-5h1.7M16.5 8.5h1.7l1.8 5v4.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18z" /><path d="M4 13.5h4.5l1 2h5l1-2H20" />
  </>,
  bank: <>
    <path d="M3.5 9L12 4l8.5 5z" /><path d="M5.5 10.5v6.5M9.8 10.5v6.5M14.2 10.5v6.5M18.5 10.5v6.5" /><path d="M3.5 19.5h17" />
  </>,
  contract: <>
    <path d="M14 3.5H7a1.5 1.5 0 0 0-1.5 1.5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8z" /><path d="M14 3.5V8h4.5" />
    <path d="M8.5 12h7M8.5 15h4" /><path d="M12.5 18c.8-.9 1.5-.9 2 0s1.2.9 2 0" />
  </>,
  store: <>
    <path d="M4 9.5l1.5-5h13l1.5 5" /><path d="M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0" />
    <path d="M5.5 11.5v8h13v-8" /><path d="M10 19.5v-4.5h4v4.5" />
  </>,
  food: <>
    <path d="M7 3.5v7M5 3.5v4.5a2 2 0 0 0 4 0V3.5M7 10.5v10" /><path d="M17 20.5V3.5c-2 1-3 3.5-3 7h3" />
  </>,
  drink: <>
    <path d="M6 4.5h12l-1.6 14.2a2 2 0 0 1-2 1.8H9.6a2 2 0 0 1-2-1.8z" /><path d="M6.6 9.5h10.8" /><path d="M13 4.5l1.5-2" />
  </>,
  box: <>
    <path d="M12 3.5l8 4v9l-8 4-8-4v-9z" /><path d="M4 7.5l8 4 8-4M12 11.5v9" />
  </>,
}

export function Icon({ name, size = 30 }: { name: string; size?: number }) {
  return (
    <svg className="svg-ic" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {P[name]}
    </svg>
  )
}

// Ô icon tròn trong các tile
export const TileIcon = ({ name }: { name: string }) => <span className="ic"><Icon name={name} /></span>
