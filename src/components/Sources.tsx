import { useEffect, useRef, useState } from 'react'
import type { Project, SourceRef, WebRef } from '../types'
import { Check, FileText, Folder, Next } from './Icons'

/** Cevap metninde geçen [K#] etiketlerinin karşılıkları ([K1, K2] biçimi dahil). */
export function citedSources(text: string, sources: SourceRef[]): SourceRef[] {
  const ns = new Set<number>()
  for (const m of text.matchAll(/\[([^\]\n]*K\d+[^\]\n]*)\]/g)) for (const k of m[1].matchAll(/K(\d+)/g)) ns.add(Number(k[1]))
  return sources.filter((s) => ns.has(s.n))
}
export const sourceTitle = (s: SourceRef) => (s.sourceType === 'note' ? 'Not: ' + s.sourceName : s.sourceName + (s.loc ? ' · ' + s.loc : ''))

/** Cevabın altındaki kaynak özeti: kapalıyken tek satır; açılınca dosya başına bir satır ve tıklanabilir sayfalar. */
export default function CitedSources({ sources, onOpen }: { sources: SourceRef[]; onOpen(s: SourceRef): void }) {
  const [open, setOpen] = useState(false)
  if (!sources.length) return null
  const groups: { key: string; name: string; note: boolean; refs: SourceRef[] }[] = []
  for (const s of sources) {
    const key = s.sourceType + ':' + s.sourceId
    const g = groups.find((x) => x.key === key)
    if (g) g.refs.push(s); else groups.push({ key, name: s.sourceName, note: s.sourceType === 'note', refs: [s] })
  }
  groups.forEach((g) => g.refs.sort((a, b) => (a.page ?? 0) - (b.page ?? 0)))
  const files = groups.filter((g) => !g.note).length, notes = groups.length - files
  const pages = sources.filter((s) => s.sourceType === 'file' && s.page != null).length
  const summary = [files ? `${files} dosya` : '', pages ? `${pages} sayfa` : '', notes ? `${notes} not` : ''].filter(Boolean).join(' · ')

  return (
    <div className={'kn-src' + (open ? ' open' : '')}>
      <button className="kn-sum" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className={'rz-chev' + (open ? ' open' : '')}><Next size={14} /></span><b>Kaynaklar</b><span>{summary}</span>
      </button>
      {open && (
        <div className="kn-list">
          {groups.map((g) => (
            <div className="kn-g" key={g.key}>
              <div className="kn-gn" title={g.name}><FileText size={14} /><span>{g.note ? 'Not: ' : ''}{g.name}</span></div>
              <div className="kn-pp">
                {g.refs.map((s) => (
                  <button key={s.n} className="kc" title={`K${s.n} · ${sourceTitle(s)}`} onClick={() => onOpen(s)}>{s.page != null ? s.page : 'Aç'}</button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---- web kaynakları ([W#]) ----
export const domainOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url } }
const normUrl = (u: string) => u.trim().replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase()
/** Adresin karşılığı olan web kaynağı (sondaki / ve # farkı yok sayılır). */
export const findWeb = (web: WebRef[] | undefined, url: string) => { const k = normUrl(url); return web?.find((w) => normUrl(w.url) === k) }
/** Sağlayıcı kaynağın dayandığı metin parçasını bildirdiyse etiket o parçanın sonuna eklenir; parça metinde yoksa dokunulmaz. */
export function anchorWeb(text: string, web?: WebRef[]): string {
  for (const w of web ?? []) for (const q of w.quotes ?? []) {
    const at = q.trim().length >= 8 ? text.indexOf(q) : -1
    if (at < 0) continue
    const end = at + q.length, tag = `[W${w.n}]`
    if (!text.slice(end, end + tag.length + 2).includes(tag)) text = text.slice(0, end) + ' ' + tag + text.slice(end)
  }
  return text
}
/** Cevapta kullanılan web kaynakları: [W#] etiketi ya da bağlantısı geçenler. Hiçbiri metne bağlanamadıysa cevabın aramalarından gelenlerin tümü. */
export function citedWeb(text: string, web: WebRef[] | undefined, own: number[] | undefined): WebRef[] {
  if (!web?.length) return []
  const t = anchorWeb(text, web)
  const ns = new Set<number>()
  for (const m of t.matchAll(/\[([^\]\n]*W\d+[^\]\n]*)\](?!\()/g)) for (const k of m[1].matchAll(/W(\d+)/g)) ns.add(Number(k[1]))
  for (const m of t.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)) { const w = findWeb(web, m[1]); if (w) ns.add(w.n) }
  const cited = web.filter((w) => ns.has(w.n))
  return cited.length ? cited : web.filter((w) => own?.includes(w.n))
}

/** Cevabın altındaki web kaynakları: alan adı ve başlıkla listelenir; satıra tıklayınca tarayıcıda açılır, "Projeye kaydet" not oluşturur. */
export function WebSources({ sources, projects, projectId, onOpen, onSave }: { sources: WebRef[]; projects: Project[]; projectId?: string; onOpen(w: WebRef): void; onSave(w: WebRef, projectId: string): void }) {
  const [open, setOpen] = useState(false)
  const [pick, setPick] = useState<number | null>(null)
  const [saved, setSaved] = useState<number[]>([])
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (pick == null) return
    const down = (e: MouseEvent) => { if (!(e.target as Element).closest('.wb-save')) setPick(null) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setPick(null) }
    document.addEventListener('mousedown', down); document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key) }
  }, [pick])
  if (!sources.length) return null
  // mesajda seçili proje en üstte
  const list = [...projects].sort((a, b) => Number(b.id === projectId) - Number(a.id === projectId))
  return (
    <div className={'kn-src' + (open ? ' open' : '')} ref={box}>
      <button className="kn-sum" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className={'rz-chev' + (open ? ' open' : '')}><Next size={14} /></span><b>Web kaynakları</b><span>{sources.length} sayfa</span>
      </button>
      {open && (
        <div className="kn-list">
          {sources.map((w) => (
            <div className="kn-g wb-row" key={w.n}>
              <button className="wb-link" title={w.url} onClick={() => onOpen(w)}>
                <span className="kc wc">W{w.n}<i>{domainOf(w.url)}</i></span>
                <span className="wb-t">{w.title || w.url}</span>
              </button>
              <div className="wb-save">
                <button className="pill sm" aria-haspopup="menu" aria-expanded={pick === w.n} onClick={() => setPick(pick === w.n ? null : w.n)}>
                  {saved.includes(w.n) ? <><Check size={14} />Kaydedildi</> : 'Projeye kaydet'}
                </button>
                {pick === w.n && (
                  <div className="pop wb-pop" role="menu" aria-label="Proje seç">
                    <div className="label mh">PROJEYE NOT OLARAK KAYDET</div>
                    {list.map((p) => (
                      <div key={p.id} className="mi" role="menuitem" title={p.name} onClick={() => { onSave(w, p.id); setSaved((s) => [...s, w.n]); setPick(null) }}>
                        <Folder size={15} /><span className="pj-mn">{p.name}</span>
                      </div>
                    ))}
                    {list.length === 0 && <div className="note">Henüz proje yok. Projeler bölümünden oluşturabilirsiniz.</div>}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
