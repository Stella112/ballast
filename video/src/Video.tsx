import React from 'react'
import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame } from 'remotion'
import tl from './timeline.json'
import { Badge, Bg, C, Card, Count, Hash, Rise, Shot, Wordmark, clamp, ease, font, mono, useS } from './kit'

type Scene = (typeof tl.scenes)[number]
const PAD = 10 // frames before audio inside each scene
const sc = (id: string) => tl.scenes.find((s) => s.id === id) as Scene
/** frame (inside the scene Sequence) at which caption i starts */
const cue = (s: Scene, i: number) => PAD + (s.captions[Math.min(i, s.captions.length - 1)]?.from ?? 0)

const EXP = 'explorer.test.mezo.org/tx/'
const TX = {
  pay: '0xbec250c4a877f3b637b8935e1713115d8d5989626614c9e97f3cdf12938bbd5e',
  keeper: '0x93bbadeb9ad67c95f32ca5507ee6b7d9b28cec00d4c327dd857868aaf4b1a9cd',
  cap: '0xb52b86935a203d3fe55ed858d69bbefedb655703b43a1539e2108789dac098a0',
  list: '0x2d8e01521db67bb4542be4383d3f1a053f219c17a890c19f99995ccd630f857a',
  release: '0x43626e6369e6e8304ee33348492fe1b0c45f08333d404e8937a36bd5c208b8d9',
  hopen: '0x09d17ce366ce7ef78439386f04b6238476f19d99a51a4a74651cf3c66c3cc447',
  hclose: '0xd6a52ed49876862609d15578cf56b51b5372a38a2f45065aa8337675363ded54',
  base: '0x666b7277e706eef1044e650b138a68247d50e003bfb112758990578180b45c75',
}

const H1: React.CSSProperties = { fontSize: 64, fontWeight: 750, letterSpacing: -1.2, lineHeight: 1.08, color: C.text }
const Lbl: React.CSSProperties = { fontSize: 20, letterSpacing: 2.2, textTransform: 'uppercase', color: C.muted, fontWeight: 650 }
const Big: React.CSSProperties = { fontSize: 46, fontWeight: 750, color: C.text, fontVariantNumeric: 'tabular-nums', letterSpacing: -0.6 }
const Body: React.CSSProperties = { fontSize: 27, lineHeight: 1.35, color: C.muted }
const Stage: React.CSSProperties = { position: 'absolute', left: 96, right: 96, top: 132, bottom: 170 }

// ---------------------------------------------------------------- scenes

function Hook({ s }: { s: Scene }) {
  const cards: [string, string, string, 'bad' | 'warn' | 'muted'][] = [
    ['Redemption', 'Anyone can swap MUSD for BTC. It comes from the lowest-ratio loans first, even healthy ones.', '01', 'warn'],
    ['Liquidation', 'Below a 110% collateral ratio the loan is closed and the collateral is lost.', '02', 'bad'],
    ['Idle income', 'What you earn stays in your wallet. The loan sees none of it unless you move it by hand.', '03', 'muted'],
  ]
  const at = [cue(s, 1) - 14, cue(s, 1) + 16, cue(s, 2)]
  return (
    <div style={Stage}>
      <Rise at={6} style={{ marginTop: 30 }}><div style={{ ...H1, fontSize: 76 }}>Two ways to lose your Bitcoin.<br /><span style={{ color: C.gold }}>And your income isn&apos;t helping.</span></div></Rise>
      <div style={{ display: 'flex', gap: 28, marginTop: 64 }}>
        {cards.map(([t, d, n, tone], i) => (
          <Rise key={t} at={at[i]} style={{ flex: 1 }}>
            <Card tone={tone} style={{ height: 300 }}>
              <div style={{ fontFamily: mono, fontSize: 22, color: C.muted }}>{n}</div>
              <div style={{ fontSize: 44, fontWeight: 750, color: C.text, marginTop: 14 }}>{t}</div>
              <div style={{ ...Body, marginTop: 14 }}>{d}</div>
            </Card>
          </Rise>
        ))}
      </div>
    </div>
  )
}

function Lane({ at, label, amount, pct, color, y }: { at: number; label: string; amount: string; pct: number; color: string; y: number }) {
  const f = useCurrentFrame()
  const p = interpolate(f, [at, at + 28], [0, 1], { ...clamp, easing: ease })
  return (
    <div style={{ position: 'absolute', left: 560, top: y, width: 560, opacity: p }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={{ fontSize: 28, fontWeight: 650, color: C.text }}>{label}</div>
        <div style={{ fontSize: 28, fontFamily: mono, color }}>{amount}</div>
      </div>
      <div style={{ height: 16, borderRadius: 99, background: C.panel2, marginTop: 10, overflow: 'hidden' }}>
        <div style={{ width: `${pct * p}%`, height: '100%', background: color, borderRadius: 99 }} />
      </div>
    </div>
  )
}

function Pitch({ s }: { s: Scene }) {
  const f = useCurrentFrame()
  const split = cue(s, 2)
  const move = cue(s, 4)
  const coin = interpolate(f, [split, split + 26], [0, 1], { ...clamp, easing: ease })
  const intro = interpolate(f, [cue(s, 1) - 8, cue(s, 1) + 6], [1, 0], clamp)
  const dia = useS(cue(s, 1))
  const pos = interpolate(f, [move, move + 60], [5, 9], { ...clamp, easing: ease })
  return (
    <>
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', opacity: intro, transform: `scale(${1 + (1 - intro) * 0.06})` }}>
        <Rise at={2}><Wordmark scale={3.1} /></Rise>
        <Rise at={12} style={{ marginTop: 34 }}><div style={{ fontSize: 46, color: C.muted, fontWeight: 500 }}>The cash-flow autopilot for Bitcoin-backed loans</div></Rise>
        <Rise at={24} style={{ marginTop: 30 }}><Badge tone="gold" size={24}>Live on Mezo testnet</Badge></Rise>
      </AbsoluteFill>
      <div style={{ ...Stage, opacity: Math.min(1, dia) }}>
        <div style={Lbl}>How it works</div>
        <div style={{ position: 'absolute', left: 0, top: 70, width: 470 }}>
          <Card tone="gold" style={{ height: 250 }}>
            <div style={Lbl}>Ballast Account · NFT</div>
            <div style={{ fontSize: 38, fontWeight: 750, color: C.text, marginTop: 12 }}>Owns your Mezo loan</div>
            <div style={{ ...Body, fontSize: 24, marginTop: 10 }}>Whoever holds the NFT controls the account.</div>
          </Card>
          <div style={{ marginTop: 26, opacity: coin }}>
            <Card style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
              <div style={{ width: 64, height: 64, borderRadius: 99, background: C.gold, color: C.bg, fontSize: 30, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `translateX(${(1 - coin) * -140}px)` }}>$</div>
              <div><div style={Lbl}>Incoming payment</div><div style={{ ...Big, fontSize: 40 }}>100 MUSD</div></div>
            </Card>
          </div>
        </div>
        <svg style={{ position: 'absolute', left: 470, top: 300, opacity: coin }} width="90" height="220" viewBox="0 0 90 220">
          {[20, 110, 200].map((y) => <path key={y} d={`M0 110 C 40 110, 40 ${y}, 90 ${y}`} stroke={C.gold} strokeWidth="2.5" fill="none" strokeDasharray="6 7" strokeDashoffset={-f} />)}
        </svg>
        <Lane at={cue(s, 3)} label="Repays the loan" amount="20 MUSD" pct={20} color={C.ok} y={292} />
        <Lane at={cue(s, 3) + 22} label="Hedge reserve" amount="5 MUSD" pct={5} color={C.sim} y={382} />
        <Lane at={cue(s, 3) + 44} label="Yours to spend" amount="75 MUSD" pct={75} color={C.gold} y={472} />
        <Rise at={move - 6} style={{ position: 'absolute', right: 0, top: 70, width: 520 }}>
          <Card tone="ok">
            <div style={Lbl}>Collateral ratio</div>
            <div style={{ ...Big, fontSize: 64, color: C.ok, marginTop: 6 }}><Count from={134.15} to={135.33} at={move} dur={50} suffix="%" /></div>
            <div style={{ ...Lbl, marginTop: 26 }}>Redemption line</div>
            <div style={{ display: 'flex', gap: 9, marginTop: 14, alignItems: 'center' }}>
              {Array.from({ length: 14 }).map((_, i) => {
                const me = Math.round(pos) === i
                return <div key={i} style={{ width: me ? 30 : 22, height: me ? 30 : 22, borderRadius: 99, background: me ? C.gold : i < 3 ? C.bad : C.line, boxShadow: me ? `0 0 22px ${C.gold}` : undefined }} />
              })}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontSize: 19, color: C.muted }}><span>redeemed first</span><span>safer →</span></div>
          </Card>
        </Rise>
      </div>
    </>
  )
}

function Row({ at, k, v, color = C.text }: { at: number; k: string; v: React.ReactNode; color?: string }) {
  return (
    <Rise at={at}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '15px 0', borderBottom: `1px solid ${C.line}` }}>
        <div style={{ fontSize: 26, color: C.muted }}>{k}</div>
        <div style={{ fontSize: 34, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>{v}</div>
      </div>
    </Rise>
  )
}

function Side({ children, title, badge }: { children: React.ReactNode; title: string; badge?: React.ReactNode }) {
  return (
    <div style={{ position: 'absolute', right: 0, top: 0, width: 640 }}>
      <Rise at={4}>{badge}</Rise>
      <Rise at={10} style={{ marginTop: 20 }}><div style={{ ...H1, fontSize: 50 }}>{title}</div></Rise>
      <div style={{ marginTop: 18 }}>{children}</div>
    </div>
  )
}

function Proof({ s }: { s: Scene }) {
  const f = useCurrentFrame()
  const swap = cue(s, 2)
  const a = interpolate(f, [swap - 8, swap + 8], [1, 0], clamp)
  return (
    <div style={Stage}>
      <div style={{ position: 'absolute', left: 0, top: 0, opacity: a }}><Shot src="app-paylink" url="ballast-tawny.vercel.app/pay/a/1" at={2} w={1040} zoom={[1.02, 1.12]} origin="50% 55%" /></div>
      <div style={{ position: 'absolute', left: 0, top: 0, opacity: 1 - a }}><Shot src="tx-pay" url={EXP + TX.pay} at={swap - 8} w={1040} zoom={[1, 1.1]} origin="30% 25%" /></div>
      <Side title="One payment. One transaction." badge={<Badge tone="ok">Real transaction · Mezo testnet</Badge>}>
        <Row at={cue(s, 1)} k="Customer pays" v="100 MUSD" />
        <Row at={cue(s, 2)} k="To the owner" v="75 MUSD" color={C.gold} />
        <Row at={cue(s, 2) + 26} k="Hedge reserve" v="5 MUSD" color={C.sim} />
        <Row at={cue(s, 2) + 52} k="Loan repaid" v="20 MUSD" color={C.ok} />
        <Row at={cue(s, 3)} k="Collateral ratio" v={<><span style={{ color: C.muted }}>134.15% → </span><Count from={134.15} to={135.33} at={cue(s, 3) + 10} dur={45} suffix="%" /></>} color={C.ok} />
        <Rise at={cue(s, 4)} style={{ marginTop: 22 }}><Hash h={TX.pay} block={16791774} /></Rise>
      </Side>
    </div>
  )
}

function Radar({ s }: { s: Scene }) {
  const f = useCurrentFrame()
  const second = cue(s, 2)
  const a = interpolate(f, [second - 8, second + 8], [1, 0], clamp)
  const chips = ['Position in the redemption line', 'MUSD ahead of you', 'Liquidation price', 'Repay to pass the next 10 or 50 loans']
  return (
    <div style={Stage}>
      <div style={{ position: 'absolute', left: 0, top: 0, opacity: a }}><Shot src="app-radar" url="ballast-tawny.vercel.app/app/radar" at={2} w={1180} zoom={[1, 1.07]} origin="50% 40%" /></div>
      <div style={{ position: 'absolute', left: 0, top: 0, opacity: 1 - a }}><Shot src="app-radar-2" url="ballast-tawny.vercel.app/app/radar" at={second - 8} w={1180} zoom={[1.02, 1.1]} origin="50% 45%" /></div>
      <div style={{ position: 'absolute', right: 0, top: 0, width: 500 }}>
        <Rise at={4}><Badge tone="gold">Read live from Mezo&apos;s sorted list</Badge></Rise>
        <Rise at={10} style={{ marginTop: 20 }}><div style={{ ...H1, fontSize: 50 }}>Redemption Radar</div></Rise>
        <div style={{ marginTop: 26, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {chips.map((c, i) => (
            <Rise key={c} at={cue(s, 1) + i * 34}>
              <Card style={{ padding: '18px 24px', display: 'flex', gap: 16, alignItems: 'center' }}>
                <span style={{ width: 12, height: 12, borderRadius: 99, background: C.gold }} />
                <span style={{ fontSize: 27, color: C.text, fontWeight: 600 }}>{c}</span>
              </Card>
            </Rise>
          ))}
        </div>
        <Rise at={cue(s, 3) + 20} style={{ marginTop: 22 }}><div style={{ fontSize: 21, color: C.muted }}>A snapshot at one block, not a guarantee.</div></Rise>
      </div>
    </div>
  )
}

function Keeper({ s }: { s: Scene }) {
  const f = useCurrentFrame()
  const swap = cue(s, 3)
  const a = interpolate(f, [swap - 8, swap + 8], [1, 0], clamp)
  return (
    <div style={Stage}>
      <div style={{ position: 'absolute', left: 0, top: 0, opacity: a }}><Shot src="tx-keeper" url={EXP + TX.keeper} at={2} w={1040} zoom={[1, 1.08]} origin="30% 25%" /></div>
      <div style={{ position: 'absolute', left: 0, top: 0, opacity: 1 - a }}><Shot src="tx-cap" url={EXP + TX.cap} at={swap - 8} w={1040} zoom={[1, 1.08]} origin="30% 25%" /></div>
      <div style={{ position: 'absolute', right: 0, top: 0, width: 640 }}>
        <div style={{ opacity: a }}>
          <Rise at={4}><Badge tone="ok">Real transaction · keeper</Badge></Rise>
          <Rise at={10} style={{ marginTop: 20 }}><div style={{ ...H1, fontSize: 50 }}>Anyone can trigger it. Nobody can redirect it.</div></Rise>
          <div style={{ marginTop: 14 }}>
            <Row at={cue(s, 1)} k="Sent straight to the account" v="50 MUSD" />
            <Row at={cue(s, 1) + 30} k="Policy applied by" v="a non-owner wallet" color={C.gold} />
            <Row at={cue(s, 2)} k="Owner / reserve / repaid" v="37.5 / 2.5 / 10" color={C.ok} />
          </div>
        </div>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, opacity: 1 - a }}>
          <Rise at={swap}><Badge tone="ok">Real transaction · minimum-debt cap</Badge></Rise>
          <Rise at={swap + 6} style={{ marginTop: 20 }}><div style={{ ...H1, fontSize: 50 }}>Repayment stops at Mezo&apos;s minimum.</div></Rise>
          <div style={{ marginTop: 14 }}>
            <Row at={swap + 14} k="Paid, at a 60% repay policy" v="300 MUSD" />
            <Row at={swap + 34} k="Repaid (all the room left)" v="168.80 MUSD" color={C.ok} />
            <Row at={swap + 54} k="Excess to the owner" v="131.20 MUSD" color={C.gold} />
          </div>
          <Rise at={swap + 70} style={{ marginTop: 18 }}><div style={{ fontSize: 20, color: C.muted }}>Run on the v2 deployment, 14 Nov.</div></Rise>
        </div>
      </div>
    </div>
  )
}

function Node({ t, sub, tone = 'muted' }: { t: string; sub: string; tone?: 'muted' | 'gold' | 'ok' }) {
  return (
    <Card tone={tone} style={{ width: 380, padding: '22px 26px' }}>
      <div style={{ fontSize: 32, fontWeight: 750, color: C.text }}>{t}</div>
      <div style={{ fontSize: 21, color: C.muted, marginTop: 6 }}>{sub}</div>
    </Card>
  )
}

function Nft({ s }: { s: Scene }) {
  const f = useCurrentFrame()
  const a = cue(s, 1), b = cue(s, 2)
  const x = interpolate(f, [a, a + 34, b, b + 34], [0, 1, 1, 2], { ...clamp, easing: ease })
  return (
    <div style={Stage}>
      <Rise at={4}><Badge tone="ok">Real transactions · loan open throughout</Badge></Rise>
      <Rise at={10} style={{ marginTop: 18 }}><div style={{ ...H1, fontSize: 54 }}>The account is an NFT. Sell it whole.</div></Rise>
      <div style={{ position: 'relative', marginTop: 62, height: 128 }}>
        <div style={{ position: 'absolute', left: 0 }}><Node t="Owner wallet" sub="holds the account NFT" /></div>
        <div style={{ position: 'absolute', left: 674 }}><Node t="Escrow contract" sub="listed with the loan open" tone="gold" /></div>
        <div style={{ position: 'absolute', left: 1348 }}><Node t="Buyer wallet" sub="now controls the account" tone="ok" /></div>
        <div style={{ position: 'absolute', top: -50, left: 286 + x * 674, width: 78, height: 78, borderRadius: 18, background: C.gold, color: C.bg, fontWeight: 800, fontSize: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 0 34px ${C.gold}88`, transform: 'rotate(-6deg)' }}>NFT #1</div>
      </div>
      <div style={{ display: 'flex', gap: 48, marginTop: 26, justifyContent: 'center' }}>
        <Shot src="tx-escrow-list" url={EXP + TX.list} at={a} w={690} zoom={[1.25, 1.34]} origin="18% 42%" />
        <Shot src="tx-escrow-release" url={EXP + TX.release} at={b} w={690} zoom={[1.25, 1.34]} origin="18% 42%" />
      </div>
    </div>
  )
}

function Hedge({ s }: { s: Scene }) {
  const f = useCurrentFrame()
  const swap = cue(s, 2)
  const a = interpolate(f, [swap - 8, swap + 8], [1, 0], clamp)
  return (
    <div style={Stage}>
      <div style={{ position: 'absolute', left: 0, top: 0, opacity: a }}><Shot src="tx-hedge-open" url={EXP + TX.hopen} at={2} w={1000} zoom={[1, 1.08]} origin="30% 25%" /></div>
      <div style={{ position: 'absolute', left: 0, top: 0, opacity: 1 - a }}><Shot src="tx-hedge-close" url={EXP + TX.hclose} at={swap - 8} w={1000} zoom={[1, 1.08]} origin="30% 25%" /></div>
      <div style={{ position: 'absolute', right: 0, top: 0, width: 690 }}>
        <Rise at={4}><Badge tone="ok">Real transactions · open and close</Badge></Rise>
        <Rise at={10} style={{ marginTop: 20 }}><div style={{ ...H1, fontSize: 48 }}>An optional hedge, opened by the account.</div></Rise>
        <div style={{ marginTop: 10 }}>
          <Row at={cue(s, 1)} k="From the hedge reserve to Morpho Blue" v="80 MUSD" color={C.sim} />
          <Row at={cue(s, 1) + 34} k="BTC borrowed, sold on Mezo Pools" v="0.0005 BTC" />
          <Row at={cue(s, 2)} k="Closed back into the account" v="cost 0.78 MUSD" color={C.gold} />
        </div>
        <Rise at={cue(s, 4)} style={{ marginTop: 22 }}>
          <Card tone="sim" style={{ padding: '18px 24px' }}>
            <Badge tone="sim" size={19}>SIMULATED · not a real price move</Badge>
            <div style={{ fontSize: 25, color: C.text, marginTop: 12 }}>If BTC fell 20%, closing this short would put about <b>7.5 MUSD</b> toward the loan.</div>
          </Card>
        </Rise>
      </div>
    </div>
  )
}

function Base({ s }: { s: Scene }) {
  const f = useCurrentFrame()
  const flow = (at: number) => interpolate(f, [at, at + 40], [0, 1], { ...clamp, easing: ease })
  const lanes: [number, string, string, React.ReactNode, string][] = [
    [cue(s, 1), 'USDC', 'Wormhole token bridge → swapped to MUSD → invoice paid', <Badge key="a" tone="ok" size={20}>Proven live</Badge>, C.ok],
    [cue(s, 3), 'MUSD', 'Ballast gateway → Wormhole NTT → account → keeper', <Badge key="b" tone="warn" size={20}>Built · waiting on testnet guardians</Badge>, C.warn],
  ]
  return (
    <div style={Stage}>
      <Rise at={4}><div style={Lbl}>Pay from Base</div></Rise>
      <Rise at={10} style={{ marginTop: 14 }}><div style={{ ...H1, fontSize: 54 }}>Payers on Base can pay a Mezo borrower.</div></Rise>
      <div style={{ display: 'flex', gap: 40, marginTop: 34 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 26 }}>
          {lanes.map(([at, asset, path, badge, color]) => (
            <Rise key={asset} at={at}>
              <Card style={{ padding: '24px 28px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
                  <div style={{ fontSize: 34, fontWeight: 750, color: C.text, width: 120 }}>{asset}</div>
                  {badge}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 18 }}>
                  <div style={{ fontSize: 22, color: C.muted, width: 150 }}>Base Sepolia</div>
                  <div style={{ flex: 1, height: 6, borderRadius: 9, background: C.panel2, overflow: 'hidden' }}><div style={{ width: `${flow(at + 10) * 100}%`, height: '100%', background: color }} /></div>
                  <div style={{ fontSize: 22, color: C.muted, width: 130, textAlign: 'right' }}>Mezo testnet</div>
                </div>
                <div style={{ fontSize: 22, color: C.muted, marginTop: 14 }}>{path}</div>
              </Card>
            </Rise>
          ))}
        </div>
        <Shot src="tx-base-settle" url={EXP + TX.base} at={cue(s, 2)} w={860} zoom={[1, 1.08]} origin="30% 25%" />
      </div>
    </div>
  )
}

function Close({ s }: { s: Scene }) {
  const f = useCurrentFrame()
  const end = cue(s, 4)
  const a = interpolate(f, [end - 10, end + 8], [1, 0], clamp)
  const limits = ['Testnet only. Unaudited.', 'Morpho Blue on Mezo testnet was deployed and funded by Ballast.', 'A redemption position is a snapshot, not a guarantee.', 'Every step shown is backed by a transaction link.']
  return (
    <>
      <div style={{ ...Stage, opacity: a }}>
        <Rise at={4}><div style={Lbl}>Stated openly</div></Rise>
        <div style={{ marginTop: 26, display: 'flex', flexDirection: 'column', gap: 20, width: 1300 }}>
          {limits.map((l, i) => (
            <Rise key={l} at={cue(s, Math.min(i, 3)) + (i === 0 ? 0 : 0)}>
              <Card style={{ padding: '22px 28px', display: 'flex', gap: 18, alignItems: 'center' }}>
                <span style={{ width: 12, height: 12, borderRadius: 99, background: i === 3 ? C.ok : C.warn }} />
                <span style={{ fontSize: 32, color: C.text }}>{l}</span>
              </Card>
            </Rise>
          ))}
        </div>
      </div>
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', opacity: 1 - a }}>
        <Rise at={end}><Wordmark scale={3.2} /></Rise>
        <Rise at={end + 14} style={{ marginTop: 36 }}><div style={{ fontSize: 54, fontWeight: 650, color: C.text }}>Protect your Bitcoin. <span style={{ color: C.gold }}>Strengthen your loan.</span></div></Rise>
        <Rise at={end + 34} style={{ marginTop: 40 }}><div style={{ fontFamily: mono, fontSize: 28, color: C.muted }}>ballast-tawny.vercel.app · github.com/Stella112/ballast</div></Rise>
      </AbsoluteFill>
    </>
  )
}

// ---------------------------------------------------------------- shell

const SCENES: Record<string, [string, (p: { s: Scene }) => React.ReactElement]> = {
  hook: ['The problem', Hook], pitch: ['The pitch', Pitch], proof: ['Live proof', Proof], radar: ['Redemption Radar', Radar],
  keeper: ['Keeper and cap', Keeper], nft: ['Sell the account', Nft], hedge: ['Hedge', Hedge], base: ['Pay from Base', Base], close: ['Limits', Close],
}

function Caption({ s }: { s: Scene }) {
  const f = useCurrentFrame() - PAD
  const c = s.captions.find((x) => f >= x.from && f < x.to)
  if (!c) return null
  const o = interpolate(f, [c.from, c.from + 5, c.to - 4, c.to], [0, 1, 1, 0], clamp)
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 62, display: 'flex', justifyContent: 'center', opacity: o }}>
      <div style={{ maxWidth: 1500, padding: '16px 34px', borderRadius: 16, background: 'rgba(8,7,6,.82)', border: `1px solid ${C.line}`, color: C.text, fontSize: 34, fontWeight: 550, textAlign: 'center', lineHeight: 1.25 }}>{c.text}</div>
    </div>
  )
}

function Chrome({ label }: { label: string }) {
  const f = useCurrentFrame()
  return (
    <>
      <div style={{ position: 'absolute', left: 96, top: 52, display: 'flex', alignItems: 'center', gap: 22 }}>
        <Wordmark scale={0.8} />
        <span style={{ width: 1, height: 26, background: C.line }} />
        <span style={{ fontSize: 22, color: C.muted, letterSpacing: 1.4, textTransform: 'uppercase', fontWeight: 600 }}>{label}</span>
      </div>
      <div style={{ position: 'absolute', right: 96, top: 54 }}><Badge tone="muted" size={18}>Mezo testnet · unaudited</Badge></div>
      <div style={{ position: 'absolute', left: 0, bottom: 0, height: 6, width: `${(f / tl.total) * 100}%`, background: C.gold }} />
    </>
  )
}

export const Video: React.FC = () => {
  const f = useCurrentFrame()
  const cur = tl.scenes.find((s) => f >= s.from && f < s.from + s.len) ?? tl.scenes[tl.scenes.length - 1]
  return (
    <AbsoluteFill style={{ fontFamily: font, color: C.text }}>
      <Bg />
      {tl.scenes.map((s) => {
        const [, Comp] = SCENES[s.id]
        return (
          <Sequence key={s.id} from={s.from} durationInFrames={s.len}>
            <SceneFade len={s.len}><Comp s={s} /><Caption s={s} /></SceneFade>
            <Sequence from={PAD}><Audio src={staticFile(`${s.id}.mp3`)} /></Sequence>
          </Sequence>
        )
      })}
      <Chrome label={SCENES[cur.id][0]} />
    </AbsoluteFill>
  )
}

function SceneFade({ len, children }: { len: number; children: React.ReactNode }) {
  const f = useCurrentFrame()
  const o = interpolate(f, [0, 8, len - 8, len], [0, 1, 1, 0], clamp)
  return <AbsoluteFill style={{ opacity: o }}>{children}</AbsoluteFill>
}
