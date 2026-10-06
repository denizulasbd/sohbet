import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Chat, Msg, Note, NoteEdit, NoteOp, NoteRef, Project, ProjectKind, ReasoningConfig, SbPage, Settings, SourceRef, ThinkInfo, ToolStep, WebRef } from './types'
import Sidebar, { Reveal } from './components/Sidebar'
import SettingsModal from './components/Settings'
import Markdown from './components/Markdown'
import { ReasoningControl, ReasoningPanel } from './components/Reasoning'
import NoteEditor from './components/NoteEditor'
import NotePicker from './components/NotePicker'
import NoteCard, { NoteChip } from './components/NoteCard'
import ProjectPage from './components/ProjectPage'
import CalendarPage, { type CalRequest } from './components/CalendarPage'
import EventCard, { EventChip } from './components/EventCard'
import TrackersPage, { type TrackerRequest } from './components/TrackersPage'
import TrackerCard, { TrackerChip } from './components/TrackerCard'
import CitedSources, { citedSources, citedWeb, domainOf, WebSources } from './components/Sources'
import SourceViewer from './components/SourceViewer'
import { Calendar, Chat as ChatIcon, Check, Checklist, Close, Copy, FileText, Folder, Globe, Level, Redo, Search, Star, Stop, Up, UpDown } from './components/Icons'
import { contentOf, isEmptyNote, toRef } from './notes'
import { isMac } from './platform'
import { detectReasoning, normalizeReasoning } from './reasoning'
import { fold } from './search'
import { COACH_NAME, type Mode } from './modes'

/** İmlecin hemen solunda yazılmakta olan "@sorgu" (satır başında ya da boşluktan sonra başlamalı). */
function mentionAt(text: string, caret: number): { start: number; q: string } | null {
  const before = text.slice(0, caret)
  const at = before.lastIndexOf('@')
  if (at < 0 || (at > 0 && !/\s/.test(before[at - 1]))) return null
  const q = before.slice(at + 1)
  return q.includes('\n') || q.length > 60 ? null : { start: at, q }
}
function stepText(s: ToolStep) {
  if (s.kind === 'web') return s.count == null ? "Web'de aranıyor…" : `Web'de arandı · ${s.count} arama`
  if (s.kind === 'read') return s.count == null ? 'Kaynak okunuyor…' : `Okundu: ${s.text}`
  if (s.kind === 'tracker') return s.count == null ? 'Takiplere bakılıyor…' : s.text ? `Takip kayıtlarına bakıldı: ${s.text} · ${s.count ? s.count + ' gün kayıt' : 'kayıt yok'}` : `Takipler listelendi · ${s.count} takip`
  if (s.kind === 'calendar') return s.count == null ? 'Takvime bakılıyor…' : `Takvime bakıldı: ${s.text} · ${s.count ? s.count + ' etkinlik' : 'etkinlik yok'}`
  if (s.kind === 'memory') return s.count == null ? 'Hafızada aranıyor…' : `Hafızada arandı: ${s.text} · ${s.count ? s.count + ' kayıt' : 'kayıt yok'}`
  if (s.kind === 'list') return s.count == null ? 'Kaynaklar listeleniyor…' : `Kaynaklar listelendi: ${s.text} · ${s.count} kaynak`
  // özetleme sürerken metin ilerlemeyi taşır ("Sayfa 21–30 işleniyor… · dosya")
  if (s.kind === 'summarize') return s.count == null ? (s.text.includes('…') ? s.text : `Belge işleniyor… · ${s.text}`) : `Belge işlendi: ${s.text} · ${s.count} önemli nokta`
  return s.count == null ? `Aranıyor: ${s.text}…` : `Arandı: ${s.text} · ${s.count ? s.count + ' sonuç' : 'sonuç yok'}`
}

/** Bir modun en son güncellenen sohbeti; yoksa null. */
const latestIn = (cs: Chat[], m: Mode) => [...cs].filter((c) => (c.mode ?? 'chat') === m).sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id ?? null
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
const usd = (n: number) => '$' + n.toFixed(3).replace('.', ',')
const num = (n: number) => n.toLocaleString('tr-TR')
/** Cevabın maliyeti: küçük tutarlar okunabilsin diye 1 sentin altı dört haneyle yazılır. */
const price = (n: number) => (n === 0 ? '$0' : n < 0.0001 ? '<$0,0001' : '$' + n.toFixed(n < 0.01 ? 4 : 3).replace('.', ','))
/** Cevabın altındaki bilgi satırı: süre · giriş/çıkış token · fiyat (sağlayıcı bildirdiyse) · web aramaları. */
function metaText(m: Msg) {
  const parts = [(m.ms! / 1000).toFixed(1).replace('.', ',') + ' sn']
  if (m.inTokens) parts.push(`${num(m.inTokens)} giriş`)
  if (m.tokens) parts.push(m.inTokens ? `${num(m.tokens)} çıkış token` : `${num(m.tokens)} token`)
  if (m.cost != null) parts.push(price(m.cost))
  if (m.webSearches) parts.push(`${m.webSearches} web araması${m.webCost ? ' · ' + usd(m.webCost) : ''}`)
  return parts.join(' · ')
}
const approxTokens = (msgs: Msg[]) => Math.round(msgs.reduce((n, m) => n + m.text.length, 0) / 3.5)

export default function App() {
  const [chats, setChats] = useState<Chat[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [sidebar, setSidebar] = useState(() => window.innerWidth > 760)
  const [draft, setDraft] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [menu, setMenu] = useState(false)
  const [loaded, setLoaded] = useState(false)
  // hangi bölüm açık (sohbet/notlar): kenar çubuğundaki liste ve ana alan birlikte değişir
  const [view, setView] = useState<SbPage>('chat')
  // Sohbet / koç modu: her modun kendi sohbet listesi, talimatı ve modeli vardır; notlar ve projeler sohbet modundadır.
  const [mode, setMode] = useState<Mode>('chat')
  // Takvim: calTick her değişiklikte artar (takvim sayfası, kenar çubuğu ve proje sayfası yenilenir); calReq takvim sayfasına gidilecek günü ya da yeni etkinlik isteğini taşır.
  const [calTick, setCalTick] = useState(0)
  const [calReq, setCalReq] = useState<CalRequest | null>(null)
  const bumpCal = () => setCalTick((n) => n + 1)
  // Takip: aynı düzen (trkTick her değişiklikte artar; trkReq yeni takip isteğini taşır).
  const [trkTick, setTrkTick] = useState(0)
  const [trkReq, setTrkReq] = useState<TrackerRequest | null>(null)
  const bumpTrk = () => setTrkTick((n) => n + 1)
  const openTrackers = (create?: boolean) => { if (create) setTrkReq({ n: Date.now(), create: true }); setView('trackers'); if (window.innerWidth <= 760) setSidebar(false) }
  const openCalendar = (r: Omit<CalRequest, 'n'>) => { setCalReq({ ...r, n: Date.now() }); setView('calendar'); if (window.innerWidth <= 760) setSidebar(false) }
  const [notes, setNotes] = useState<Note[]>([])
  // Notların en güncel hali: modelin not önerisi kaydedilirken (akış sırasında, eski kapanımlardan) okunur ve hemen diske yazılır.
  const notesRef = useRef<Note[]>([])
  notesRef.current = notes
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null)
  const [attached, setAttached] = useState<NoteRef[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  // Sohbette @ ile seçilen proje: gönderince mesajla gider; aynı sohbetin sonraki mesajlarında da seçili kalır.
  const [refId, setRefId] = useState<string | null>(null)
  const [mention, setMention] = useState<{ start: number; q: string } | null>(null)
  const [mIdx, setMIdx] = useState(0)
  // uygulama içi kaynak görüntüleyici (dosya + açılacak sayfa)
  const [viewer, setViewer] = useState<{ fileId: string; page: number | null } | null>(null)
  // Web araması düğmesi: varsayılanı ayarlardan gelir; webOk seçili sağlayıcı/modelde kullanılabilir mi (değilse nedeni).
  const [web, setWeb] = useState(false)
  const [webOk, setWebOk] = useState<{ ok: boolean; reason?: string }>({ ok: false })
  const abortRef = useRef<null | (() => void)>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const stick = useRef(true)

  const active = useMemo(() => chats.find((c) => c.id === activeId) ?? null, [chats, activeId])
  // Koç modunda kendi sağlayıcısı/modeli seçilmişse o kullanılır; seçilmemişse sohbet modununki.
  const coachCfg = mode === 'coach' ? settings?.modes?.coach : undefined
  const baseProvider = settings?.providers.find((p) => p.id === coachCfg?.providerId) ?? settings?.providers.find((p) => p.id === settings.activeProvider)
  const provider = baseProvider && coachCfg?.model && baseProvider.id === coachCfg.providerId ? { ...baseProvider, model: coachCfg.model } : baseProvider
  const modeChats = useMemo(() => chats.filter((c) => (c.mode ?? 'chat') === mode), [chats, mode])
  const rcfg = normalizeReasoning(settings?.reasoning)
  const reasonSave = useRef<ReturnType<typeof setTimeout>>()

  // yükle
  useEffect(() => {
    Promise.all([window.api.loadChats(), window.api.loadSettings(), window.api.loadNotes()]).then(([c, s, n]) => {
      const m: Mode = s.lastMode === 'coach' ? 'coach' : 'chat'
      setChats(c); setSettings(s); setNotes(n); setWeb(!!s.webSearch?.defaultOn); setMode(m); setActiveId(latestIn(c, m)); setLoaded(true)
    })
    reloadProjects()
    // Pencereye bırakılan dosya sayfayı o dosyaya götürmesin (bırakma yalnızca proje sayfasında işlenir).
    const stop = (e: DragEvent) => { if (!e.defaultPrevented) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'none' } }
    window.addEventListener('dragover', stop); window.addEventListener('drop', stop)
    return () => { window.removeEventListener('dragover', stop); window.removeEventListener('drop', stop) }
  }, [])
  // kaydet (akış sırasında sık yazmamak için gecikmeli)
  useEffect(() => {
    if (!loaded) return
    const t = setTimeout(() => window.api.saveChats(chats), 400)
    return () => clearTimeout(t)
  }, [chats, loaded])
  useEffect(() => {
    if (!loaded) return
    const t = setTimeout(() => window.api.saveNotes(notes.filter((n) => !isEmptyNote(n))), 400)
    return () => clearTimeout(t)
  }, [notes, loaded])
  // otomatik kaydırma
  useEffect(() => {
    const el = scrollRef.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [active?.msgs, activeId])

  useEffect(() => {
    if (!provider) return
    let live = true
    window.api.webAvailable(provider.id, provider.model).then((r) => { if (live) setWebOk(r) }).catch(() => { if (live) setWebOk({ ok: false }) })
    return () => { live = false }
  }, [provider?.id, provider?.model, provider?.baseUrl])

  const patchChat = useCallback((id: string, fn: (c: Chat) => Chat) => setChats((cs) => cs.map((c) => (c.id === id ? fn(c) : c))), [])

  function switchMode(m: Mode) {
    if (m === mode || streaming || !settings) return
    setMode(m); setView('chat'); pruneEmpty(null); setMenu(false)
    setActiveId(latestIn(chats, m)); setDraft(''); setRefId(null); setMention(null); setAttached([])
    const next = { ...settings, lastMode: m }
    setSettings(next); window.api.saveSettings(next)
  }
  function ackCoachNotice() {
    if (!settings) return
    const next = { ...settings, coachNoticeSeen: true }
    setSettings(next); window.api.saveSettings(next)
  }

  function newChat() {
    if (streaming) return
    setActiveId(null); setDraft(''); setRefId(null); setMention(null); setWeb(!!settings?.webSearch?.defaultOn); taRef.current?.focus()
    if (window.innerWidth <= 760) setSidebar(false)
  }

  // ---- notlar ----
  const activeNote = notes.find((n) => n.id === activeNoteId) ?? null
  const pruneEmpty = (keep: string | null) => setNotes((ns) => (ns.some((n) => n.id !== keep && isEmptyNote(n)) ? ns.filter((n) => n.id === keep || !isEmptyNote(n)) : ns))
  const narrow = () => window.innerWidth <= 760

  function navigate(p: SbPage) {
    setView(p); setMenu(false)
    if (p === 'chat') pruneEmpty(null)
    else if (!activeNote) {
      const latest = [...notes].filter((n) => !isEmptyNote(n)).sort((a, b) => b.updatedAt - a.updatedAt)[0]
      setActiveNoteId(latest?.id ?? null)
    }
  }
  function newNote() {
    const empty = notes.find(isEmptyNote)
    let id = empty?.id
    if (!id) {
      id = uid(); const now = Date.now()
      setNotes((ns) => [{ id: id!, title: '', body: '', createdAt: now, updatedAt: now }, ...ns])
    }
    pruneEmpty(id); setActiveNoteId(id); setView('notes')
    if (narrow()) setSidebar(false)
  }
  function pickNote(id: string) { setActiveNoteId(id); pruneEmpty(id); if (narrow()) setSidebar(false) }
  function patchNote(id: string, patch: Partial<Pick<Note, 'title' | 'body' | 'pinned' | 'projectId'>>) {
    setNotes((ns) => ns.map((n) => (n.id === id ? { ...n, ...patch, updatedAt: 'title' in patch || 'body' in patch ? Date.now() : n.updatedAt } : n)))
  }
  function delNote(id: string) {
    setNotes((ns) => ns.filter((n) => n.id !== id))
    if (id === activeNoteId) setActiveNoteId(null)
  }
  const toggleAttach = (n: Note) => setAttached((a) => (a.some((x) => x.id === n.id) ? a.filter((x) => x.id !== n.id) : [...a, toRef(n)]))
  function useNoteInChat(n: Note) {
    setAttached((a) => (a.some((x) => x.id === n.id) ? a : [...a, toRef(n)]))
    pruneEmpty(null); setView('chat'); setTimeout(() => taRef.current?.focus(), 0)
  }

  // ---- projeler ----
  // Arşiv açılamazsa (ör. yerel modül yüklenemedi) liste boş kalır; sohbet ve notlar etkilenmez.
  const reloadProjects = () => window.api.listProjects().then(setProjects).catch(() => {})
  const activeProject = projects.find((x) => x.id === activeProjectId) ?? null
  async function newProject() {
    try {
      const pr = await window.api.createProject({ kind: 'ders' })
      setProjects((ps) => [...ps, pr]); setActiveProjectId(pr.id); setView('projects')
      if (narrow()) setSidebar(false)
    } catch { alert('Proje oluşturulamadı. Uygulamayı yeniden başlatıp tekrar deneyin.') }
  }
  async function updateProject(id: string, patch: { name?: string; kind?: ProjectKind }) {
    const pr = await window.api.updateProject(id, patch)
    if (pr) setProjects((ps) => ps.map((x) => (x.id === id ? pr : x)))
  }
  async function delProject(id: string) {
    const pr = projects.find((x) => x.id === id)
    if (!pr) return
    const files = pr.fileCount ? `Projedeki ${pr.fileCount} dosya da kalıcı olarak silinir. ` : ''
    if (!confirm(`"${pr.name}" projesi silinsin mi?\n\n${files}Projeye bağlı notlar silinmez, "Genel" altına taşınır.`)) return
    await window.api.deleteProject(id)
    setNotes((ns) => ns.map((n) => { if (n.projectId !== id) return n; const { projectId, ...rest } = n; return rest }))
    setProjects((ps) => ps.filter((x) => x.id !== id))
    if (id === activeProjectId) setActiveProjectId(null)
    if (id === refId) setRefId(null)
  }
  function pickProject(id: string) { setActiveProjectId(id); if (narrow()) setSidebar(false) }
  function openNote(id: string) { setActiveNoteId(id); setView('notes') }
  const openFile = (fileId: string, page: number | null) => setViewer({ fileId, page })
  /** Cevaptaki [K#] etiketi: dosyaysa görüntüleyicide ilgili sayfada, notsa not düzenleyicide açılır. */
  function openSource(s: SourceRef) {
    if (s.sourceType === 'file') openFile(s.sourceId, s.page)
    else if (notes.some((n) => n.id === s.sourceId)) openNote(s.sourceId)
    else alert('Bu not artık yok.')
  }

  // ---- web kaynakları ----
  const openWeb = (w: WebRef) => { window.api.openExternal(w.url).then((ok) => { if (!ok) alert('Bu adres açılamadı.') }) }
  /** Uygulamanın kendisinin oluşturduğu not (web kaynağı, modelin önerisi); diğer notlar gibi kaydedilip indekslenir. */
  function addNote(init: Pick<Note, 'title' | 'body'> & Partial<Pick<Note, 'projectId' | 'createdBy' | 'chatId'>>): Note {
    const now = Date.now()
    const note: Note = { id: uid(), ...init, createdAt: now, updatedAt: now }
    notesRef.current = [note, ...notesRef.current]; setNotes(notesRef.current)
    return note
  }
  /** Web kaynağını seçilen projede not olarak kaydeder. */
  function saveWebNote(w: WebRef, projectId: string) {
    addNote({ title: (w.title || domainOf(w.url)).slice(0, 120), body: [`Kaynak: ${w.url}`, w.content.trim()].filter(Boolean).join('\n\n'), projectId })
  }

  // ---- modelin not önerileri (create_note / append_to_note / edit_note) ----
  const patchOp = (chatId: string, msgId: string, opId: string, patch: Partial<NoteOp>) =>
    patchChat(chatId, (c) => ({ ...c, msgs: c.msgs.map((m) => (m.id === msgId ? { ...m, noteOps: m.noteOps?.map((o) => (o.id === opId ? { ...o, ...patch } : o)) } : m)) }))
  // Not diske ve indekse hemen yazılır: araç sonucu modele döndüğünde not gerçekten kaydedilmiş ve aranabilir olmalı.
  const flushNotes = () => window.api.saveNotes(notesRef.current.filter((n) => !isEmptyNote(n)), true)
  /** Öneriyi yazar ve sonucu cevabı üreten araç döngüsüne bildirir. edit: kullanıcının önizleme kartındaki son hali. */
  async function commitOp(chatId: string, msgId: string, op: NoteOp, edit?: NoteEdit) {
    const title = (edit?.title ?? op.title).replace(/\s+/g, ' ').trim().slice(0, 120) || 'Yeni not'
    // Düzenlemede metin olduğu gibi kullanılır: baştaki/sondaki boşluk satır içi değişiklikte anlamlıdır, boş metin silmedir.
    const body = op.kind === 'edit' ? edit?.body ?? op.body : (edit?.body ?? op.body).trim()
    const edited = !!edit && (body !== op.body || (op.kind === 'create' && title !== op.title))
    const all = await window.api.listProjects().catch(() => projects)
    try {
      if (!body && op.kind !== 'edit') throw new Error('İçerik boş.')
      if (op.kind === 'create') {
        const pr = all.find((x) => x.id === (edit ? edit.projectId : op.projectId))
        const note = addNote({ title, body, ...(pr ? { projectId: pr.id } : {}), createdBy: 'ai', chatId })
        await flushNotes()
        patchOp(chatId, msgId, op.id, { status: 'saved', title, body, projectId: pr?.id ?? null, noteId: note.id, savedAt: note.updatedAt })
        await window.api.resolveNote(msgId, op.id, { action: 'saved', noteId: note.id, projectName: pr?.name ?? 'Genel', edited })
      } else {
        const cur = notesRef.current.find((n) => n.id === op.noteId)
        if (!cur) throw new Error('Not artık yok.')
        // Düzenleme: değişecek kısım notta hâlâ tam bir kez geçmeli (öneri beklerken not elle değişmiş olabilir).
        const oldText = op.oldText ?? ''
        if (op.kind === 'edit' && (!oldText || cur.body.split(oldText).length !== 2)) throw new Error('Not bu arada değişmiş; değişecek kısım artık tek bir yerde geçmiyor.')
        // Önce notun şimdiki hali saklanır; saklanamazsa nota dokunulmaz (geri alınamayan değişiklik yapılmaz).
        const revId = await window.api.addRevision({ noteId: cur.id, title: cur.title, body: cur.body, reason: op.kind === 'edit' ? 'edit' : 'append', chatId })
        if (revId == null) throw new Error('Notun önceki hali saklanamadı.')
        const now = Date.now(), old = cur.body.replace(/\s+$/, '')
        const at = cur.body.indexOf(oldText)
        const nextBody = op.kind === 'edit' ? cur.body.slice(0, at) + body + cur.body.slice(at + oldText.length) : (old ? old + '\n\n' : '') + body
        notesRef.current = notesRef.current.map((n) => (n.id === cur.id ? { ...n, body: nextBody, updatedAt: now } : n)); setNotes(notesRef.current)
        await flushNotes()
        patchOp(chatId, msgId, op.id, { status: 'saved', body, revId, savedAt: now })
        await window.api.resolveNote(msgId, op.id, { action: 'saved', noteId: cur.id, projectName: all.find((x) => x.id === cur.projectId)?.name ?? 'Genel', edited })
      }
    } catch (e: any) {
      const message = String(e?.message || e).slice(0, 200)
      patchOp(chatId, msgId, op.id, { status: 'cancelled', error: message })
      window.api.resolveNote(msgId, op.id, { action: 'error', message }).catch(() => {})
    }
  }
  // ---- modelin takvim önerileri (create_event / update_event / delete_event): not önerileriyle aynı onay ve geri alma akışı ----
  async function commitEventOp(chatId: string, msgId: string, op: NoteOp) {
    try {
      let eventId = op.eventId, before = op.before
      if (op.kind === 'create') eventId = (await window.api.createEvent(op.event!, 'ai')).id
      else if (op.kind === 'update') { if (!(await window.api.updateEvent(op.eventId!, op.event!))) throw new Error('Etkinlik artık yok.') }
      else { before = (await window.api.deleteEvent(op.eventId!)) ?? undefined; if (!before) throw new Error('Etkinlik artık yok.') }
      patchOp(chatId, msgId, op.id, { status: 'saved', eventId, before })
      bumpCal()
      await window.api.resolveNote(msgId, op.id, { action: 'saved', eventId })
    } catch (e: any) {
      const message = String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '').slice(0, 200)
      patchOp(chatId, msgId, op.id, { status: 'cancelled', error: message })
      window.api.resolveNote(msgId, op.id, { action: 'error', message }).catch(() => {})
    }
  }
  /** Geri al: eklenen etkinlik silinir, değiştirilen önceki haline döner, silinen geri yüklenir. */
  async function undoEventOp(chatId: string, msgId: string, op: NoteOp) {
    try {
      if (op.kind === 'create') await window.api.deleteEvent(op.eventId!)
      else if (op.kind === 'update') { if (!op.before || !(await window.api.updateEvent(op.eventId!, op.before))) { alert('Bu etkinlik artık yok.'); return } }
      else if (!op.before || !(await window.api.restoreEvent(op.before))) { alert('Etkinlik geri yüklenemedi.'); return }
      patchOp(chatId, msgId, op.id, { status: 'undone' }); bumpCal()
    } catch { alert('İşlem geri alınamadı.') }
  }
  // ---- modelin takip işlemleri: create_tracker onay kartıyla, log_entry onaysız (yalnızca geri alınır) ----
  async function commitTrackerOp(chatId: string, msgId: string, op: NoteOp) {
    try {
      const t = await window.api.createTracker(op.tracker!)
      patchOp(chatId, msgId, op.id, { status: 'saved', trackerId: t.id }); bumpTrk()
      await window.api.resolveNote(msgId, op.id, { action: 'saved', trackerId: t.id })
    } catch (e: any) {
      const message = String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '').slice(0, 200)
      patchOp(chatId, msgId, op.id, { status: 'cancelled', error: message })
      window.api.resolveNote(msgId, op.id, { action: 'error', message }).catch(() => {})
    }
  }
  async function undoTrackerOp(chatId: string, msgId: string, op: NoteOp) {
    try {
      if (op.target === 'entry') await window.api.deleteTrackerEntry(op.entryId!)
      else {
        if (!confirm(`"${op.title}" takibi ve varsa kayıtları silinsin mi?`)) return
        await window.api.deleteTracker(op.trackerId!)
        // Takiple birlikte kayıtları da silindi: bu sohbette o takibe eklenmiş kayıt etiketleri de geri alınmış görünür.
        patchChat(chatId, (c) => ({ ...c, msgs: c.msgs.map((m) => ({ ...m, noteOps: m.noteOps?.map((o) => (o.target === 'entry' && o.trackerId === op.trackerId && o.status === 'saved' ? { ...o, status: 'undone' as const } : o)) })) }))
      }
      patchOp(chatId, msgId, op.id, { status: 'undone' }); bumpTrk()
    } catch { alert('İşlem geri alınamadı.') }
  }
  function cancelOp(chatId: string, msgId: string, op: NoteOp) {
    patchOp(chatId, msgId, op.id, { status: 'cancelled' })
    window.api.resolveNote(msgId, op.id, { action: 'cancel' }).catch(() => {})
  }
  /** Geri al: oluşturulan not silinir; ekleme ve düzenlemede not, değişiklikten önce saklanan haline döner. */
  async function undoOp(chatId: string, msgId: string, op: NoteOp) {
    const cur = notesRef.current.find((n) => n.id === op.noteId)
    const changed = !!cur && cur.updatedAt !== op.savedAt
    if (op.kind === 'create') {
      if (cur && changed && !confirm('Bu not oluşturulduktan sonra değiştirilmiş. Yine de silinsin mi?')) return
      if (cur) delNote(cur.id)
    } else {
      if (!cur) { alert('Bu not artık yok.'); return }
      const rev = op.revId != null ? await window.api.getRevision(op.revId).catch(() => null) : null
      if (!rev) { alert('Notun önceki hali bulunamadı; değişiklik geri alınamıyor.'); return }
      if (changed && !confirm('Bu not o zamandan beri değiştirilmiş. Geri alınırsa sonraki değişiklikler de silinir. Devam edilsin mi?')) return
      patchNote(cur.id, { body: rev.body })
    }
    patchOp(chatId, msgId, op.id, { status: 'undone' })
  }
  function openOpNote(op: NoteOp) {
    if (op.noteId && notes.some((n) => n.id === op.noteId)) openNote(op.noteId)
    else alert('Bu not artık yok.')
  }
  /** Önizlemedeki [[dosya adı#sayfa]]: ad önce notun projesinde, bulunamazsa tüm dosyalarda aranır (not düzenleyicideki gibi). */
  async function openLink(name: string, page: number | null, projectId: string | null) {
    const same = (f: { name: string }) => f.name.toLocaleLowerCase('tr-TR') === name.toLocaleLowerCase('tr-TR')
    const f = (projectId ? await window.api.listFiles(projectId).catch(() => []) : []).find(same) ?? (await window.api.listFiles(null).catch(() => [])).find(same)
    if (f) openFile(f.id, page); else alert('Bu dosya bulunamadı.')
  }

  // ---- @proje ----
  const projectRef = projects.find((x) => x.id === refId) ?? null
  const matches = useMemo(() => {
    if (!mention) return []
    const q = fold(mention.q.trim())
    return projects.filter((x) => fold(x.name).includes(q)).sort((a, b) => Number(fold(b.name).startsWith(q)) - Number(fold(a.name).startsWith(q))).slice(0, 8)
  }, [mention, projects])
  const mentionOpen = !!mention && (matches.length > 0 || (projects.length === 0 && !mention.q))
  function syncMention(text: string, caret: number) { setMention(mode === 'coach' ? null : mentionAt(text, caret)); setMIdx(0) }
  function chooseProject(pr: Project) {
    if (!mention) return
    const caret = taRef.current?.selectionStart ?? draft.length
    const head = draft.slice(0, mention.start)
    setDraft(head + draft.slice(caret).replace(/^ /, '')); setRefId(pr.id); setMention(null)
    setTimeout(() => { const t = taRef.current; if (t) { t.focus(); t.setSelectionRange(head.length, head.length) } }, 0)
  }
  function pickChat(id: string) {
    if (streaming) return
    setActiveId(id); setMention(null)
    // sohbetin son mesajında proje seçiliyse yazı alanında da seçili gelsin
    const last = [...(chats.find((c) => c.id === id)?.msgs ?? [])].reverse().find((m) => m.role === 'user')
    setRefId(last?.projectId && projects.some((x) => x.id === last.projectId) ? last.projectId : null)
    if (narrow()) setSidebar(false)
  }

  function run(chatId: string, history: Msg[]) {
    if (!settings || !provider) return
    const lastUser = [...history].reverse().find((m) => m.role === 'user')
    const projectId = mode !== 'coach' && lastUser?.projectId && projects.some((x) => x.id === lastUser.projectId) ? lastUser.projectId : undefined
    const botId = uid()
    const started = Date.now()
    let acc = '', thinkAcc = ''
    // Düşünme: model destekliyorsa seçili seviye isteğe eklenir; panel cevap başlamadan önce açılır.
    // Sayaç her modelde açık; model düşünmeyi desteklemiyorsa ana süreç parametreyi çıkarıp yeniden dener.
    const known = detectReasoning(provider.model)
    const rc = normalizeReasoning(settings.reasoning)
    const enabled = rc.level !== 'off'
    const think0: ThinkInfo | undefined = known ? { requested: enabled, level: rc.level, start: started } : undefined
    patchChat(chatId, (c) => ({ ...c, msgs: [...history, { id: botId, role: 'assistant', text: '', think: think0 }], updatedAt: Date.now() }))
    setStreaming(true); stick.current = true
    const setBot = (fn: (m: Msg) => Msg) => patchChat(chatId, (c) => ({ ...c, msgs: c.msgs.map((m) => (m.id === botId ? fn(m) : m)) }))
    // Cevap bittiğinde (ya da durdurulduğunda) hâlâ onay bekleyen öneri kalmaz: araç döngüsü artık sonucu bekleyemez.
    const closeOps = (ops?: NoteOp[]) => ops?.map((o) => (o.status === 'pending' ? { ...o, status: 'cancelled' as const } : o))
    abortRef.current = window.api.stream(
      {
        requestId: botId, mode, providerId: provider.id, model: provider.model, messages: history.filter((m) => !m.error).map((m) => ({ role: m.role, content: contentOf(m) })),
        reasoning: enabled || known ? rc.level : undefined,
        // sources her zaman gider: proje seçili değilken de not içeriğindeki [K#] etiketleri bağlantıya çevrilebilsin
        sources: chats.find((c) => c.id === chatId)?.sources ?? [],
        ...(projectId ? { projectId, userText: lastUser!.text } : {}),
        ...(web && webOk.ok ? { web: true, webSources: chats.find((c) => c.id === chatId)?.webSources ?? [] } : {})
      },
      {
        // Arama sonuçları geldikçe: kaynak listesi güncellenir ve "Web'de aranıyor…" satırı görünür (cevap bitince arama sayısına döner).
        onWeb: (webSources, ns) => {
          patchChat(chatId, (c) => ({ ...c, webSources }))
          setBot((m) => ({ ...m, web: [...new Set([...(m.web ?? []), ...ns])], steps: m.steps?.some((s) => s.kind === 'web') ? m.steps : [...(m.steps ?? []), { kind: 'web', text: '' }] }))
        },
        onTool: (e) => setBot((m) => {
          const steps = m.steps ?? []
          if (e.phase === 'start') return { ...m, steps: [...steps, { kind: e.kind, text: e.text }] }
          const i = steps.map((s) => s.count == null).lastIndexOf(true)
          // 'progress': süren adımın metni güncellenir (uzun belge özetlenirken hangi sayfaların işlendiği)
          const next: ToolStep = e.phase === 'progress' ? { kind: e.kind, text: e.text } : { kind: e.kind, text: e.text, count: e.count ?? 0 }
          return { ...m, steps: i < 0 ? steps : steps.map((s, j) => (j === i ? next : s)) }
        }),
        // Modelin not önerisi: önizleme kartı olarak mesaja eklenir; "onaysız" ayarı açıksa yeni not hemen kaydedilir.
        onNote: (o) => {
          // Takip kaydı (log_entry) ana süreçte çoktan yazılmıştır: onay beklemez, doğrudan geri alınabilir etiket olur.
          if (o.target === 'entry') { setBot((m) => ({ ...m, noteOps: [...(m.noteOps ?? []), { ...o, status: 'saved' }] })); bumpTrk(); return }
          const op: NoteOp = { ...o, status: 'pending' }
          setBot((m) => ({ ...m, noteOps: [...(m.noteOps ?? []), op] }))
          if (op.auto && op.kind === 'create') commitOp(chatId, botId, op)
        },
        onSources: (sources) => patchChat(chatId, (c) => ({ ...c, sources })),
        onThinking: (t) => { thinkAcc += t; setBot((m) => ({ ...m, thinking: thinkAcc, think: m.think ?? { requested: enabled, level: rc.level, start: started } })) },
        onToken: (t) => {
          acc += t; const now = Date.now() // ilk cevap tokeni düşünmenin bittiği andır
          setBot((m) => ({ ...m, text: acc, think: m.think && !m.think.end ? { ...m.think, end: now } : m.think }))
        },
        onDone: (d) => {
          const now = Date.now()
          const searches = d.usage?.webSearches || 0
          const done = (steps?: ToolStep[]) => {
            const rest = (steps ?? []).filter((s) => s.kind !== 'web' && s.count != null)
            return searches ? [...rest, { kind: 'web' as const, text: '', count: searches }] : rest
          }
          setBot((m) => ({ ...m, ms: now - started, tokens: d.usage?.outputTokens || undefined, inTokens: d.usage?.inputTokens || undefined, ...(d.usage?.cost != null ? { cost: d.usage.cost } : {}), steps: done(m.steps), noteOps: closeOps(m.noteOps), ...(searches ? { webSearches: searches, webCost: d.usage?.webCost } : {}), ...(d.usage?.webNote ? { webNote: d.usage.webNote } : {}), think: m.think ? { ...m.think, end: m.think.end ?? now, tokens: d.usage?.reasoningTokens || m.think.tokens, note: d.usage?.reasoningNote } : m.think })); setStreaming(false); abortRef.current = null
          if (!d.aborted && acc && lastUser) {
            window.api.extractMemory({ mode, providerId: provider.id, model: provider.model, userText: lastUser.text, assistantText: acc })
              .then((r) => { if (r.added.length) setBot((m) => ({ ...m, memo: r.added })); else if (r.error) setBot((m) => ({ ...m, memoErr: r.error })) })
              .catch((e) => setBot((m) => ({ ...m, memoErr: 'Ana süreç yanıt vermedi — uygulamayı tamamen kapatıp npm run dev ile yeniden başlatın. (' + String(e?.message || e).slice(0, 120) + ')' })))
          }
        },
        onError: (msg) => { const now = Date.now(); setBot((m) => ({ ...m, text: acc ? acc + '\n\n' + msg : msg, error: true, steps: m.steps?.filter((s) => s.count != null), noteOps: closeOps(m.noteOps), think: m.think ? { ...m.think, end: m.think.end ?? now } : m.think })); setStreaming(false); abortRef.current = null }
      }
    )
  }

  function send() {
    let text = draft.trim()
    if (!text || streaming || !settings) return
    // Menüden seçilmeden elle yazılmış "@Proje Adı" da proje seçimi sayılır ve metinden çıkarılır.
    let ref = mode === 'coach' ? null : projectRef
    if (!ref && mode !== 'coach') {
      const f = fold(text)
      for (const pr of [...projects].sort((a, b) => b.name.length - a.name.length)) {
        const i = f.indexOf('@' + fold(pr.name))
        if (i >= 0) { ref = pr; text = (text.slice(0, i) + text.slice(i + 1 + pr.name.length)).trim(); break }
      }
      if (ref) setRefId(ref.id)
      if (!text) { setDraft(''); return }
    }
    const userMsg: Msg = { id: uid(), role: 'user', text, ...(attached.length ? { notes: attached } : {}), ...(ref ? { projectId: ref.id, projectName: ref.name } : {}) }
    let id = activeId
    let history: Msg[]
    if (!active) {
      id = uid()
      history = [userMsg]
      const chat: Chat = { id, ...(mode === 'coach' ? { mode } : {}), title: text.replace(/\s+/g, ' ').slice(0, 48), updatedAt: Date.now(), msgs: history }
      setChats((cs) => [chat, ...cs]); setActiveId(id)
    } else {
      history = [...active.msgs, userMsg]
    }
    setDraft(''); setAttached([]); setMention(null)
    run(id!, history)
  }

  function regenerate() {
    if (!active || streaming) return
    const msgs = [...active.msgs]
    while (msgs.length && msgs[msgs.length - 1].role === 'assistant') msgs.pop()
    if (msgs.length) run(active.id, msgs)
  }

  function stop() { abortRef.current?.() }

  function del(id: string) {
    setChats((cs) => cs.filter((c) => c.id !== id))
    if (id === activeId) setActiveId(null)
  }

  async function saveSettings(s: Settings) {
    await window.api.saveSettings(s)
    setSettings(await window.api.loadSettings())
  }

  async function pickModel(model: string, providerId?: string) {
    if (!settings) return
    const pid = providerId ?? provider?.id ?? settings.activeProvider
    // Koç modunda seçim yalnızca koç modunun modelini değiştirir.
    const next = mode === 'coach'
      ? { ...settings, modes: { ...settings.modes, coach: { systemPrompt: '', ...settings.modes?.coach, providerId: pid, model } } }
      : { ...settings, activeProvider: pid, providers: settings.providers.map((p) => (p.id === pid ? { ...p, model } : p)) }
    setSettings(next); setMenu(false)
    await window.api.saveSettings(next)
  }

  async function toggleSaved(providerId: string, model: string) {
    if (!settings) return
    const next = {
      ...settings,
      providers: settings.providers.map((p) => {
        if (p.id !== providerId) return p
        const cur = p.savedModels ?? []
        return { ...p, savedModels: cur.includes(model) ? cur.filter((x) => x !== model) : [...cur, model] }
      })
    }
    setSettings(next)
    await window.api.saveSettings(next)
  }

  // Düşünme sayacı: arayüzde anında güncellenir, diske gecikmeli kaydedilir.
  function setReasoning(c: ReasoningConfig) {
    if (!settings) return
    const next = { ...settings, reasoning: c }
    setSettings(next)
    clearTimeout(reasonSave.current)
    reasonSave.current = setTimeout(() => window.api.saveSettings(next), 300)
  }

  const saved = (settings?.providers ?? []).flatMap((p) => (p.savedModels ?? []).map((m) => ({ p, m })))
  const [menuModels, setMenuModels] = useState<string[]>([])
  async function toggleMenu() {
    const open = !menu
    setMenu(open)
    if (open && provider) setMenuModels((await window.api.listModels(provider.id)).slice(0, 200))
  }
  // model menüsü dışarı tıklayınca ya da Esc ile kapanır
  useEffect(() => {
    if (!menu) return
    const down = (e: MouseEvent) => { if (!(e.target as Element).closest('.menu, .model-btn')) setMenu(false) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false) }
    document.addEventListener('mousedown', down); document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key) }
  }, [menu])

  // kısayollar
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      if (e.key.toLowerCase() === 'n') { e.preventDefault(); if (view === 'notes') newNote(); else if (view === 'projects') newProject(); else if (view === 'calendar') openCalendar({ create: {} }); else if (view === 'trackers') openTrackers(true); else newChat() }
      if (e.key.toLowerCase() === 'k') { e.preventDefault(); setSidebar(true); setTimeout(() => searchRef.current?.focus(), 0) }
      if (e.key === ',') { e.preventDefault(); setShowSettings(true) }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  })

  // textarea otomatik yükseklik
  useEffect(() => {
    const t = taRef.current
    if (t) { t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 240) + 'px' }
  }, [draft])

  if (!settings) return null
    const fmt = (n: number) => (n >= 1000 ? Math.round(n / 1000) + 'K' : String(n))
  const lastBot = active?.msgs.length ? active.msgs[active.msgs.length - 1] : null
  const needsKey = provider && provider.kind === 'anthropic' && !provider.hasKey
  const ready = draft.trim().length > 0 && !streaming
  const thinks = <span className="tag" title="Düşünme (reasoning) destekli"><Level size={13} /></span>

  return (
    <div className={'app' + (isMac ? ' mac' : '')}>
      {sidebar && (
        <Sidebar view={view} onView={navigate} searchRef={searchRef} mode={mode} onMode={switchMode}
          chats={modeChats} activeId={activeId}
          onPick={pickChat}
          onNew={newChat} onDelete={del}
          notes={notes} activeNoteId={activeNoteId} onPickNote={pickNote} onNewNote={newNote} onDeleteNote={delNote}
          projects={projects} activeProjectId={activeProjectId} onPickProject={pickProject} onNewProject={newProject} onDeleteProject={delProject}
          trkTick={trkTick} onOpenTrackers={() => openTrackers()} onNewTracker={() => openTrackers(true)}
          calTick={calTick} onPickEvent={(at) => openCalendar({ at })} onNewEvent={() => openCalendar({ create: {} })}
          onClose={() => setSidebar(false)} onSettings={() => setShowSettings(true)} />
      )}
      <main>
        {view === 'trackers' ? (
          <TrackersPage sidebar={sidebar} onOpenSidebar={() => setSidebar(true)} tick={trkTick} onChanged={bumpTrk} req={trkReq} />
        ) : view === 'calendar' ? (
          <CalendarPage projects={projects} sidebar={sidebar} onOpenSidebar={() => setSidebar(true)} tick={calTick} onChanged={bumpCal} req={calReq} />
        ) : view === 'notes' ? (
          <NoteEditor note={activeNote} projects={projects} sidebar={sidebar} onOpenSidebar={() => setSidebar(true)}
            onChange={(patch) => activeNote && patchNote(activeNote.id, patch)}
            onDelete={() => activeNote && delNote(activeNote.id)} onUseInChat={() => activeNote && useNoteInChat(activeNote)} onNew={newNote} onOpenFile={openFile} />
        ) : view === 'projects' ? (
          <ProjectPage project={activeProject} notes={notes} sidebar={sidebar} onOpenSidebar={() => setSidebar(true)}
            onUpdate={(patch) => activeProject && updateProject(activeProject.id, patch)}
            onDelete={() => activeProject && delProject(activeProject.id)} onNew={newProject} onOpenNote={openNote} onOpenFile={openFile} onFilesChanged={reloadProjects}
            providerId={provider?.id} model={provider?.model} onOpenSource={openSource} calTick={calTick} />
        ) : <>
        <header className={'top' + (sidebar ? '' : ' bare')}>
          <div className="top-l">
            {!sidebar && <Reveal onOpen={() => setSidebar(true)} onNew={newChat} newLabel="Yeni sohbet" />}
            <h1>{active?.title ?? 'Yeni sohbet'}</h1>
          </div>
          <button className="pill model-btn" aria-label="Model seç" aria-haspopup="menu" aria-expanded={menu} onClick={toggleMenu}>
            {provider && <span className="prov">{provider.name}</span>}
            <span className="mid">{provider?.model || 'Model seç'}</span>
            <UpDown size={14} />
          </button>
        </header>
        {menu && (
          <div className="menu" role="menu">
            {saved.length > 0 && <div className="label mh">KAYITLI MODELLER</div>}
            {saved.map(({ p, m }) => {
              const cur = p.id === provider?.id && m === provider?.model
              return (
                <div key={p.id + '|' + m} className="mi" role="menuitemradio" aria-checked={cur} onClick={() => pickModel(m, p.id)} title={`${m} · ${p.name}`}>
                  <span className="ck">{cur && <Check size={14} />}</span>
                  <span className="mid">{m}</span>{detectReasoning(m) && thinks}
                  <span className="grow" /><span className="sub">{p.name}</span>
                  <button className="fav on" aria-label="Kayıtlı modellerden çıkar" onClick={(e) => { e.stopPropagation(); toggleSaved(p.id, m) }}><Star size={15} /></button>
                </div>
              )
            })}
            {saved.length > 0 && <div className="msep" />}
            <div className="label mh">{provider?.name.toLocaleUpperCase('tr-TR')} · TÜM MODELLER</div>
            {menuModels.length === 0 && <div className="note">Liste alınamadı. Ayarlar'dan model kimliğini elle yazabilirsiniz.</div>}
            {menuModels.map((m) => {
              const on = !!provider?.savedModels?.includes(m)
              return (
                <div key={m} className="mi" role="menuitemradio" aria-checked={m === provider?.model} onClick={() => pickModel(m)} title={m}>
                  <span className="ck">{m === provider?.model && <Check size={14} />}</span>
                  <span className="mid">{m}</span>{detectReasoning(m) && thinks}
                  <span className="grow" />
                  <button className={'fav' + (on ? ' on' : '')} aria-label={on ? 'Kayıtlı modellerden çıkar' : 'Kayıtlı modellere ekle'} onClick={(e) => { e.stopPropagation(); toggleSaved(provider!.id, m) }}><Star size={15} /></button>
                </div>
              )
            })}
            <div className="msep" />
            <div className="mi" role="menuitem" onClick={() => { setMenu(false); setShowSettings(true) }}><span className="ck" />Sağlayıcıyı değiştir…</div>
          </div>
        )}

        <div className="scroll" ref={scrollRef} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80 }}>
          <div className="thread">
            {!active && (
              <div className="empty">
                <ChatIcon size={52} />
                <h2>{mode === 'coach' ? COACH_NAME : 'Yeni sohbet'}</h2>
                <p>{mode === 'coach' ? 'Programınız, alışkanlıklarınız, beslenme ve antrenman hakkında yazın.' : 'Bir mesaj yazarak başlayın.'}</p>
                {needsKey && <button className="pill primary" onClick={() => setShowSettings(true)}>API anahtarı ekle</button>}
              </div>
            )}
            {active?.msgs.map((m, idx) =>
              m.role === 'user' ? (
                <section key={m.id} className="msg-user" aria-label="Kullanıcı mesajı">
                  {m.projectId || m.notes?.length ? (
                    <div className="att att-msg">
                      {m.projectId && <span className="att-chip kn-proj"><Folder size={13} /><span>{m.projectName}</span></span>}
                      {m.notes?.map((n) => <span key={n.id} className="att-chip"><FileText size={13} /><span>{n.title}</span></span>)}
                    </div>
                  ) : null}
                  <div className="bubble">{m.text}</div>
                </section>
              ) : (
                <section key={m.id} className="msg-bot" aria-label="Yanıt">
                  <div className="who"><i /><span className="label">YAPAY ZEKÂ</span></div>
                  {m.think && <ReasoningPanel msg={m} live={streaming && idx === active.msgs.length - 1 && !m.think.end} />}
                  {m.steps?.length ? (
                    <div className="kn-steps" aria-live="polite">
                      {m.steps.map((s, i) => <div key={i} className={'memo' + (s.count == null ? ' kn-live' : '')}>{s.kind === 'read' || s.kind === 'summarize' ? <FileText size={13} /> : s.kind === 'web' ? <Globe size={13} /> : s.kind === 'list' ? <Folder size={13} /> : s.kind === 'calendar' ? <Calendar size={13} /> : s.kind === 'tracker' ? <Checklist size={13} /> : <Search size={13} />}<span>{stepText(s)}</span></div>)}
                    </div>
                  ) : null}
                  {m.error ? <div className="err">{m.text}</div> : m.text || !m.think ? <Markdown text={m.text} sources={active.sources} onSource={openSource} web={active.webSources} onWeb={openWeb} /> : null}
                  {!m.error && active.sources?.length ? <CitedSources sources={citedSources(m.text, active.sources)} onOpen={openSource} /> : null}
                  {!m.error && active.webSources?.length ? <WebSources sources={citedWeb(m.text, active.webSources, m.web)} projects={projects} projectId={active.msgs[idx - 1]?.projectId} onOpen={openWeb} onSave={saveWebNote} /> : null}
                  {m.noteOps?.map((op) => op.target === 'tracker' || op.target === 'entry'
                    ? op.status === 'pending' && streaming && idx === active.msgs.length - 1
                      ? <TrackerCard key={op.id} op={op} onSave={() => commitTrackerOp(active.id, m.id, op)} onCancel={() => cancelOp(active.id, m.id, op)} />
                      : <TrackerChip key={op.id} op={op.status === 'pending' ? { ...op, status: 'cancelled' } : op} onOpen={() => openTrackers()} onUndo={() => undoTrackerOp(active.id, m.id, op)} />
                    : op.target === 'event'
                    ? op.status === 'pending' && streaming && idx === active.msgs.length - 1
                      ? <EventCard key={op.id} op={op} projects={projects} onSave={() => commitEventOp(active.id, m.id, op)} onCancel={() => cancelOp(active.id, m.id, op)} />
                      : <EventChip key={op.id} op={op.status === 'pending' ? { ...op, status: 'cancelled' } : op} onUndo={() => undoEventOp(active.id, m.id, op)}
                          onOpen={mode === 'coach' && op.kind !== 'delete' && op.event ? () => openCalendar({ at: op.event!.startAt }) : undefined} />
                    : op.status === 'pending' && streaming && idx === active.msgs.length - 1 && !op.auto
                    ? <NoteCard key={op.id} op={op} projects={projects} current={op.kind === 'edit' ? notes.find((n) => n.id === op.noteId)?.body : undefined} onSave={(edit) => commitOp(active.id, m.id, op, edit)} onCancel={() => cancelOp(active.id, m.id, op)} onLink={openLink} />
                    : op.status === 'pending' && streaming && idx === active.msgs.length - 1 ? null
                    : <NoteChip key={op.id} op={op.status === 'pending' ? { ...op, status: 'cancelled' } : op} onOpen={() => openOpNote(op)} onUndo={() => undoOp(active.id, m.id, op)} />)}
                  {streaming && idx === active.msgs.length - 1 && (m.text || !m.think) && !m.noteOps?.some((o) => o.status === 'pending') && <span className="cursor" />}
                  {m.webNote ? <div className="memo bad"><Globe size={13} /><span>{m.webNote}</span></div> : null}
                  {m.memoErr ? <div className="memo bad"><span>Hafıza kaydedilemedi · {m.memoErr}</span></div> : null}
                  {m.memo?.length ? <div className="memo"><Check size={13} /><span>Hafızaya kaydedildi · {m.memo.join(' · ')}</span></div> : null}
                  {!(streaming && idx === active.msgs.length - 1) && (
                    <div className="actions">
                      <button className="ib" aria-label="Yanıtı kopyala" title="Kopyala" onClick={() => navigator.clipboard.writeText(m.text)}><Copy size={17} /></button>
                      {idx === active.msgs.length - 1 && <button className="ib" aria-label="Yeniden üret" title="Yeniden üret" onClick={regenerate}><Redo size={17} /></button>}
                      {m.ms != null && <span className="meta" title={m.cost != null ? 'Giriş ve çıkış token sayısı ile sağlayıcının bildirdiği ücret (araç turları dahil)' : 'Giriş ve çıkış token sayısı (araç turları dahil)'}>{metaText(m)}</span>}
                    </div>
                  )}
                </section>
              )
            )}
          </div>
        </div>

        <div className="composer-wrap">
          <div className="composer-in">
            <div className="box">
              <label htmlFor="composer" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Mesaj</label>
              {mentionOpen && (
                <div className="pop mn-pop" role="listbox" aria-label="Proje seç">
                  <div className="label mh">PROJE SEÇ</div>
                  {matches.map((x, i) => (
                    <div key={x.id} className={'mi' + (i === mIdx ? ' on' : '')} role="option" aria-selected={i === mIdx} title={x.name}
                      onMouseEnter={() => setMIdx(i)} onMouseDown={(e) => { e.preventDefault(); chooseProject(x) }}>
                      <Folder size={15} /><span className="pj-mn">{x.name}</span><span className="grow" /><span className="sub">{x.fileCount ? x.fileCount + ' dosya' : ''}</span>
                    </div>
                  ))}
                  {matches.length === 0 && <div className="note">Henüz proje yok. Projeler bölümünden oluşturup dosya ekleyebilirsiniz.</div>}
                </div>
              )}
              {(attached.length > 0 || projectRef) && (
                <div className="att">
                  {projectRef && (
                    <span className="att-chip kn-proj" title="Model bu projenin dosya ve notlarında arama yapar"><Folder size={13} /><span>{projectRef.name}</span>
                      <button aria-label={projectRef.name + ' projesini çıkar'} onClick={() => setRefId(null)}><Close size={12} /></button>
                    </span>
                  )}
                  {attached.map((n) => (
                    <span key={n.id} className="att-chip"><FileText size={13} /><span>{n.title}</span>
                      <button aria-label={n.title + ' notunu çıkar'} onClick={() => setAttached((a) => a.filter((x) => x.id !== n.id))}><Close size={12} /></button>
                    </span>
                  ))}
                </div>
              )}
              <textarea id="composer" ref={taRef} rows={2} placeholder={mode === 'coach' ? 'Mesajınızı yazın' : 'Mesajınızı yazın · @ ile proje seçin'} value={draft}
                onChange={(e) => { setDraft(e.target.value); syncMention(e.target.value, e.target.selectionStart) }}
                onClick={(e) => syncMention(e.currentTarget.value, e.currentTarget.selectionStart)}
                onBlur={() => setMention(null)}
                onKeyDown={(e) => {
                  if (mentionOpen && !e.nativeEvent.isComposing) {
                    if (e.key === 'Escape') { e.preventDefault(); setMention(null); return }
                    if (matches.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); setMIdx((i) => (i + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length); return }
                    if (matches.length && (e.key === 'Enter' || e.key === 'Tab')) { e.preventDefault(); chooseProject(matches[mIdx]); return }
                  }
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() }
                }} />
              <div className="box-bar">
                <ReasoningControl cfg={rcfg} onChange={setReasoning} />
                {mode !== 'coach' && <NotePicker notes={notes} attached={attached} onToggle={toggleAttach} onOpenNotes={() => navigate('notes')} />}
                {/* devre dışıyken düğme fare olaylarını almaz; açıklama sarmalayıcıdan görünür */}
                <span className="rz-ctl-wrap" title={webOk.ok ? (web ? 'Web araması açık: model gerektiğinde web\'de arar' : 'Web araması kapalı') : webOk.reason ?? 'Web araması yalnızca OpenRouter modellerinde kullanılabilir'}>
                  <button className={'pill wb-btn' + (web && webOk.ok ? ' on' : '')} aria-pressed={web && webOk.ok} aria-label="Web araması" disabled={!webOk.ok} onClick={() => setWeb((w) => !w)}>
                    <Globe size={16} /><span className="pl">Web</span>
                  </button>
                </span>
                <span className="grow" />
                {draft.length > 0 && <span className="count">{draft.length}</span>}
                {streaming
                  ? <button className="send ready" aria-label="Durdur" onClick={stop}><Stop size={18} /></button>
                  : <button className={'send' + (ready ? ' ready' : '')} aria-label="Gönder" onClick={send}><Up size={18} /></button>}
              </div>
            </div>
            <div className="hint">Yapay zekâ hata yapabilir. Önemli bilgileri doğrulayın.</div>
          </div>
        </div>
        </>}
      </main>
      {viewer && <SourceViewer fileId={viewer.fileId} page={viewer.page} onClose={() => setViewer(null)} />}
      {mode === 'coach' && !settings.coachNoticeSeen && !showSettings && (
        <div className="modal-bg pad">
          <div className="cn-dlg" role="alertdialog" aria-labelledby="cn-h">
            <span className="label">BAŞLAMADAN ÖNCE</span>
            <h2 id="cn-h">{COACH_NAME}</h2>
            <div className="group">
              <div className="frow"><div className="fl col"><span>18 yaşından küçükseniz kullanmayın</span><span className="note">Bu mod yetişkinler içindir. Beslenme ve antrenman önerileri 18 yaş altı için uygun olmayabilir.</span></div></div>
              <div className="frow"><div className="fl col"><span>Güçlü bir model kullanmanızı öneririz</span><span className="note">Küçük ve ucuz modeller sağlıkla ilgili güvenlik kurallarına daha az güvenilir uyar. Modeli üstteki menüden ya da Ayarlar'dan bu mod için ayrı seçebilirsiniz.</span></div></div>
              <div className="frow"><div className="fl col"><span>Tıbbi tavsiye değildir</span><span className="note">Yapay zekâ doktor, diyetisyen ya da terapist değildir. Sağlık sorununuz varsa bir uzmana danışın.</span></div></div>
            </div>
            <div className="row-btns">
              <button className="pill" onClick={() => switchMode('chat')}>Geri dön</button>
              <button className="pill primary" autoFocus onClick={ackCoachNotice}>Anladım</button>
            </div>
          </div>
        </div>
      )}
      {showSettings && <SettingsModal settings={settings} onSave={saveSettings} onClose={() => setShowSettings(false)} />}
    </div>
  )
}
