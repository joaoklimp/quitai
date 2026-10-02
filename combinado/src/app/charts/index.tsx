// Gráficos do painel (SVG/HTML puros): barras em pares, medidor radial, meta segmentada, minigráfico,
// barras horizontais, funil, mapa de calor, rosca e linha. Um eixo só, dica no foco e no mouse, tabela opcional.
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { cx } from '../ui';

export function niceMax(v: number): number {
  if (v <= 0) return 4;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / exp;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 4 ? 4 : n <= 5 ? 5 : n <= 8 ? 8 : 10;
  return nice * exp;
}
/** Escala com 4 intervalos de passo "redondo" (1, 2, 2.5, 5 × 10^n); inteiro quando os dados são contagens. */
export function niceScale(max: number, integer = true): { max: number; ticks: number[] } {
  const raw = Math.max(max, integer ? 4 : 1e-9) / 4;
  const exp = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / exp;
  let step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * exp;
  if (integer) step = Math.max(1, Math.ceil(step));
  return { max: step * 4, ticks: [0, 1, 2, 3, 4].map((k) => k * step) };
}
const fmtInt = (v: number) => Math.round(v).toLocaleString('pt-BR');

/* ---------- barras em pares (mesma unidade, um eixo) ---------- */
export interface PairDatum { key: string; label: string; long: string; a: number; b: number; extra?: [string, string][] }
export function PairBars({ data, aName, bName, height = 240, table = false }: { data: PairDatum[]; aName: string; bName: string; height?: number; table?: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const { max, ticks } = niceScale(Math.max(1, ...data.map((d) => Math.max(d.a, d.b))));
  const dense = data.length > 16;
  if (table) {
    return (
      <div style={{ overflowX: 'auto' }}>
        <table className="chart-table"><thead><tr><th>Período</th><th>{aName}</th><th>{bName}</th>{data[0]?.extra?.map(([k]) => <th key={k}>{k}</th>)}</tr></thead>
          <tbody>{data.map((d) => <tr key={d.key}><td>{d.long}</td><td>{fmtInt(d.a)}</td><td>{fmtInt(d.b)}</td>{d.extra?.map(([k, v]) => <td key={k}>{v}</td>)}</tr>)}</tbody></table>
      </div>
    );
  }
  const h = hover != null ? data[hover] : null;
  return (
    <div className={cx('pb', dense && 'dense')} style={{ ['--h' as string]: `${height}px` }}>
      <div className="pb-y" aria-hidden>{ticks.map((t) => <span key={t} style={{ bottom: `${(t / max) * 100}%` }}>{fmtInt(t)}</span>)}</div>
      <div className="pb-plot" onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => <div key={t} className="pb-grid" style={{ bottom: `${(t / max) * 100}%` }} />)}
        <div className="pb-cols" role="list" aria-label={`${aName} e ${bName} por período`}>
          {data.map((d, i) => (
            <div key={d.key} role="listitem" tabIndex={0} className={cx('pb-col', hover === i && 'hover')} aria-label={`${d.long}: ${fmtInt(d.a)} ${aName.toLowerCase()}, ${fmtInt(d.b)} ${bName.toLowerCase()}`}
              onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}>
              <div className="pb-track"><div className="pb-bar a" style={{ height: `${(d.a / max) * 100}%`, animationDelay: `${i * 18}ms` }} /></div>
              <div className="pb-track"><div className="pb-bar b" style={{ height: `${(d.b / max) * 100}%`, animationDelay: `${i * 18 + 60}ms` }} /></div>
            </div>
          ))}
        </div>
        {h && hover != null && (
          <div className="chart-tip" style={{ left: `${((hover + 0.5) / data.length) * 100}%`, top: `${(1 - Math.max(h.a, h.b) / max) * 100}%` }}>
            <div className="tt">{h.long}</div>
            <div className="tr"><i style={{ background: 'var(--c1)' }} />{aName}<span className="sp" /><b>{fmtInt(h.a)}</b></div>
            <div className="tr"><i style={{ background: 'var(--c2)' }} />{bName}<span className="sp" /><b>{fmtInt(h.b)}</b></div>
            {h.extra?.map(([k, v]) => <div key={k} className="tr"><i style={{ background: 'transparent' }} />{k}<span className="sp" /><b>{v}</b></div>)}
          </div>
        )}
      </div>
      <div className="pb-x" aria-hidden>{data.map((d) => <span key={d.key}>{d.label}</span>)}</div>
    </div>
  );
}

/* ---------- medidor radial (proporção entre 3 classes) ---------- */
export interface GaugePart { key: string; label: string; value: number; color: string }
export function RadialGauge({ parts, center, caption }: { parts: GaugePart[]; center: ReactNode; caption: string }) {
  const [focus, setFocus] = useState<string | null>(null);
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  const N = 66, start = 135, sweep = 270, r1 = 70, r2 = 92;
  const ticks = useMemo(() => {
    const bounds: { key: string; color: string; until: number }[] = [];
    let acc = 0;
    for (const p of parts) { acc += p.value / total; bounds.push({ key: p.key, color: p.color, until: acc }); }
    return Array.from({ length: N }, (_, i) => {
      const t = i / (N - 1);
      const seg = bounds.find((b) => t <= b.until + 1e-9) ?? bounds[bounds.length - 1];
      const a = ((start + t * sweep) * Math.PI) / 180;
      const long = i % 6 === 0;
      const rr1 = long ? r1 - 4 : r1;
      return { x1: 100 + rr1 * Math.cos(a), y1: 100 + rr1 * Math.sin(a), x2: 100 + r2 * Math.cos(a), y2: 100 + r2 * Math.sin(a), color: seg?.color ?? 'var(--c-muted)', key: seg?.key ?? '' };
    });
  }, [parts, total]);
  return (
    <div>
      <div className="gauge">
        <svg viewBox="0 0 200 178" role="img" aria-label={`${caption}: ${parts.map((p) => `${p.label} ${p.value}`).join(', ')}`}>
          {ticks.map((t, i) => <line key={i} className={cx('tick', focus && t.key !== focus && 'dim')} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke={t.color} />)}
        </svg>
        <div className="gauge-center"><b>{center}</b><span>{caption}</span></div>
      </div>
      <div className="gauge-legend">
        {parts.map((p) => (
          <button key={p.key} onMouseEnter={() => setFocus(p.key)} onMouseLeave={() => setFocus(null)} onFocus={() => setFocus(p.key)} onBlur={() => setFocus(null)}>
            <i style={{ background: p.color }} />{p.label}<b>{fmtInt(p.value)}</b><small>{Math.round((p.value / total) * 100)}%</small>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------- meta segmentada ---------- */
export interface GoalPart { key: string; label: string; value: number; color: string; display: string }
export function GoalBar({ parts, goal }: { parts: GoalPart[]; goal: number }) {
  const [tip, setTip] = useState<number | null>(null);
  const total = parts.reduce((s, p) => s + p.value, 0);
  const scale = Math.max(goal, total) || 1;
  const visible = parts.filter((p) => p.value > 0);
  let left = 0;
  return (
    <div className="goal">
      <div className="goal-track" role="img" aria-label={`Meta: ${parts.map((p) => `${p.label} ${p.display}`).join(', ')}`}>
        {visible.map((p, i) => {
          const w = (p.value / scale) * 100;
          const l = left; left += w;
          return (
            <div key={p.key} className={cx('goal-seg', i === visible.length - 1 && total >= goal && 'last')} style={{ width: `${w}%`, background: p.color }}
              onMouseEnter={() => setTip(i)} onMouseLeave={() => setTip(null)} tabIndex={0} onFocus={() => setTip(i)} onBlur={() => setTip(null)} aria-label={`${p.label}: ${p.display}`}>
              <span className="goal-dot" style={{ ['--dot' as string]: p.color }} />
              {tip === i && <div className="chart-tip" style={{ left: '50%', top: 0 }}><div className="tt">{p.label}</div><div className="tr"><i style={{ background: p.color }} />Vendas<span className="sp" /><b>{p.display}</b></div><div className="tr"><i />Da meta<span className="sp" /><b>{Math.round((p.value / (goal || 1)) * 100)}%</b></div></div>}
              <span hidden>{l}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- minigráfico ---------- */
export function Sparkline({ values, width = 120, height = 34, color = 'var(--c1)' }: { values: number[]; width?: number; height?: number; color?: string }) {
  if (values.length < 2) return null;
  const max = Math.max(...values), min = Math.min(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * width, height - 3 - ((v - min) / span) * (height - 6)] as const);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  return (
    <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <path d={`${d} L${width} ${height} L0 ${height} Z`} fill={color} opacity={0.1} />
      <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r={4} fill={color} stroke="var(--surface)" strokeWidth={2} />
    </svg>
  );
}

/* ---------- barras horizontais (uma série) ---------- */
export function HBars({ rows, color = 'var(--c1)' }: { rows: { key: string; label: string; value: number; display: string }[]; color?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="hbars">
      {rows.map((r, i) => (
        <div key={r.key} className="hbar" title={`${r.label}: ${r.display}`}>
          <span className="hl truncate">{r.label}</span>
          <span className="ht"><span className="hf" style={{ display: 'block', width: `${Math.max(2, (r.value / max) * 100)}%`, background: color, animationDelay: `${i * 50}ms` }} /></span>
          <span className="hv">{r.display}</span>
        </div>
      ))}
    </div>
  );
}

/* ---------- funil (ordinal: um tom, do escuro ao claro) ---------- */
export function Funnel({ steps }: { steps: { label: string; value: number }[] }) {
  const max = Math.max(1, steps[0]?.value ?? 1);
  const shades = ['var(--c1)', 'color-mix(in oklab, var(--c1) 80%, white)', 'color-mix(in oklab, var(--c1) 62%, white)', 'color-mix(in oklab, var(--c1) 48%, white)'];
  return (
    <div className="funnel">
      {steps.map((s, i) => (
        <div key={s.label} className="funnel-row">
          <span className="fl">{s.label}</span>
          <span><span className="fb" style={{ width: `${Math.max(8, (s.value / max) * 100)}%`, background: shades[i] ?? shades[3], color: i >= 2 ? 'var(--ink)' : '#fff', animationDelay: `${i * 80}ms` }}>{fmtInt(s.value)}</span></span>
          <span className="fp">{i === 0 ? '100%' : `${((s.value / max) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`}</span>
        </div>
      ))}
    </div>
  );
}

/* ---------- mapa de calor (sequencial, um tom) ---------- */
export function Heatmap({ rows, cols, values, unit }: { rows: string[]; cols: string[]; values: number[][]; unit: string }) {
  const [tip, setTip] = useState<{ r: number; c: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const max = Math.max(1, ...values.flat());
  const steps = [0.08, 0.25, 0.45, 0.68, 0.9];
  const colorOf = (v: number) => (v <= 0 ? 'var(--surface-3)' : `color-mix(in oklab, var(--c1) ${Math.round(steps[Math.min(4, Math.floor((v / max) * 4.999))] * 100)}%, var(--surface))`);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div className="heat" style={{ ['--cols' as string]: cols.length }} role="grid" aria-label={`Mapa de calor: ${unit}`}>
        <span />{cols.map((c, i) => <span key={c} className="hh">{i % 2 === 0 ? c : ''}</span>)}
        {rows.map((r, ri) => (
          <div key={r} style={{ display: 'contents' }} role="row">
            <span className="hd">{r}</span>
            {cols.map((c, ci) => (
              <span key={c} role="gridcell" tabIndex={0} className="hc" style={{ background: colorOf(values[ri][ci]) }} aria-label={`${r} ${c}h: ${values[ri][ci]} ${unit}`}
                onMouseEnter={() => setTip({ r: ri, c: ci })} onMouseLeave={() => setTip(null)} onFocus={() => setTip({ r: ri, c: ci })} onBlur={() => setTip(null)} />
            ))}
          </div>
        ))}
      </div>
      {tip && <div className="chart-tip" style={{ left: `${((tip.c + 1.5) / (cols.length + 1)) * 100}%`, top: `${((tip.r + 1) / (rows.length + 1)) * 100}%` }}><div className="tt">{rows[tip.r]}, {cols[tip.c]}h</div><div className="tr"><b>{values[tip.r][tip.c]}</b>&nbsp;{unit}</div></div>}
      <div className="heat-scale">menos{steps.map((s) => <i key={s} style={{ background: `color-mix(in oklab, var(--c1) ${s * 100}%, var(--surface))` }} />)}mais</div>
    </div>
  );
}

/* ---------- rosca (parte do todo, até 3 partes) ---------- */
export function Donut({ parts, center, caption }: { parts: { key: string; label: string; value: number; color: string }[]; center: ReactNode; caption: string }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  const R = 70, C = 2 * Math.PI * R, gap = 3;
  let off = 0;
  return (
    <div className="donut" role="img" aria-label={`${caption}: ${parts.map((p) => `${p.label} ${Math.round((p.value / total) * 100)}%`).join(', ')}`}>
      <svg width="170" height="170" viewBox="0 0 170 170">
        <circle cx="85" cy="85" r={R} fill="none" stroke="var(--surface-3)" strokeWidth="18" />
        {parts.map((p) => {
          const len = Math.max(0, (p.value / total) * C - gap);
          const el = <circle key={p.key} cx="85" cy="85" r={R} fill="none" stroke={p.color} strokeWidth="18" strokeLinecap="butt" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-off} />;
          off += (p.value / total) * C;
          return el;
        })}
      </svg>
      <div className="donut-center"><div><b>{center}</b><span>{caption}</span></div></div>
    </div>
  );
}

/* ---------- linha (uma série, com mira) ---------- */
export function LineChart({ points, format, height = 200, color = 'var(--c1)' }: { points: { label: string; long: string; value: number }[]; format: (v: number) => string; height?: number; color?: string }) {
  const [i, setI] = useState<number | null>(null);
  const W = 640, H = height, pad = { l: 46, r: 12, t: 12, b: 26 };
  const { max } = niceScale(Math.max(1, ...points.map((p) => p.value)), false);
  const x = (k: number) => pad.l + (k / Math.max(1, points.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const d = points.map((p, k) => `${k ? 'L' : 'M'}${x(k).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');
  const ticks = [0, 0.5, 1].map((t) => max * t);
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const k = Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (points.length - 1));
    setI(Math.max(0, Math.min(points.length - 1, k)));
  };
  return (
    <div className="line-chart">
      <svg viewBox={`0 0 ${W} ${H}`} onMouseMove={onMove} onMouseLeave={() => setI(null)} role="img" aria-label={`Série: ${points.map((p) => `${p.long} ${format(p.value)}`).join('; ')}`}>
        {ticks.map((t) => <g key={t}><line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--grid)" /><text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--ink-3)">{format(t)}</text></g>)}
        {points.map((p, k) => (k % Math.ceil(points.length / 8) === 0 ? <text key={p.label + k} x={x(k)} y={H - 6} textAnchor="middle" fontSize="11" fill="var(--ink-3)">{p.label}</text> : null))}
        <path d={`${d} L${x(points.length - 1)} ${y(0)} L${x(0)} ${y(0)} Z`} fill={color} opacity={0.1} />
        <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {i != null && <><line className="cross" x1={x(i)} x2={x(i)} y1={pad.t} y2={H - pad.b} /><circle cx={x(i)} cy={y(points[i].value)} r={5} fill={color} stroke="var(--surface)" strokeWidth={2} /></>}
      </svg>
      {i != null && <div className="chart-tip" style={{ left: `${(x(i) / W) * 100}%`, top: `${(y(points[i].value) / H) * 100}%` }}><div className="tt">{points[i].long}</div><div className="tr"><i style={{ background: color }} /><b>{format(points[i].value)}</b></div></div>}
    </div>
  );
}
