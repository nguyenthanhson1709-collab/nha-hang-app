import { useRef } from 'react'
import type { Table } from './api'

/** Tường, quầy, cầu thang của Vietbowl Potsdamer Platz (theo bản vẽ quán) */
function PotsdamerDecor({ de }: { de: boolean }) {
  return (
    <g className="decor" aria-hidden>
      <path className="wall" d="M155 578 H915 L952 692" />
      <path className="wall" d="M985 795 L1022 908 L232 1532 H185" />
      <path className="wall thin" d="M155 578 V1385" />
      <path className="bar" d="M160 727 H435 V1188 H395 V768 H160 Z" />
      <path className="stairs" d="M597 307 H822 V541 H490 M490 437 H722 V407 H597" />
      {[[550, 610], [716, 610], [893, 610], [985, 897], [717, 1108], [549, 1243], [312, 1427]].map(([x, y]) => <circle key={`${x}${y}`} className="plant" cx={x} cy={y} r={17} />)}
      <text className="zone" x={200} y={655}>{de ? 'Innen' : 'Trong nhà'}</text>
      <text className="zone" x={415} y={960} transform="rotate(-90 415 960)" textAnchor="middle">{de ? 'Bar' : 'Quầy bar'}</text>
      <text className="zone" x={655} y={500} textAnchor="middle">{de ? 'Treppe' : 'Cầu thang'}</text>
      <text className="zone" x={1150} y={1030} textAnchor="middle">{de ? 'Terrasse' : 'Sân ngoài'}</text>
      <text className="zone" x={1060} y={430} textAnchor="middle">{de ? 'Terrasse' : 'Sân ngoài'}</text>
    </g>
  )
}

function Chairs({ t }: { t: Table }) {
  const n = Math.max(0, t.seats || 0)
  if (!n) return null
  const horiz = t.w >= t.h, L = horiz ? t.w : t.h, S2 = horiz ? t.h : t.w
  let a = Math.ceil(n / 2), b = Math.floor(n / 2)
  if (t.flip) [a, b] = [b, a]
  const cw = Math.min(16, L / Math.max(a, b, 1) - 4), ch = 10
  const out: React.ReactNode[] = []
  const side = (k: number, sign: number) => {
    for (let i = 0; i < k; i++) {
      const along = -L / 2 + (L * (i + 0.5)) / k, off = sign * (S2 / 2 + ch / 2 + 3)
      const cx = horiz ? along : off, cy = horiz ? off : along, w = horiz ? cw : ch, h = horiz ? ch : cw
      out.push(<rect key={`${sign}${i}`} className="chair" x={cx - w / 2} y={cy - h / 2} width={w} height={h} rx={3} />)
    }
  }
  side(a, -1); side(b, 1)
  return <>{out}</>
}

export function viewBoxOf(tables: Table[], decor: boolean): [number, number, number, number] {
  if (decor) return [150, 40, 1150, 1900]
  if (!tables.length) return [0, 0, 800, 600]
  const xs = tables.flatMap((t) => [t.x - t.w, t.x + t.w]), ys = tables.flatMap((t) => [t.y - t.h, t.y + t.h])
  const x0 = Math.min(...xs) - 40, y0 = Math.min(...ys) - 40
  return [x0, y0, Math.max(...xs) + 40 - x0, Math.max(...ys) + 40 - y0]
}

export function Plan({ tables, decor, de, cls, picked, onTap, onMove, sel }: {
  tables: Table[]; decor: boolean; de: boolean
  cls: (t: Table) => string; picked?: Set<string>; onTap?: (id: string) => void
  onMove?: (id: string, x: number, y: number) => void; sel?: string | null
}) {
  const svg = useRef<SVGSVGElement>(null)
  const drag = useRef<{ id: string; dx: number; dy: number; moved: boolean } | null>(null)
  const pt = (e: React.PointerEvent) => {
    const s = svg.current!, p = s.createSVGPoint(); p.x = e.clientX; p.y = e.clientY
    const r = p.matrixTransform(s.getScreenCTM()!.inverse()); return { x: r.x, y: r.y }
  }
  const vb = viewBoxOf(tables, decor)
  return (
    <svg ref={svg} className={`bk-plan${onMove ? ' edit' : ''}`} viewBox={vb.join(' ')} role="group"
      onPointerMove={(e) => { const d = drag.current; if (!d || !onMove) return; const p = pt(e); d.moved = true; onMove(d.id, Math.round(p.x - d.dx), Math.round(p.y - d.dy)) }}
      onPointerUp={() => { drag.current = null }} onPointerLeave={() => { drag.current = null }}>
      {decor && <PotsdamerDecor de={de} />}
      {tables.map((t) => {
        const on = picked?.has(t.id) || sel === t.id, m = Math.min(t.w, t.h)
        return (
          <g key={t.id} className={`tb ${cls(t)}${on ? ' picked' : ''}`} transform={`translate(${t.x} ${t.y}) rotate(${t.rot || 0})`}
            role="button" tabIndex={0} aria-pressed={on} aria-label={`${de ? 'Tisch' : 'Bàn'} ${t.label}`}
            onPointerDown={(e) => { if (!onMove) return; (e.target as Element).setPointerCapture?.(e.pointerId); const p = pt(e); drag.current = { id: t.id, dx: p.x - t.x, dy: p.y - t.y, moved: false }; onTap?.(t.id) }}
            onClick={() => { if (!onMove) onTap?.(t.id) }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTap?.(t.id) } }}>
            <Chairs t={t} />
            <rect className="top" x={-t.w / 2} y={-t.h / 2} width={t.w} height={t.h} rx={5} />
            <g transform={`rotate(${-(t.rot || 0)})`}>
              <text className="num" y={6}>{t.label}</text>
              {on && !onMove && <g className="tick" transform={`translate(${m / 2 + 2} ${-m / 2 - 2})`}><circle r={10} /><path d="M-4.5 0.5 L-1.2 3.8 L4.8 -3.2" /></g>}
            </g>
          </g>
        )
      })}
    </svg>
  )
}
