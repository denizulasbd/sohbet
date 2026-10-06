import { useEffect, useMemo, useRef, useState } from 'react'
import type { Msg, ReasoningConfig } from '../types'
import { LEVELS, levelLabel } from '../reasoning'
import Markdown from './Markdown'
import { Copy, Level, Next } from './Icons'

const sec = (ms: number) => (Math.max(ms, 0) / 1000).toFixed(1).replace('.', ',')
const fmtSec = (ms: number) => sec(ms) + ' sn'
const fmtTok = (n: number) => (n >= 1000 ? (n / 1000).toFixed(1).replace('.', ',') + 'K' : String(n))
const estTokens = (s: string) => Math.round(s.length / 3.5)

// ---------------------------------------------------------------------------------------------
// Düşünce metnini adımlara böler: "**Başlık**" / "# Başlık" satırı yeni adım açar; başlıksız metinde her paragraf bir adımdır.
interface Step { title?: string; body: string }
const HEAD = /^(?:\*\*([^*\n]+)\*\*|#{1,4}\s+(.+?))\s*:?\s*$/

function parseSteps(text: string): Step[] {
  let paras = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
  if (paras.length === 1 && paras[0].includes('\n')) paras = paras[0].split('\n').map((p) => p.trim()).filter(Boolean)
  const steps: Step[] = []
  for (const p of paras) {
    const m = HEAD.exec(p)
    if (m) steps.push({ title: (m[1] || m[2]).trim(), body: '' })
    else if (steps.length && steps[steps.length - 1].title !== undefined) {
      const s = steps[steps.length - 1]
      s.body = s.body ? s.body + '\n\n' + p : p
    } else steps.push({ body: p })
  }
  return steps
}

function headline(s?: Step): string {
  if (!s) return ''
  const t = s.title ?? s.body.replace(/[*`#_]/g, '').split(/(?<=[.!?:])\s/)[0]
  return t.length > 80 ? t.slice(0, 79) + '…' : t
}

function useNow(active: boolean) {
  const [n, setN] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setN(Date.now()), 100)
    return () => clearInterval(t)
  }, [active])
  return n
}

// ---------------------------------------------------------------------------------------------
// Düşünme penceresi: model düşünürken açık ve canlı; cevap başlayınca kendiliğinden daralır, tıklayınca yeniden açılır.
export function ReasoningPanel({ msg, live }: { msg: Msg; live: boolean }) {
  const think = msg.think!
  const text = msg.thinking ?? ''
  const now = useNow(live)
  const [open, setOpen] = useState(live)
  const [view, setView] = useState<'steps' | 'raw'>('steps')
  const [copied, setCopied] = useState(false)
  const touched = useRef(false) // kullanıcı elle açtı/kapattıysa otomatik daraltma yapma
  const wasLive = useRef(live)
  const scRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  useEffect(() => {
    if (wasLive.current && !live && !touched.current) setOpen(false)
    wasLive.current = live
  }, [live])

  useEffect(() => {
    const el = scRef.current
    if (el && live && open && stick.current) el.scrollTop = el.scrollHeight
  }, [text, live, open, view])

  // Tamamlanmış düşünceyi yeniden açınca baştan okunsun.
  useEffect(() => {
    if (open && !wasLive.current && scRef.current) scRef.current.scrollTop = 0
  }, [open])

  const steps = useMemo(() => parseSteps(text), [text])
  const elapsed = (think.end ?? (live ? now : think.start + (msg.ms ?? 0))) - think.start
  const est = estTokens(text)
  const tokens = think.tokens ?? est
  const exact = think.tokens != null
  const rate = elapsed > 800 && est > 0 ? Math.round(est / (elapsed / 1000)) : 0
  const hidden = !text && think.requested

  const sub = live
    ? text ? headline(steps[steps.length - 1]) : hidden && elapsed > 4000 ? 'İçerik bu sağlayıcıda gizli olabilir · model düşünmeye devam ediyor' : 'Model düşünüyor…'
    : text ? `${exact ? '' : '~'}${fmtTok(tokens)} token · ${steps.length} adım` : exact ? `${fmtTok(tokens)} token · içerik gizli` : 'içerik paylaşılmadı'

  const toggle = () => { touched.current = true; setOpen((o) => !o) }

  return (
    <div className={'rz' + (live ? ' live' : '') + (open ? ' open' : '')} aria-label="Düşünme süreci">
      <button className="rz-head" aria-expanded={open} onClick={toggle}>
        <span className={'rz-chev' + (open ? ' open' : '')}><Next size={14} /></span>
        <span className="rz-name">{live ? 'Düşünüyor' : 'Düşündü'}</span>
        <span className="rz-sub">{sub}</span>
        <span className="rz-time">{fmtSec(elapsed)}</span>
      </button>

      <div className={'rz-wrap' + (open ? ' open' : '')}>
        <div className="rz-inner">
          {live && <div className="rz-bar" aria-hidden><i /></div>}
          <div className="rz-stats">
            <div><span className="label">SÜRE</span><b>{sec(elapsed)}<small> sn</small></b></div>
            <div><span className="label">TOKEN</span><b>{tokens ? (exact ? '' : '~') + fmtTok(tokens) : '—'}</b></div>
            <div><span className="label">HIZ</span><b>{rate ? <>{rate}<small> tok/sn</small></> : '—'}</b></div>
            <div><span className="label">ADIM</span><b>{steps.length || '—'}</b></div>
            <div><span className="label">SEVİYE</span><b>{think.note === 'ignored' ? 'Desteklenmiyor' : think.note === 'lowest' ? 'En düşük' : think.requested ? levelLabel(think.level) : 'Kapalı'}</b></div>
          </div>

          {think.note && (
            <div className="note">
              {think.note === 'ignored' ? 'Bu model düşünme seviyesi ayarını kabul etmedi; kendi varsayılanıyla çalıştı.' : 'Bu modelde düşünme tamamen kapatılamıyor; en düşük kademe kullanıldı.'}
            </div>
          )}

          <div className="rz-tools">
            <div className="seg sm" role="tablist" aria-label="Görünüm">
              <button role="tab" aria-selected={view === 'steps'} onClick={() => setView('steps')}>Adımlar</button>
              <button role="tab" aria-selected={view === 'raw'} onClick={() => setView('raw')}>Ham metin</button>
            </div>
            {text && (
              <button className="pill plain" aria-label="Düşünceyi kopyala" onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1200) }}>
                <Copy size={14} />{copied ? 'Kopyalandı' : 'Kopyala'}
              </button>
            )}
          </div>

          <div className="rz-scroll" ref={scRef} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40 }}>
            {!text ? (
              <div className="note rz-empty">
                {live
                  ? 'Model düşünüyor; sağlayıcı düşünce metni gönderdiği anda burada canlı görünecek.'
                  : think.requested
                    ? 'Bu cevap için sağlayıcı düşünce metnini paylaşmadı (bazı modeller yalnızca süre ve token sayısını bildirir).'
                    : 'Düşünce kaydı yok.'}
              </div>
            ) : view === 'steps' ? (
              <ol className="rz-steps">
                {steps.map((s, i) => {
                  const cur = live && i === steps.length - 1
                  return (
                    <li key={i} className={cur ? 'cur' : 'done'}>
                      <span className="rz-n">{i + 1}</span>
                      <div className="rz-sb">
                        {s.title && <div className="rz-st">{s.title}</div>}
                        {s.body && <Markdown text={s.body} />}
                        {cur && <span className="cursor" />}
                      </div>
                    </li>
                  )
                })}
              </ol>
            ) : (
              <pre className="rz-raw">{text}{live && <span className="cursor" />}</pre>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Yazı alanındaki düşünme sayacı: dört seviye düğmesi.
const BARS = { off: 0, low: 1, medium: 2, high: 3 } as const

export function ReasoningControl({ cfg, onChange }: { cfg: ReasoningConfig; onChange(c: ReasoningConfig): void }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', down); document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key) }
  }, [open])

  return (
    <div className="rz-ctl-wrap" ref={box}>
      <button className="pill rz-ctl" aria-haspopup="dialog" aria-expanded={open}
        aria-label={`Düşünme: ${levelLabel(cfg.level)}`} title={`Düşünme: ${levelLabel(cfg.level)}`} onClick={() => setOpen((o) => !o)}>
        <Level n={BARS[cfg.level]} />
        <b className="pl">Düşünme</b>
        <span className="pv">{levelLabel(cfg.level)}</span>
      </button>

      {open && (
        <div className="pop rz-pop" role="dialog" aria-label="Düşünme ayarı">
          <span className="label">DÜŞÜNME SEVİYESİ</span>
          <div className="seg lv" role="group" aria-label="Düşünme seviyesi">
            {LEVELS.map((l) => (
              <button key={l.id} aria-pressed={cfg.level === l.id} onClick={() => { onChange({ level: l.id }); setOpen(false) }}>
                <b>{l.label}</b>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
