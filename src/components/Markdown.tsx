import { useState, type ReactNode } from 'react'
import type { SourceRef, WebRef } from '../types'
import { Copy } from './Icons'
import { anchorWeb, domainOf, findWeb, sourceTitle } from './Sources'

/** sources verilirse metindeki [K#] etiketleri tıklanabilir olur. web verilirse [W#] etiketleri ve web kaynağına giden bağlantılar web etiketine dönüşür. */
interface Ctx { sources?: SourceRef[]; onSource?(s: SourceRef): void; web?: WebRef[]; onWeb?(w: WebRef): void }
const webChip = (w: WebRef, ctx: Ctx, key: number) => (
  <button key={key} className="kc wc" title={`${w.title || domainOf(w.url)}\n${w.url}`} onClick={() => ctx.onWeb!(w)}>W{w.n}<i>{domainOf(w.url)}</i></button>
)

// Bağımlılıksız, güvenli (HTML üretmez) küçük markdown çevirici: kod blokları, satır içi kod, kalın, listeler, bağlantılar.
function inline(text: string, ctx?: Ctx): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\s][^*\n]*\*)|(\[[^\]\n]+\]\(https?:\/\/[^)\s]+\))|(\[K\d+(?:\s*[,;]\s*K\d+)*\])|(\[W\d+(?:\s*[,;]\s*W\d+)*\])/g
  let last = 0, m: RegExpExecArray | null, k = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const t = m[0]
    if (t.startsWith('`')) out.push(<span key={k++} className="ic">{t.slice(1, -1)}</span>)
    else if (t.startsWith('**')) out.push(<strong key={k++}>{t.slice(2, -2)}</strong>)
    else if (t.startsWith('*')) out.push(<em key={k++}>{t.slice(1, -1)}</em>)
    else if (m[5]) {
      // kaynak etiketi: bilinen numaralar düğme olur, bilinmeyenler yazıldığı gibi kalır
      for (const x of t.matchAll(/K(\d+)/g)) {
        const s = ctx?.onSource ? ctx.sources?.find((y) => y.n === Number(x[1])) : undefined
        out.push(s ? <button key={k++} className="kc" title={sourceTitle(s)} onClick={() => ctx!.onSource!(s)}>K{s.n}</button> : `[K${x[1]}]`)
      }
    }
    else if (m[6]) {
      for (const x of t.matchAll(/W(\d+)/g)) {
        const w = ctx?.onWeb ? ctx.web?.find((y) => y.n === Number(x[1])) : undefined
        out.push(w ? webChip(w, ctx!, k++) : `[W${x[1]}]`)
      }
    }
    else {
      const mm = /\[([^\]]+)\]\(([^)]+)\)/.exec(t)!
      // web aramasından gelen bir sayfaya verilen bağlantı [W#] etiketi olarak gösterilir
      const w = ctx?.onWeb ? findWeb(ctx.web, mm[2]) : undefined
      if (w) out.push(webChip(w, ctx!, k++))
      else out.push(<a key={k++} href={mm[2]} target="_blank" rel="noreferrer">{mm[1]}</a>)
    }
    last = m.index + t.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [ok, setOk] = useState(false)
  return (
    <div className="code">
      <div className="code-h">
        <span className="label">{(lang || 'kod').toUpperCase()}</span>
        <button aria-label="Kodu kopyala" onClick={() => { navigator.clipboard.writeText(code); setOk(true); setTimeout(() => setOk(false), 1200) }}>
          <Copy size={14} />{ok ? 'Kopyalandı' : 'Kopyala'}
        </button>
      </div>
      <pre>{code}</pre>
    </div>
  )
}

export default function Markdown({ text: raw, sources, onSource, web, onWeb }: { text: string } & Ctx) {
  const ctx: Ctx = { sources, onSource, web, onWeb }
  const text = onWeb ? anchorWeb(raw, web) : raw
  const HEAD = /^(#{1,6})\s+(.+?)\s*#*\s*$/
  const blocks: ReactNode[] = []
  const lines = text.split('\n')
  let i = 0, key = 0
  while (i < lines.length) {
    const line = lines[i]
    const fence = /^```(\w*)/.exec(line)
    if (fence) {
      const buf: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) buf.push(lines[i++])
      i++
      blocks.push(<CodeBlock key={key++} lang={fence[1]} code={buf.join('\n')} />)
    } else if (HEAD.test(line)) {
      const h = HEAD.exec(line)!
      i++
      blocks.push(h[1].length <= 2 ? <h3 key={key++}>{inline(h[2], ctx)}</h3> : <h4 key={key++}>{inline(h[2], ctx)}</h4>)
    } else if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line)
      const items: string[] = []
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, ''))
      const li = items.map((t, n) => <li key={n}>{inline(t, ctx)}</li>)
      blocks.push(ordered ? <ol key={key++}>{li}</ol> : <ul key={key++}>{li}</ul>)
    } else if (line.trim() === '') {
      i++
    } else {
      const buf: string[] = []
      while (i < lines.length && lines[i].trim() !== '' && !lines[i].startsWith('```') && !HEAD.test(lines[i]) && !/^\s*([-*]|\d+\.)\s+/.test(lines[i])) buf.push(lines[i++])
      blocks.push(<p key={key++}>{inline(buf.join(' '), ctx)}</p>)
    }
  }
  return <div className="prose">{blocks}</div>
}
