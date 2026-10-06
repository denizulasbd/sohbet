// Arka plan işçisi: Electron utilityProcess içinde çalışır, ana süreci ve arayüzü bloklamaz (bkz. jobs.cjs).
// Gelen iş: { jid, kind, … } · Giden: { jid, type: 'progress' | 'done' | 'error', … }. Veritabanına yalnızca ana süreç yazar.
// İş türleri: extract (metin çıkarma + parçalama) · ocr (taranmış PDF sayfası → metin) · render (PDF sayfası → PNG) · embed (metin → vektör)
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import chunker from './chunker.cjs'

const require = createRequire(import.meta.url)
// Bir PDF sayfasından bundan az (boşluk hariç) karakter çıkıyorsa sayfa taranmış sayılır ve OCR için işaretlenir.
const OCR_MIN = 20
const post = (m) => process.parentPort.postMessage(m)
const clean = (s) => s.replace(/\u0000/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()

let pdfjs
async function loadPdfjs() {
  // Node tarafında legacy build gerekir (tarayıcı API'lerine bağımlı değildir).
  // utilityProcess'te pdfjs kendini Node saymaz (process.type === 'utility') ve ayrı bir worker dosyası ister;
  // worker modülü önceden yüklenince ayrıştırma bu süreçte, ek worker olmadan yapılır.
  globalThis.pdfjsWorker ??= await import('pdfjs-dist/legacy/build/pdf.worker.mjs')
  pdfjs ??= await import('pdfjs-dist/legacy/build/pdf.mjs')
  return pdfjs
}

async function extractPdf(job, progress) {
  const pdfjs = await loadPdfjs()
  const data = new Uint8Array(await fs.readFile(job.path))
  const task = pdfjs.getDocument({ data, verbosity: 0, isEvalSupported: false, useSystemFonts: false, disableFontFace: true })
  try {
    const doc = await task.promise
    const pages = []
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      const tc = await page.getTextContent()
      let text = ''
      for (const it of tc.items) if (typeof it.str === 'string') text += it.str + (it.hasEOL ? '\n' : '')
      text = clean(text)
      pages.push({ page: n, text, needsOcr: text.replace(/\s/g, '').length < OCR_MIN })
      page.cleanup()
      progress({ page: n, total: doc.numPages })
    }
    return { pageCount: doc.numPages, pages }
  } finally { await task.destroy() }
}

async function extractText(job) {
  const text = clean((await fs.readFile(job.path, 'utf8')).replace(/^﻿/, '').replace(/\r\n?/g, '\n'))
  return { pageCount: null, pages: [{ page: 1, text, needsOcr: false }] }
}

// DOCX'te sayfa kavramı yoktur (sayfalar ancak yazdırma düzeninde oluşur); belge tek parça metin olarak alınır.
async function extractDocx(job) {
  const { default: mammoth } = await import('mammoth')
  const { value } = await mammoth.extractRawText({ path: job.path })
  return { pageCount: null, pages: [{ page: 1, text: clean(value), needsOcr: false }] }
}

const unxml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, '&')

// PPTX: her slayt bir sayfa sayılır. Slayt sırası dosya adlarından değil sunumun kendi listesinden (sldIdLst) okunur.
async function extractPptx(job, progress) {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(await fs.readFile(job.path))
  const read = (p) => zip.file(p)?.async('string')
  const rels = (await read('ppt/_rels/presentation.xml.rels')) ?? ''
  const target = {}
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[0])?.[1], t = /\bTarget="([^"]+)"/.exec(m[0])?.[1]
    if (id && t) target[id] = t.replace(/^\/?(ppt\/)?/, 'ppt/')
  }
  const pres = (await read('ppt/presentation.xml')) ?? ''
  let order = [...pres.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)].map((m) => target[m[1]]).filter((p) => p && zip.file(p))
  if (!order.length) {
    const num = (p) => Number(/(\d+)\.xml$/.exec(p)[1])
    order = Object.keys(zip.files).filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p)).sort((a, b) => num(a) - num(b))
  }
  if (!order.length) throw new Error('Sunumda slayt bulunamadı.')
  const pages = []
  for (let i = 0; i < order.length; i++) {
    const xml = await read(order[i])
    const paras = [...xml.matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)]
      .map((p) => [...p[1].matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>|<a:br\b[^>]*\/>/g)].map((t) => (t[1] != null ? unxml(t[1]) : '\n')).join(''))
    pages.push({ page: i + 1, text: clean(paras.filter((t) => t.trim()).join('\n')), needsOcr: false })
    progress({ page: i + 1, total: order.length })
  }
  return { pageCount: order.length, pages }
}

const EXTRACT = {
  'application/pdf': extractPdf,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': extractDocx,
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': extractPptx
}

function explain(err) {
  const name = err?.name || ''
  if (name === 'PasswordException') return 'PDF parola korumalı.'
  if (name === 'InvalidPDFException') return 'Dosya geçerli bir PDF değil ya da bozuk.'
  if (/central directory|is this a zip file|Corrupted zip/i.test(String(err?.message))) return 'Dosya bozuk ya da beklenen biçimde değil.'
  return String(err?.message || err).slice(0, 300)
}

// ---- PDF sayfasını görsele çevirme (OCR için) ----
// utilityProcess'te DOM yok; pdfjs'e tuval ve filtre fabrikaları elle verilir.
let canvasLib
function canvas() {
  if (!canvasLib) {
    canvasLib = require('@napi-rs/canvas')
    for (const k of ['DOMMatrix', 'Path2D', 'ImageData']) globalThis[k] ??= canvasLib[k]
  }
  return canvasLib
}
class CanvasFactory {
  create(w, h) { const c = canvas().createCanvas(w, h); return { canvas: c, context: c.getContext('2d') } }
  reset(cc, w, h) { cc.canvas.width = w; cc.canvas.height = h }
  destroy(cc) { cc.canvas.width = 0; cc.canvas.height = 0; cc.canvas = null; cc.context = null }
}
class FilterFactory {
  addFilter() { return 'none' } addHCMFilter() { return 'none' } addAlphaFilter() { return 'none' }
  addLuminosityFilter() { return 'none' } addHighlightHCMFilter() { return 'none' } destroy() {}
}
// Art arda gelen sayfalarda dosya yeniden ayrıştırılmasın diye son açılan belge tutulur.
let opened = null
async function openForRender(path) {
  if (opened?.path === path) return opened.doc
  if (opened) { try { await opened.task.destroy() } catch {} opened = null }
  canvas()
  const pdfjs = await loadPdfjs()
  const task = pdfjs.getDocument({ data: new Uint8Array(await fs.readFile(path)), verbosity: 0, useSystemFonts: false, disableFontFace: true, CanvasFactory, FilterFactory })
  const doc = await task.promise
  opened = { path, task, doc }
  return doc
}
/** maxSide: görselin uzun kenarı (piksel). Yerel OCR için ~200 dpi, modele göndermek için daha küçük. */
async function renderPage(path, pageNo, maxSide) {
  const doc = await openForRender(path)
  const page = await doc.getPage(pageNo)
  const base = page.getViewport({ scale: 1 })
  const vp = page.getViewport({ scale: Math.min(3, maxSide / Math.max(base.width, base.height)) })
  const c = canvas().createCanvas(Math.ceil(vp.width), Math.ceil(vp.height))
  await page.render({ canvasContext: c.getContext('2d'), viewport: vp, canvas: c }).promise
  page.cleanup()
  return c.toBuffer('image/png')
}

let tess
async function ocr(job) {
  const png = await renderPage(job.path, job.page, 2200)
  if (!tess) {
    await fs.mkdir(job.cachePath, { recursive: true }) // dil dosyaları (tur + eng) ilk kullanımda indirilir ve burada saklanır
    tess = await require('tesseract.js').createWorker(['tur', 'eng'], 1, { cachePath: job.cachePath })
  }
  const { data } = await tess.recognize(png)
  return { text: clean(data.text || ''), confidence: data.confidence }
}

// ---- gömme (anlamsal arama) ----
let extractor, extractorModel
async function embed(job) {
  if (!extractor || extractorModel !== job.model) {
    const { pipeline, env } = await import('@huggingface/transformers')
    env.cacheDir = job.cacheDir // model ilk kullanımda indirilir ve burada saklanır
    extractor = await pipeline('feature-extraction', job.model, { dtype: 'q8' })
    extractorModel = job.model
  }
  const vectors = []
  for (const t of job.texts) vectors.push((await extractor([t], { pooling: 'mean', normalize: true })).tolist()[0])
  return { vectors }
}

const HANDLERS = {
  extract: async (job, progress) => {
    const out = await (EXTRACT[job.mime] ?? extractText)(job, progress)
    return { ...out, chunks: chunker.chunkPages(out.pages, out.pageCount != null) }
  },
  ocr,
  render: async (job) => ({ png: (await renderPage(job.path, job.page, 1568)).toString('base64') }),
  embed
}

// İşler ana süreçten sırayla gelir; yine de üst üste binmesinler diye zincirlenir.
let chain = Promise.resolve()
process.parentPort.on('message', ({ data: job }) => {
  chain = chain.then(async () => {
    try {
      const out = await HANDLERS[job.kind](job, (p) => post({ jid: job.jid, type: 'progress', ...p }))
      post({ jid: job.jid, type: 'done', ...out })
    } catch (err) { post({ jid: job.jid, type: 'error', message: explain(err) }) }
  })
})
