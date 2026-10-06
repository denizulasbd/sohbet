import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ArchiveFile, Note, Project, SearchHit } from '../types'
import { isEmptyNote, longDate, noteTitle, plain } from '../notes'
import { blockOf, caretOffset, charRange, cyclePrefixes, handleEnter, htmlToMd, mdToHtml, selectChars, toggleBoxAtCaret } from '../richText'
import { linkAt, linksIn, openLinkQuery, type NoteLink } from '../links'
import { fold, snippet } from '../search'
import { Chat as ChatIcon, Check, Checklist, FileText, Folder, ListIcon, Pin, Trash } from './Icons'
import { Reveal } from './Sidebar'

interface Props {
  note: Note | null; projects: Project[]; sidebar: boolean; onOpenSidebar(): void
  onChange(patch: Partial<Pick<Note, 'title' | 'body' | 'pinned' | 'projectId'>>): void
  onDelete(): void; onUseInChat(): void; onNew(): void
  /** [[dosya#sayfa]] bağlantısı ya da ilgili kaynak tıklandı. */
  onOpenFile(id: string, page: number | null): void
}

const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
// Bağlantılar DOM'a dokunmadan boyanır (CSS Custom Highlight API); editörün düz metin yapısı bozulmaz.
const highlights: Map<string, unknown> | undefined = (CSS as any).highlights

export default function NoteEditor({ note, projects, sidebar, onOpenSidebar, onChange, onDelete, onUseInChat, onNew, onOpenFile }: Props) {
  const titleRef = useRef<HTMLInputElement>(null)
  const edRef = useRef<HTMLDivElement>(null)
  const [on, setOn] = useState({ b: false, i: false }) // imleçteki biçim (düğme vurgusu)

  const [pick, setPick] = useState(false) // proje menüsü
  const pickRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!pick) return
    const down = (e: MouseEvent) => { if (!pickRef.current?.contains(e.target as Node)) setPick(false) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setPick(false) }
    document.addEventListener('mousedown', down); document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key) }
  }, [pick])
  useEffect(() => setPick(false), [note?.id])
  const project = projects.find((x) => x.id === note?.projectId)

  // Boş yeni not açılınca başlığa odaklan.
  useEffect(() => { if (note && isEmptyNote(note)) titleRef.current?.focus() }, [note?.id])

  // ---- [[dosya adı#sayfa]] bağlantıları ve ilgili kaynaklar ----
  const [files, setFiles] = useState<ArchiveFile[]>([]) // bağlantı kurulabilecek dosyalar: notun projesi (Genel notta hepsi)
  const [ac, setAc] = useState<{ q: string; x: number; y: number; i: number } | null>(null)
  const [related, setRelated] = useState<{ hits: SearchHit[]; query: string } | null>(null)
  useEffect(() => {
    let live = true
    setFiles([])
    if (note) window.api.listFiles(note.projectId ?? null).then((f) => { if (live) setFiles(f.filter((x) => x.status === 'ready')) }).catch(() => {})
    return () => { live = false }
  }, [note?.id, note?.projectId])
  useEffect(() => {
    if (!note?.projectId) { setRelated(null); return }
    let live = true
    const pid = note.projectId, text = note.title + '\n' + note.body
    const t = setTimeout(() => window.api.relatedSources(pid, text, 5).then((r) => { if (live) setRelated(r) }).catch(() => {}), 1200)
    return () => { live = false; clearTimeout(t) }
  }, [note?.id, note?.projectId, note?.title, note?.body])

  function paintLinks() {
    const el = edRef.current
    if (!el || !highlights) return
    const ranges: Range[] = []
    for (const block of Array.from(el.children)) {
      const t = block.textContent ?? ''
      if (t.includes('[[')) for (const l of linksIn(t)) ranges.push(charRange(block, l.from, l.to))
    }
    highlights.set('nt-link', new (window as any).Highlight(...ranges))
  }
  useEffect(() => () => { highlights?.delete('nt-link') }, [])
  /** İmlecin bulunduğu satır ve satır içi konumu. */
  function caret() {
    const el = edRef.current, s = window.getSelection()
    if (!el || !s || !s.rangeCount || !s.isCollapsed) return null
    const block = blockOf(el, s.anchorNode)
    const off = block ? caretOffset(block) : null
    return block && off != null ? { block, off, text: block.textContent ?? '', sel: s } : null
  }
  // "[[" yazılınca dosya listesi imlecin altında açılır
  function checkAc() {
    const c = caret()
    const m = c ? openLinkQuery(c.text.slice(0, c.off)) : null
    if (!c || !m) { setAc(null); return }
    const r = c.sel.getRangeAt(0).getClientRects()[0] ?? c.block.getBoundingClientRect()
    setAc((a) => ({ q: m.q, x: Math.min(r.left, window.innerWidth - 316), y: r.bottom + 6, i: a && a.q === m.q ? a.i : 0 }))
  }
  const acList = ac ? files.filter((f) => fold(f.name).includes(fold(ac.q.trim()))).slice(0, 8) : []
  function pickFile(f: ArchiveFile) {
    const c = caret()
    const m = c ? openLinkQuery(c.text.slice(0, c.off)) : null
    if (!c || !m) return
    const paged = f.pageCount != null // sayfalı dosyada imleç sayfa numarası yazılacak yere gelir
    const ins = `[[${f.name}${paged ? '#' : ''}]]`
    selectChars(c.block, m.start, c.off)
    document.execCommand('insertText', false, ins)
    const pos = m.start + ins.length - (paged ? 2 : 0)
    selectChars(c.block, pos, pos)
    setAc(null); sync()
  }
  async function openLink(l: NoteLink) {
    const same = (f: ArchiveFile) => fold(f.name) === fold(l.name)
    const f = files.find(same) ?? (await window.api.listFiles(null).catch(() => [])).find(same)
    if (f) onOpenFile(f.id, l.page)
  }

  // Editör kontrolsüzdür: not değişince içerik düz metinden yeniden kurulur, yazarken React dokunmaz.
  useLayoutEffect(() => {
    const el = edRef.current
    if (el && note) el.innerHTML = mdToHtml(note.body)
    setAc(null); paintLinks()
  }, [note?.id])

  useEffect(() => {
    const h = () => {
      const el = edRef.current
      if (!el || !el.contains(window.getSelection()?.anchorNode ?? null)) return
      setOn({ b: document.queryCommandState('bold'), i: document.queryCommandState('italic') })
    }
    document.addEventListener('selectionchange', h)
    return () => document.removeEventListener('selectionchange', h)
  }, [])

  const sync = () => {
    const el = edRef.current
    if (!el || !note) return
    if (el.firstChild?.nodeType === 3) document.execCommand('formatBlock', false, 'div') // satırsız metni satıra sar
    onChange({ body: htmlToMd(el) })
    paintLinks(); checkAc()
  }
  const run = (f: () => void) => { edRef.current?.focus(); f(); sync() }
  const bold = () => run(() => document.execCommand('bold'))
  const italic = () => run(() => document.execCommand('italic'))

  const words = note ? (note.body.trim() ? plain(note.body).trim().split(/\s+/).length : 0) : 0

  return (
    <>
      <header className={'top' + (sidebar ? '' : ' bare')}>
        <div className="top-l">
          {!sidebar && <Reveal onOpen={onOpenSidebar} onNew={onNew} newLabel="Yeni not" />}
          <h1>{note ? noteTitle(note) : 'Notlar'}</h1>
        </div>
        <div className="top-r">
          {note && <>
            <div className="rz-ctl-wrap" ref={pickRef}>
              <button className="pill pj-pick" aria-haspopup="menu" aria-expanded={pick} aria-label={`Proje: ${project?.name ?? 'Genel'}`} title="Notun projesi" onClick={() => setPick((o) => !o)}>
                <Folder size={16} /><span className="pl">{project?.name ?? 'Genel'}</span>
              </button>
              {pick && (
                <div className="pop pj-pop" role="menu" aria-label="Notun projesi">
                  <div className="label mh">NOTUN PROJESİ</div>
                  {[{ id: undefined as string | undefined, name: 'Genel' }, ...projects].map((x) => (
                    <div key={x.id ?? ''} className="mi" role="menuitemradio" aria-checked={x.id === project?.id} title={x.name} onClick={() => { onChange({ projectId: x.id }); setPick(false) }}>
                      <span className="ck">{x.id === project?.id && <Check size={14} />}</span><span className="pj-mn">{x.name}</span>
                    </div>
                  ))}
                  {projects.length === 0 && <div className="note">Henüz proje yok. Projeler bölümünden oluşturabilirsiniz.</div>}
                </div>
              )}
            </div>
            <button className="pill nt-use" aria-label="Bu notu sohbete ekle" title="Bu notu sohbete ekle" onClick={onUseInChat} disabled={isEmptyNote(note)}>
              <ChatIcon size={16} /><span>Sohbete ekle</span>
            </button>
            <button className={'circle' + (note.pinned ? ' on' : '')} aria-label={note.pinned ? 'Sabitlemeyi kaldır' : 'Notu sabitle'} title={note.pinned ? 'Sabitlemeyi kaldır' : 'Sabitle'} aria-pressed={!!note.pinned} onClick={() => onChange({ pinned: !note.pinned })}><Pin size={16} /></button>
            <button className="circle" aria-label="Notu sil" title="Sil" onClick={onDelete}><Trash size={16} /></button>
          </>}
        </div>
      </header>

      {!note ? (
        <div className="scroll"><div className="thread"><div className="empty">
          <FileText size={52} />
          <h2>Not seçilmedi</h2>
          <p>Bir not seçin ya da yenisini oluşturun.</p>
          <button className="pill primary" onClick={onNew}>Yeni not</button>
        </div></div></div>
      ) : (
        <>
          <div className="scroll" onScroll={() => { if (ac) checkAc() }} onMouseDown={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); const el = edRef.current; if (el) { el.focus(); const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const sl = window.getSelection(); sl?.removeAllRanges(); sl?.addRange(r) } } }}>
            <div className="nt-page">
              <div className="nt-date">{longDate(note.updatedAt)}</div>
              <input ref={titleRef} className="nt-title" placeholder="Başlık" aria-label="Not başlığı" value={note.title}
                onChange={(e) => onChange({ title: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); edRef.current?.focus() } }} />
              <div className="nt-edwrap">
                {!note.body.trim() && <div className="nt-ph" aria-hidden>Notunuzu yazın…</div>}
                <div ref={edRef} className="nt-ed" contentEditable suppressContentEditableWarning role="textbox" aria-multiline aria-label="Not metni" spellCheck
                  onInput={sync}
                  onPaste={(e) => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')) }}
                  onDrop={(e) => e.preventDefault()}
                  onBlur={() => setAc(null)}
                  onKeyDown={(e) => {
                    if (ac && !e.nativeEvent.isComposing) {
                      if (e.key === 'Escape') { e.preventDefault(); setAc(null); return }
                      if (acList.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); setAc({ ...ac, i: (ac.i + (e.key === 'ArrowDown' ? 1 : acList.length - 1)) % acList.length }); return }
                      if (acList.length && (e.key === 'Enter' || e.key === 'Tab')) { e.preventDefault(); pickFile(acList[Math.min(ac.i, acList.length - 1)]); return }
                    }
                    const mod = (e.ctrlKey || e.metaKey) && !e.altKey
                    if (mod && (e.key === 'b' || e.key === 'B')) { e.preventDefault(); bold(); return }
                    if (mod && (e.key === 'i' || e.key === 'I')) { e.preventDefault(); italic(); return }
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && edRef.current && handleEnter(edRef.current)) { e.preventDefault(); sync() }
                  }}
                  onMouseUp={() => {
                    const c = caret()
                    const l = c ? linkAt(c.text, c.off) : null
                    if (l) { openLink(l); return }
                    if (edRef.current && toggleBoxAtCaret(edRef.current)) sync()
                  }} />
              </div>
              {ac && (acList.length > 0 || files.length === 0) && (
                <div className="pop nt-ac" role="listbox" aria-label="Dosyaya bağlantı" style={{ position: 'fixed', left: ac.x, top: ac.y }}>
                  <div className="label mh">DOSYAYA BAĞLANTI</div>
                  {acList.map((f, i) => (
                    <div key={f.id} className={'mi' + (i === ac.i ? ' on' : '')} role="option" aria-selected={i === ac.i} title={f.name}
                      onMouseEnter={() => setAc({ ...ac, i })} onMouseDown={(e) => { e.preventDefault(); pickFile(f) }}>
                      <FileText size={15} /><span className="pj-mn">{f.name}</span><span className="grow" />
                      <span className="sub">{f.pageCount != null ? `${f.pageCount} ${f.mime === PPTX ? 'slayt' : 'sayfa'}` : ''}</span>
                    </div>
                  ))}
                  {files.length === 0 && <div className="note">{note.projectId ? 'Bu projede hazır dosya yok.' : 'Henüz dosya yok. Projeler bölümünden ekleyebilirsiniz.'}</div>}
                </div>
              )}
              {note.projectId && related && related.hits.length > 0 && (
                <section className="stack nt-rel">
                  <span className="label gl">İLGİLİ KAYNAKLAR</span>
                  <div className="group">
                    {related.hits.map((h) => {
                      const s = snippet(h.text, related.query, 220)
                      return (
                        <button className="frow pj-hit" key={h.chunkId} title="Dosyayı bu sayfada aç" onClick={() => onOpenFile(h.sourceId, h.page)}>
                          <div className="pj-hh"><span className="pj-n">{h.sourceName}</span><span className="pj-st">{h.page != null ? (files.find((f) => f.id === h.sourceId)?.mime === PPTX ? 'Slayt ' : 'Sayfa ') + h.page : 'Dosya'}</span></div>
                          <div className="pj-snip">{s.lead && '…'}{s.parts.map((x, i) => (x.hit ? <mark key={i}>{x.t}</mark> : x.t))}</div>
                        </button>
                      )
                    })}
                  </div>
                </section>
              )}
            </div>
          </div>
          <div className="nt-bar-wrap">
            <div className="nt-bar">
              <div className="nt-tools" role="toolbar" aria-label="Biçim">
                <button className="nt-fmt nt-b" aria-label="Kalın" aria-pressed={on.b} title="Kalın (Ctrl/⌘ B)" onMouseDown={(e) => e.preventDefault()} onClick={bold}>B</button>
                <button className="nt-fmt nt-i" aria-label="İtalik" aria-pressed={on.i} title="İtalik (Ctrl/⌘ I)" onMouseDown={(e) => e.preventDefault()} onClick={italic}>I</button>
                <button className="nt-fmt" aria-label="Kontrol listesi" title="Kontrol listesi (☐ → ☑ → kaldır)" onMouseDown={(e) => e.preventDefault()} onClick={() => run(() => edRef.current && cyclePrefixes(edRef.current, 'check'))}><Checklist size={17} /></button>
                <button className="nt-fmt" aria-label="Madde işaretli liste" title="Madde işaretli liste" onMouseDown={(e) => e.preventDefault()} onClick={() => run(() => edRef.current && cyclePrefixes(edRef.current, 'bullet'))}><ListIcon size={17} /></button>
              </div>
              <span className="nt-count">{words} kelime · {note.body.length} karakter</span>
            </div>
          </div>
        </>
      )}
    </>
  )
}
