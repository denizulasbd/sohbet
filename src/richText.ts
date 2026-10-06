// Not editörü (contenteditable) ile düz "markdown" metin arasında dönüşüm ve imleç yardımcıları.
// Kayıt biçimi hep düz metindir: **kalın**, *italik*, satır başında "☐ ", "☑ ", "• ".
export const PFX = ['☐ ', '☑ ', '• ']
export const prefixOfText = (t: string) => PFX.find((p) => t.startsWith(p)) ?? ''

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function mdToHtml(md: string): string {
  return md.split('\n').map((line) => {
    if (!line) return '<div><br></div>'
    const h = esc(line)
      .replace(/\*\*\*([^*\s](?:[^*]*[^*\s])?)\*\*\*/g, '<b><i>$1</i></b>')
      .replace(/\*\*([^*\s](?:[^*]*[^*\s])?)\*\*/g, '<b>$1</b>')
      .replace(/\*([^*\s](?:[^*]*[^*\s])?)\*/g, '<i>$1</i>')
    return `<div>${h}</div>`
  }).join('')
}

function inlineMd(node: Node): string {
  let out = ''
  node.childNodes.forEach((c) => {
    if (c.nodeType === 3) { out += (c as Text).data; return }
    if (!(c instanceof HTMLElement)) return
    if (c.tagName === 'BR') { out += '\n'; return }
    const inner = inlineMd(c)
    const fw = c.style.fontWeight
    const bold = c.tagName === 'B' || c.tagName === 'STRONG' || fw === 'bold' || parseInt(fw) >= 600
    const it = c.tagName === 'I' || c.tagName === 'EM' || c.style.fontStyle === 'italic'
    if (!inner.trim() || (!bold && !it)) { out += inner; return }
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner)!
    const mark = (bold ? '**' : '') + (it ? '*' : '')
    out += m[1] + mark + m[2] + mark + m[3]
  })
  return out
}

function blockLines(node: HTMLElement, out: string[]) {
  const kids = Array.from(node.children)
  if (kids.some((k) => k.tagName === 'DIV' || k.tagName === 'P')) { kids.forEach((k) => k instanceof HTMLElement && blockLines(k, out)); return }
  if (node.childNodes.length === 1 && node.firstChild instanceof HTMLElement && node.firstChild.tagName === 'BR') { out.push(''); return }
  out.push(...inlineMd(node).split('\n'))
}

export function htmlToMd(root: HTMLElement): string {
  const lines: string[] = []
  let run = ''
  const flush = () => { if (run) { lines.push(...run.split('\n')); run = '' } }
  root.childNodes.forEach((c) => {
    if (c instanceof HTMLElement && (c.tagName === 'DIV' || c.tagName === 'P')) { flush(); blockLines(c, lines) }
    else { const w = document.createElement('div'); w.append(c.cloneNode(true)); run += inlineMd(w) }
  })
  flush()
  // liste işareti biçimin dışında kalsın: **☐ metin** → ☐ **metin**
  return lines.map((l) => l.replace(/^(\*{1,3})([☐☑•] )/, '$2$1')).join('\n').replace(/\u00a0/g, ' ')
}

// ---- imleç / seçim yardımcıları ----
function textNodes(block: Node): Text[] {
  const w = document.createTreeWalker(block, NodeFilter.SHOW_TEXT)
  const out: Text[] = []
  for (let n = w.nextNode(); n; n = w.nextNode()) out.push(n as Text)
  return out
}

export function charRange(block: Node, from: number, to: number): Range {
  const r = document.createRange()
  const nodes = textNodes(block)
  if (!nodes.length) { r.setStart(block, 0); r.collapse(true); return r }
  let pos = 0, started = false
  for (const n of nodes) {
    const len = n.data.length
    if (!started && from <= pos + len) { r.setStart(n, from - pos); started = true }
    if (started && to <= pos + len) { r.setEnd(n, to - pos); return r }
    pos += len
  }
  const last = nodes[nodes.length - 1]
  if (!started) r.setStart(last, last.data.length)
  r.setEnd(last, last.data.length)
  return r
}

export function selectChars(block: Node, from: number, to: number) {
  const s = window.getSelection()
  if (!s) return
  s.removeAllRanges(); s.addRange(charRange(block, from, to))
}

export function blockOf(root: HTMLElement, node: Node | null): HTMLElement | null {
  let n = node
  while (n && n.parentNode !== root) n = n.parentNode
  return n instanceof HTMLElement ? n : null
}

export function caretOffset(block: HTMLElement): number | null {
  const s = window.getSelection()
  if (!s || !s.rangeCount) return null
  const r = s.getRangeAt(0)
  if (!block.contains(r.startContainer)) return null
  const pre = document.createRange()
  pre.selectNodeContents(block); pre.setEnd(r.startContainer, r.startOffset)
  return pre.toString().length
}

export function selectedBlocks(root: HTMLElement): HTMLElement[] {
  const s = window.getSelection()
  if (!s || !s.rangeCount) return []
  const r = s.getRangeAt(0)
  return (Array.from(root.children) as HTMLElement[]).filter((c) => r.intersectsNode(c))
}

/** Satırın başındaki ☐/☑/• işaretini değiştirir (undo geçmişini bozmamak için execCommand ile). */
export function setPrefix(block: HTMLElement, next: string) {
  const old = prefixOfText(block.textContent ?? '')
  const caret = caretOffset(block)
  selectChars(block, 0, old.length)
  if (next) document.execCommand('insertText', false, next)
  else if (old) document.execCommand('delete')
  if (caret != null) { const o = Math.max(0, caret + next.length - old.length); selectChars(block, o, o) }
}

/** Seçili satırlarda ☐ → ☑ → (yok) ya da • aç/kapat; ilk satırın durumu hepsine uygulanır. */
export function cyclePrefixes(root: HTMLElement, kind: 'check' | 'bullet') {
  const blocks = selectedBlocks(root)
  if (!blocks.length) return
  const cur = prefixOfText(blocks[0].textContent ?? '')
  const next = kind === 'check' ? (cur === '☐ ' ? '☑ ' : cur === '☑ ' ? '' : '☐ ') : cur === '• ' ? '' : '• '
  blocks.forEach((b) => setPrefix(b, next))
}

/** Enter: madde satırında yeni madde açar, boş maddede listeyi bitirir. İşlendiyse true. */
export function handleEnter(root: HTMLElement): boolean {
  const s = window.getSelection()
  if (!s || !s.rangeCount || !s.isCollapsed) return false
  const block = blockOf(root, s.anchorNode)
  if (!block) return false
  const text = block.textContent ?? ''
  const p = prefixOfText(text)
  const off = caretOffset(block)
  if (!p || off == null || off < p.length) return false
  if (text.trim() === p.trim()) { setPrefix(block, ''); return true }
  document.execCommand('insertParagraph')
  document.execCommand('insertText', false, p === '• ' ? '• ' : '☐ ')
  return true
}

/** Kutucuğun hemen sağına tıklanınca ☐ ↔ ☑. */
export function toggleBoxAtCaret(root: HTMLElement): boolean {
  const s = window.getSelection()
  if (!s || !s.rangeCount || !s.isCollapsed) return false
  const block = blockOf(root, s.anchorNode)
  if (!block) return false
  const t = block.textContent ?? ''
  if (caretOffset(block) !== 1 || (t[0] !== '☐' && t[0] !== '☑')) return false
  selectChars(block, 0, 1)
  document.execCommand('insertText', false, t[0] === '☐' ? '☑' : '☐')
  selectChars(block, 1, 1)
  return true
}
