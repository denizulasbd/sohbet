import { useState, type ReactNode } from 'react'
import type { NoteEdit, NoteOp, Project } from '../types'
import { Check, Close, Folder, Redo, UpDown } from './Icons'
import { linksIn } from '../links'

type OnLink = (name: string, page: number | null) => void

// Not biçimi (bkz. richText.ts): **kalın**, *italik* ve [[dosya adı#sayfa]]; HTML üretilmez.
function inline(text: string, onLink: OnLink): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(\[\[[^\[\]\n]+?(?:#\d+)?\]\])|(\*\*[^*\n]+\*\*)|(\*[^*\s][^*\n]*\*)/g
  let last = 0, m: RegExpExecArray | null, k = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const t = m[0]
    if (m[1]) {
      const l = linksIn(t)[0]
      out.push(<button key={k++} className="kc nw-link" title={`${l.name}${l.page != null ? ' · sayfa ' + l.page : ''}\nDosyayı aç`} onClick={() => onLink(l.name, l.page)}><span>{l.name}</span>{l.page != null && l.page}</button>)
    }
    else if (m[2]) out.push(<strong key={k++}>{t.slice(2, -2)}</strong>)
    else out.push(<em key={k++}>{t.slice(1, -1)}</em>)
    last = m.index + t.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/** Not gövdesinin salt okunur görünümü: düzenleyicideki gibi satır satır; bağlantılar tıklanınca dosya ilgili sayfada açılır. */
export function NoteBody({ text, onLink }: { text: string; onLink: OnLink }) {
  return <div className="nw-body">{text.split('\n').map((line, i) => (line.trim() ? <div key={i}>{inline(line, onLink)}</div> : <div key={i} className="nw-gap" />))}</div>
}

// ---- düzenleme önerisi: fark görünümü ----
const CONTEXT = 160 // değişen kısmın önünden ve arkasından gösterilen metin (karakter; satır başına/sonuna yuvarlanır)

/** Eski ve yeni metnin baştaki ve sondaki ortak kısmı ayrılır (kelime sınırında); yalnızca gerçekten değişen orta kısım renklendirilir. */
export function diffParts(before: string, after: string): { head: string; del: string; ins: string; tail: string } {
  let a = 0
  while (a < before.length && a < after.length && before[a] === after[a]) a++
  while (a > 0 && !/\s/.test(before[a - 1])) a--
  let b = 0
  while (b < before.length - a && b < after.length - a && before[before.length - 1 - b] === after[after.length - 1 - b]) b++
  while (b > 0 && !/\s/.test(before[before.length - b])) b--
  return { head: before.slice(0, a), del: before.slice(a, before.length - b), ins: after.slice(a, after.length - b), tail: before.slice(before.length - b) }
}

/** Notun değişecek yeri: silinen kısım kırmızı, eklenen kısım yeşil; çevresinden birkaç satır bağlam. current: notun şimdiki gövdesi. */
export function NoteDiff({ current, oldText, newText }: { current: string; oldText: string; newText: string }) {
  const at = current.indexOf(oldText)
  if (at < 0 || current.indexOf(oldText, at + 1) >= 0) return <div className="nw-body nw-diff">Not bu arada değişmiş; değişecek kısım artık {at < 0 ? 'bulunamıyor' : 'birden fazla yerde geçiyor'}.</div>
  const d = diffParts(oldText, newText)
  let from = Math.max(0, at - CONTEXT), to = Math.min(current.length, at + oldText.length + CONTEXT)
  const nl = current.lastIndexOf('\n', from)
  from = from === 0 ? 0 : nl >= 0 && at - nl < CONTEXT * 3 ? nl + 1 : from
  const end = current.indexOf('\n', to)
  to = to === current.length ? to : end >= 0 && end - (at + oldText.length) < CONTEXT * 3 ? end : to
  return (
    <div className="nw-body nw-diff">
      {from > 0 && '… '}{current.slice(from, at)}{d.head}
      {d.del && <del>{d.del}</del>}{d.ins && <ins>{d.ins}</ins>}
      {d.tail}{current.slice(at + oldText.length, to)}{to < current.length && ' …'}
    </div>
  )
}

interface CardProps {
  op: NoteOp; projects: Project[]
  /** Düzenleme önerisinde notun şimdiki gövdesi (fark buna göre gösterilir). */
  current?: string
  /** Kullanıcının son hali kaydedilir (düzenlemediyse modelin önerisi). */
  onSave(edit: NoteEdit): void
  onCancel(): void
  onLink(name: string, page: number | null, projectId: string | null): void
}

/** Modelin not önerisinin önizlemesi: hiçbir şey kullanıcı "Kaydet" demeden yazılmaz. Eklemede ve düzenlemede hedef not ve proje değiştirilemez.
 *  Düzenlemede önizleme farktır; "Düzenle" yeni metni değiştirir. */
export default function NoteCard({ op, projects, current, onSave, onCancel, onLink }: CardProps) {
  const create = op.kind === 'create', change = op.kind === 'edit'
  const [edit, setEdit] = useState(false)
  const [title, setTitle] = useState(op.title)
  const [body, setBody] = useState(op.body)
  const [pid, setPid] = useState<string | null>(op.projectId && projects.some((p) => p.id === op.projectId) ? op.projectId : null)
  const [busy, setBusy] = useState(false)
  // Düzenlemede boş metin geçerlidir (silme); değişecek kısım notta artık tek değilse kaydedilemez.
  const stale = change && (current ?? '').split(op.oldText ?? '').length !== 2
  const blocked = busy || stale || (!change && !body.trim())
  const save = () => { if (blocked) return; setBusy(true); onSave({ title, body, projectId: pid }) }

  return (
    <div className="nw-card" role="group" aria-label={create ? 'Yeni not önizlemesi' : change ? 'Not düzenleme önizlemesi' : 'Nota ekleme önizlemesi'}>
      <span className="label">{create ? 'YENİ NOT · ÖNİZLEME' : change ? 'NOTTA DEĞİŞECEK KISIM · FARK' : 'NOTUN SONUNA EKLENECEK · ÖNİZLEME'}</span>
      {edit && create
        ? <input className="nw-title-in" aria-label="Not başlığı" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
        : <div className="nw-title">{title.trim() || 'Yeni not'}</div>}
      {create ? (
        <label className="pill sm nw-pick" title="Notun kaydedileceği proje" style={{ alignSelf: 'flex-start' }}>
          <Folder size={14} />
          <select aria-label="Proje" value={pid ?? ''} onChange={(e) => setPid(e.target.value || null)}>
            <option value="">Genel</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <UpDown size={13} />
        </label>
      ) : <div className="nw-target"><Folder size={14} /><span>{projects.find((p) => p.id === pid)?.name ?? 'Genel'}</span></div>}
      {edit
        ? <textarea className="tarea nw-ta" aria-label={change ? 'Yeni metin' : 'Not içeriği'} value={body} onChange={(e) => setBody(e.target.value)} />
        : change ? <NoteDiff current={current ?? ''} oldText={op.oldText ?? ''} newText={body} />
        : <NoteBody text={body} onLink={(name, page) => onLink(name, page, pid)} />}
      <div className="nw-acts">
        <button className="pill primary" disabled={blocked} onClick={save}>Kaydet</button>
        <button className="pill" disabled={busy || stale} onClick={() => setEdit((e) => !e)}>{edit ? (change ? 'Farkı göster' : 'Önizleme') : 'Düzenle'}</button>
        <button className="pill plain" disabled={busy} onClick={onCancel}>Vazgeç</button>
      </div>
    </div>
  )
}

/** Önerinin sonucu: kaydedildiyse notu açan ve geri alınabilen etiket; değilse tek satır bilgi. */
export function NoteChip({ op, onOpen, onUndo }: { op: NoteOp; onOpen(): void; onUndo(): void }) {
  const create = op.kind === 'create'
  const done = create ? 'Not oluşturuldu' : op.kind === 'edit' ? 'Not düzenlendi' : 'Nota eklendi'
  const not = create ? 'Not oluşturulmadı' : op.kind === 'edit' ? 'Not düzenlenmedi' : 'Nota eklenmedi'
  if (op.status === 'saved') return (
    <div className="nw-chip">
      <button className="nw-open" title="Notu aç" onClick={onOpen}><Check size={13} /><span>{done}: <b>{op.title}</b></span></button>
      <button className="nw-undo" title={create ? 'Notu sil' : 'Notu önceki haline döndür'} onClick={onUndo}>Geri al</button>
    </div>
  )
  if (op.status === 'undone') return <div className="memo"><Redo size={13} /><span>Geri alındı · {create ? 'not silindi' : op.kind === 'edit' ? 'düzenleme kaldırıldı' : 'ekleme kaldırıldı'}: {op.title}</span></div>
  return <div className={'memo' + (op.error ? ' bad' : '')}><Close size={13} /><span>{op.error ? `Not kaydedilemedi · ${op.error}` : `${not} · ${op.title}`}</span></div>
}
