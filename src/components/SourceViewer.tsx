import { useEffect, useRef, useState } from 'react'
import type { ArchiveFile } from '../types'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import { Back, Close, Next } from './Icons'

const PDF = 'application/pdf'
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
const KEEP = 14 // aynı anda çizili tutulan en fazla sayfa (bellek için); uzaktakiler boşaltılır

type TextPage = { page: number; text: string; needsOcr: boolean }

/** Uygulama içi kaynak görüntüleyici: PDF'ler pdf.js ile çizilir, diğer türlerde çıkarılmış metin gösterilir.
 *  page verilirse o sayfada/slaytta açılır ve sayfa kısa süre işaretlenir. */
export default function SourceViewer({ fileId, page, onClose }: { fileId: string; page: number | null; onClose(): void }) {
  const [file, setFile] = useState<ArchiveFile | null>(null)
  const [err, setErr] = useState('')
  const [count, setCount] = useState(0)          // PDF sayfa sayısı
  const [ratio, setRatio] = useState(1.414)      // yükseklik / genişlik (ilk sayfadan; her sayfa çizilince kendi oranını alır)
  const [texts, setTexts] = useState<TextPage[] | null>(null)
  const [cur, setCur] = useState(page ?? 1)
  const scroller = useRef<HTMLDivElement>(null)
  const docRef = useRef<any>(null)
  const isPdf = file?.mime === PDF

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [onClose])

  // dosyayı yükle
  useEffect(() => {
    let live = true, task: any = null
    setFile(null); setErr(''); setCount(0); setTexts(null); setCur(page ?? 1)
    ;(async () => {
      const f = await window.api.getFile(fileId)
      if (!live) return
      if (!f) { setErr('Dosya bulunamadı; silinmiş olabilir.'); return }
      setFile(f)
      if (f.mime !== PDF) { const t = await window.api.fileText(fileId); if (live) setTexts(t); return }
      const data = await window.api.readFile(fileId)
      if (!live) return
      if (!data) { setErr('Dosya okunamadı.'); return }
      // pdf.js yalnızca görüntüleyici açılınca yüklenir (sohbetin açılışını ağırlaştırmasın)
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
      task = pdfjs.getDocument({ data })
      const doc = await task.promise
      if (!live) { task.destroy(); return }
      const vp = (await doc.getPage(1)).getViewport({ scale: 1 })
      docRef.current = doc
      setRatio(vp.height / vp.width); setCount(doc.numPages)
    })().catch((e) => { if (live) setErr('Dosya açılamadı: ' + String(e?.message || e).slice(0, 160)) })
    return () => { live = false; docRef.current = null; task?.destroy() }
  }, [fileId])

  // PDF: görünür sayfaları çiz, hedef sayfaya git
  useEffect(() => {
    const root = scroller.current, doc = docRef.current
    if (!root || !doc || !count) return
    let live = true
    const drawn: HTMLElement[] = []
    async function draw(el: HTMLElement) {
      if (el.dataset.s) return
      el.dataset.s = 'busy'
      try {
        const pg = await doc.getPage(Number(el.dataset.p))
        const base = pg.getViewport({ scale: 1 })
        const vp = pg.getViewport({ scale: (el.clientWidth * Math.min(window.devicePixelRatio || 1, 2)) / base.width })
        const canvas = document.createElement('canvas')
        canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height)
        await pg.render({ canvasContext: canvas.getContext('2d')!, viewport: vp, canvas } as any).promise
        if (!live) return
        el.style.aspectRatio = `${base.width} / ${base.height}`
        el.replaceChildren(canvas); el.dataset.s = 'done'
        drawn.push(el)
        while (drawn.length > KEEP) { const old = drawn.shift()!; if (old !== el) { old.replaceChildren(); delete old.dataset.s } }
      } catch { if (live) delete el.dataset.s }
    }
    const io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) draw(e.target as HTMLElement) }, { root, rootMargin: '500px 0px' })
    const els = Array.from(root.querySelectorAll<HTMLElement>('.pv-page'))
    els.forEach((el) => io.observe(el))
    const target = els[Math.min(Math.max((page ?? 1) - 1, 0), els.length - 1)]
    if (target && page) target.scrollIntoView({ block: 'start' })
    return () => { live = false; io.disconnect() }
  }, [count, fileId, page])

  // metin görünümü: hedef sayfaya/slayta git
  useEffect(() => {
    if (texts && page) scroller.current?.querySelector<HTMLElement>(`[data-p="${page}"]`)?.scrollIntoView({ block: 'start' })
  }, [texts, page])

  const total = isPdf ? count : file?.pageCount ?? 0
  function onScroll() {
    const root = scroller.current
    if (!root || !total) return
    const mid = root.scrollTop + root.clientHeight * 0.35
    let best = 1
    for (const el of root.querySelectorAll<HTMLElement>('[data-p]')) { if (el.offsetTop <= mid) best = Number(el.dataset.p); else break }
    setCur(best)
  }
  const go = (p: number) => scroller.current?.querySelector<HTMLElement>(`[data-p="${Math.min(Math.max(p, 1), total)}"]`)?.scrollIntoView({ block: 'start' })
  const unit = file?.mime === PPTX ? 'Slayt' : 'Sayfa'

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="pview" role="dialog" aria-label={file ? file.name : 'Kaynak'}>
        <header className="pv-top">
          <h2 title={file?.name}>{file?.name ?? 'Kaynak'}</h2>
          {total > 1 && (
            <div className="pv-nav">
              <button className="circle sm" aria-label={`Önceki ${unit.toLowerCase()}`} disabled={cur <= 1} onClick={() => go(cur - 1)}><Back size={16} /></button>
              <span>{unit} {cur} / {total}</span>
              <button className="circle sm" aria-label={`Sonraki ${unit.toLowerCase()}`} disabled={cur >= total} onClick={() => go(cur + 1)}><Next size={16} /></button>
            </div>
          )}
          <button className="circle sm" aria-label="Kapat" title="Kapat (Esc)" onClick={onClose}><Close size={14} /></button>
        </header>
        <div className="pv-scroll" ref={scroller} onScroll={onScroll}>
          {err ? <p className="note pv-msg">{err}</p>
            : isPdf ? (count
              ? Array.from({ length: count }, (_, i) => <div key={i} className={'pv-page' + (page === i + 1 ? ' hit' : '')} data-p={i + 1} style={{ aspectRatio: String(1 / ratio) }} />)
              : <p className="note pv-msg">Açılıyor…</p>)
            : texts == null ? <p className="note pv-msg">Açılıyor…</p>
            : texts.length === 0 ? <p className="note pv-msg">Bu dosyadan metin çıkarılamadı.</p>
            : texts.map((t) => (
              <section key={t.page} className={'pv-text' + (file?.pageCount != null && page === t.page ? ' hit' : '')} data-p={t.page}>
                {file?.pageCount != null && <div className="label">{unit.toLocaleUpperCase('tr-TR')} {t.page}</div>}
                <pre>{t.text || (t.needsOcr ? '(bu sayfada metin yok: taranmış görüntü)' : '(boş)')}</pre>
              </section>
            ))}
        </div>
      </div>
    </div>
  )
}
