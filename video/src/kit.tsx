import React from 'react'
import { AbsoluteFill, Easing, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'

export const C = {
  bg: '#0d0c0a', panel: '#17150f', panel2: '#201d16', line: '#2f2b22', text: '#f3efe6', muted: '#a8a193',
  gold: '#d9a441', goldSoft: '#3a2d12', ok: '#5cc48f', okSoft: '#12281c', warn: '#e6a94a', warnSoft: '#2e2210',
  sim: '#b9a3f0', simSoft: '#231b36', bad: '#f0857c', badSoft: '#2f1715',
}
export const font = '"Segoe UI", "Inter", system-ui, -apple-system, Arial, sans-serif'
export const mono = 'Consolas, "SFMono-Regular", Menlo, monospace'
export const ease = Easing.bezier(0.22, 1, 0.36, 1)
export const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

export function useS(at: number, cfg: { damping?: number; mass?: number; stiffness?: number } = {}) {
  const f = useCurrentFrame()
  const { fps } = useVideoConfig()
  return spring({ frame: f - at, fps, config: { damping: 18, mass: 0.8, stiffness: 110, ...cfg } })
}

/** Fade + rise in at `at` (frames, in the current Sequence), optional fade out at `out`. */
export function Rise({ at = 0, out, dist = 36, children, style }: { at?: number; out?: number; dist?: number; children: React.ReactNode; style?: React.CSSProperties }) {
  const f = useCurrentFrame()
  const s = useS(at)
  const o = out !== undefined ? interpolate(f, [out, out + 10], [1, 0], clamp) : 1
  return <div style={{ opacity: Math.min(s, 1) * o, transform: `translateY(${(1 - s) * dist}px)`, ...style }}>{children}</div>
}

export function Mark({ size = 44 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      <rect x="2" y="2" width="44" height="44" rx="10" fill={C.gold} />
      <path d="M14 30h20M17 30c0-8 4-13 7-13s7 5 7 13" stroke={C.bg} strokeWidth="3.6" fill="none" strokeLinecap="round" />
      <circle cx="24" cy="14" r="2.6" fill={C.bg} />
    </svg>
  )
}

export function Wordmark({ scale = 1 }: { scale?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 * scale }}>
      <Mark size={44 * scale} />
      <div style={{ fontSize: 40 * scale, fontWeight: 700, letterSpacing: -0.5 * scale, color: C.text }}>Ballast</div>
    </div>
  )
}

type Tone = 'ok' | 'warn' | 'sim' | 'gold' | 'muted' | 'bad'
const tones: Record<Tone, [string, string]> = {
  ok: [C.ok, C.okSoft], warn: [C.warn, C.warnSoft], sim: [C.sim, C.simSoft], gold: [C.gold, C.goldSoft], muted: [C.muted, C.panel2], bad: [C.bad, C.badSoft],
}
export function Badge({ tone = 'ok', children, size = 22 }: { tone?: Tone; children: React.ReactNode; size?: number }) {
  const [fg, bg] = tones[tone]
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, padding: `${size * 0.36}px ${size * 0.8}px`, borderRadius: 999, background: bg, color: fg, border: `1.5px solid ${fg}55`, fontSize: size, fontWeight: 700, letterSpacing: 0.6, whiteSpace: 'nowrap' }}>
      <span style={{ width: size * 0.42, height: size * 0.42, borderRadius: 99, background: fg }} />
      {children}
    </span>
  )
}

export function Card({ children, style, tone }: { children: React.ReactNode; style?: React.CSSProperties; tone?: Tone }) {
  const border = tone ? tones[tone][0] + '66' : C.line
  return <div style={{ background: C.panel, border: `1.5px solid ${border}`, borderRadius: 22, padding: '26px 30px', ...style }}>{children}</div>
}

/** Real screenshot inside a browser frame with a slow push-in. */
export function Shot({ src, url, at = 0, w = 1040, zoom = [1, 1.06], origin = '50% 30%', style }: { src: string; url: string; at?: number; w?: number; zoom?: [number, number]; origin?: string; style?: React.CSSProperties }) {
  const f = useCurrentFrame()
  const s = useS(at)
  const z = interpolate(f, [at, at + 420], zoom, { ...clamp, easing: Easing.out(Easing.quad) })
  const h = (w * 1080) / 1920
  return (
    <div style={{ width: w, opacity: Math.min(1, s), transform: `translateY(${(1 - s) * 40}px) scale(${0.97 + 0.03 * s})`, borderRadius: 18, overflow: 'hidden', border: `1.5px solid ${C.line}`, boxShadow: '0 30px 80px rgba(0,0,0,.55)', background: '#111', ...style }}>
      <div style={{ height: 40, background: '#1b1915', display: 'flex', alignItems: 'center', gap: 8, padding: '0 16px', borderBottom: `1px solid ${C.line}` }}>
        {['#e0655a', '#e3b341', '#58b368'].map((c) => <span key={c} style={{ width: 11, height: 11, borderRadius: 99, background: c }} />)}
        <div style={{ marginLeft: 14, flex: 1, height: 24, borderRadius: 7, background: '#0f0e0c', color: C.muted, fontFamily: mono, fontSize: 13, display: 'flex', alignItems: 'center', padding: '0 12px', overflow: 'hidden', whiteSpace: 'nowrap' }}>{url}</div>
      </div>
      <div style={{ width: w, height: h, overflow: 'hidden' }}>
        <Img src={staticFile(`shots/${src}.png`)} style={{ width: w, height: h, transform: `scale(${z})`, transformOrigin: origin }} />
      </div>
    </div>
  )
}

export function Count({ from, to, at, dur = 40, dp = 2, suffix = '' }: { from: number; to: number; at: number; dur?: number; dp?: number; suffix?: string }) {
  const f = useCurrentFrame()
  const v = interpolate(f, [at, at + dur], [from, to], { ...clamp, easing: ease })
  return <span style={{ fontVariantNumeric: 'tabular-nums' }}>{v.toFixed(dp)}{suffix}</span>
}

export function Hash({ h, block }: { h: string; block?: number | string }) {
  return (
    <div style={{ fontFamily: mono, fontSize: 19, color: C.muted }}>
      tx <span style={{ color: C.gold }}>{h.slice(0, 12)}…{h.slice(-6)}</span>{block ? <> · block {block}</> : null}
    </div>
  )
}

export function Bg() {
  const f = useCurrentFrame()
  const x = 50 + Math.sin(f / 240) * 8
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <AbsoluteFill style={{ background: `radial-gradient(1100px 700px at ${x}% -10%, rgba(217,164,65,.16), transparent 62%), radial-gradient(900px 600px at 105% 110%, rgba(92,196,143,.07), transparent 60%)` }} />
      <AbsoluteFill style={{ opacity: 0.05, backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)', backgroundSize: '64px 64px' }} />
    </AbsoluteFill>
  )
}
