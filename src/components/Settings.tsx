import { useEffect, useState } from 'react'
import type { ArchiveSettings, ArchiveStatus, MemoryStore, Provider, Settings } from '../types'
import { Archive, Check, Close, Folder, Key, Plus, Star, Trash } from './Icons'

const OCR_MODES: { id: ArchiveSettings['ocr']; label: string }[] = [{ id: 'off', label: 'Kapalı' }, { id: 'local', label: 'Bu bilgisayarda' }, { id: 'model', label: 'Model ile' }]

interface Props { settings: Settings; onSave(s: Settings): Promise<void>; onClose(): void }

export default function SettingsModal({ settings, onSave, onClose }: Props) {
  const [s, setS] = useState<Settings>(() => structuredClone(settings))
  const [sel, setSel] = useState(settings.activeProvider)
  const [models, setModels] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<'api' | 'memory' | 'archive'>('api')
  const [status, setStatus] = useState<ArchiveStatus | null>(null)
  const arc: ArchiveSettings = { ocr: s.archive?.ocr ?? 'local', semantic: !!s.archive?.semantic }
  const setArc = (d: Partial<ArchiveSettings>) => setS({ ...s, archive: { ...arc, ...d } })
  // Arşiv sekmesi açıkken indeksleme durumu canlı izlenir.
  useEffect(() => {
    if (tab !== 'archive') return
    let live = true
    const load = () => window.api.archiveStatus().then((x) => { if (live) setStatus(x) }).catch(() => {})
    load()
    const t = setInterval(load, 1500)
    return () => { live = false; clearInterval(t) }
  }, [tab])
  const [mem, setMem] = useState<MemoryStore>({ enabled: true, items: [] })
  const [newMem, setNewMem] = useState('')
  useEffect(() => { window.api.loadMemory().then(setMem) }, [])
  const p = s.providers.find((x) => x.id === sel)!
  const custom = sel.startsWith('custom-')
  const model = p.model.trim()
  const isSaved = !!p.savedModels?.includes(model)

  const patch = (d: Partial<Provider>) => setS({ ...s, providers: s.providers.map((x) => (x.id === sel ? { ...x, ...d } : x)) })

  async function fetchModels() {
    setBusy(true)
    await window.api.saveSettings(s) // anahtarı kaydet ki ana süreç kullanabilsin
    setModels(await window.api.listModels(sel))
    setBusy(false)
  }
  function addCustom() {
    const id = 'custom-' + Date.now().toString(36)
    setS({ ...s, providers: [...s.providers, { id, kind: 'openai', name: 'Özel (OpenAI uyumlu)', baseUrl: 'https://', apiKey: '', model: '' }] })
    setSel(id)
  }
  function removeCustom() {
    if (!custom) return
    const rest = s.providers.filter((x) => x.id !== sel)
    setS({ ...s, providers: rest, activeProvider: s.activeProvider === sel ? rest[0].id : s.activeProvider })
    setSel(rest[0].id)
  }

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label="Ayarlar">
        <nav className="set-nav" aria-label="Ayar bölümleri">
          <div className="label">AYARLAR</div>
          <button className={'row' + (tab === 'api' ? ' active' : '')} aria-current={tab === 'api' ? 'page' : undefined} onClick={() => setTab('api')}><Key size={16} /><span className="t">API ve model</span></button>
          <button className={'row' + (tab === 'memory' ? ' active' : '')} aria-current={tab === 'memory' ? 'page' : undefined} onClick={() => setTab('memory')}><Archive size={16} /><span className="t">Hafıza ve talimatlar</span></button>
          <button className={'row' + (tab === 'archive' ? ' active' : '')} aria-current={tab === 'archive' ? 'page' : undefined} onClick={() => setTab('archive')}><Folder size={16} /><span className="t">Arşiv ve arama</span></button>
        </nav>

        <div className="set-main">
          <div className="set-body">
            {tab === 'api' && <>
              <h2>API ve model</h2>

              <div className="prov-pick">
                <div className="seg wrap" role="group" aria-label="Sağlayıcı">
                  {s.providers.map((x) => (
                    <button key={x.id} aria-pressed={x.id === sel} title={x.id === s.activeProvider ? 'Sohbette kullanılan sağlayıcı' : undefined} onClick={() => { setSel(x.id); setModels([]) }}>
                      {x.id === s.activeProvider && <i className="dot" aria-hidden />}{x.name}
                    </button>
                  ))}
                </div>
                <button className="circle" aria-label="Sağlayıcı ekle" title="Sağlayıcı ekle" onClick={addCustom}><Plus size={16} /></button>
              </div>
              <p className="note gcap">Nokta, sohbette kullanılan sağlayıcıyı gösterir.</p>

              <div className="group">
                <label className="frow"><span className="fl">Ad</span><input className="fin" value={p.name} onChange={(e) => patch({ name: e.target.value })} /></label>
                <label className="frow"><span className="fl">API adresi</span><input className="fin mono" value={p.baseUrl} onChange={(e) => patch({ baseUrl: e.target.value })} /></label>
                {custom && (
                  <label className="frow"><span className="fl">Protokol</span>
                    <select className="fin" value={p.kind} onChange={(e) => patch({ kind: e.target.value as Provider['kind'] })}>
                      <option value="openai">OpenAI uyumlu</option><option value="anthropic">Anthropic</option>
                    </select>
                  </label>
                )}
                <div className="frow">
                  <label className="fl" htmlFor="set-key">API anahtarı{p.hasKey && !p.apiKey && <span className="ok"><Check size={13} />Kayıtlı</span>}</label>
                  <div className="fr">
                    <input id="set-key" className="fin" type="password" autoComplete="off" value={p.apiKey} onChange={(e) => patch({ apiKey: e.target.value })}
                      placeholder={p.hasKey ? 'Değiştirmek için yeni anahtar' : 'Yerel modellerde boş bırakılabilir'} />
                    {p.hasKey && <button className="pill sm danger" onClick={async () => { await window.api.clearKey(sel); patch({ hasKey: false, apiKey: '' }) }}>Sil</button>}
                  </div>
                </div>
              </div>

              <div className="group">
                <div className="frow">
                  <label className="fl" htmlFor="set-model">Model</label>
                  <div className="fr">
                    <input id="set-model" className="fin mono" list="model-list" value={p.model} onChange={(e) => patch({ model: e.target.value })} placeholder="model kimliği" />
                    <datalist id="model-list">{models.map((m) => <option key={m} value={m} />)}</datalist>
                    <button className={'circle sm' + (isSaved ? ' on' : '')} aria-pressed={isSaved} disabled={!model}
                      aria-label={isSaved ? 'Kayıtlı modellerden çıkar' : 'Bu modeli kaydet'} title={isSaved ? 'Kayıtlı modellerden çıkar' : 'Bu modeli kaydet'}
                      onClick={() => patch({ savedModels: isSaved ? p.savedModels!.filter((x) => x !== model) : [...(p.savedModels ?? []), model] })}><Star size={15} /></button>
                    <button className="pill sm" onClick={fetchModels} disabled={busy}>{busy ? 'Yükleniyor…' : 'Modelleri getir'}</button>
                  </div>
                </div>
                <div className="frow">
                  <span className="fl">Kayıtlı modeller</span>
                  <div className="chips">
                    {!p.savedModels?.length && <span className="note">Henüz yok</span>}
                    {p.savedModels?.map((m) => (
                      <span className="chip-x" key={m}>{m}
                        <button aria-label={m + ' modelini kaldır'} onClick={() => patch({ savedModels: p.savedModels!.filter((x) => x !== m) })}><Close size={12} /></button>
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <p className="note gcap">Kaydettiğiniz modeller sohbetteki model menüsünde en üstte listelenir.</p>

              <div className="group">
                <div className="frow">
                  <div className="fl col" id="web-def"><span>Web araması varsayılan olarak açık</span><span className="note">Yeni sohbetlerde mesaj kutusundaki web düğmesi açık gelir</span></div>
                  <button className="sw" role="switch" aria-checked={!!s.webSearch?.defaultOn} aria-labelledby="web-def" onClick={() => setS({ ...s, webSearch: { defaultOn: !s.webSearch?.defaultOn } })}><i /></button>
                </div>
              </div>
              <p className="note gcap">Web araması yalnızca OpenRouter modellerinde çalışır ve arama başına ayrıca ücretlendirilir. Model yalnızca gerek gördüğünde arar.</p>
              {custom && <button className="pill sm plain danger" style={{ alignSelf: 'flex-start' }} onClick={removeCustom}>Sağlayıcıyı sil</button>}
            </>}

            {tab === 'memory' && <>
              <h2>Hafıza ve talimatlar</h2>

              <label className="stack"><span className="label gl">KİŞİSEL TALİMATLAR</span>
                <textarea className="tarea" value={s.systemPrompt} onChange={(e) => setS({ ...s, systemPrompt: e.target.value })} placeholder="Örn. Her zaman Türkçe ve kısa cevap ver." />
              </label>

              <div className="group">
                <div className="frow">
                  <div className="fl col" id="mem-auto"><span>Otomatik hafıza</span><span className="note">Sohbetlerden kaydet ve cevaplarda kullan</span></div>
                  <button className="sw" role="switch" aria-checked={mem.enabled} aria-labelledby="mem-auto" onClick={async () => setMem(await window.api.setMemoryEnabled(!mem.enabled))}><i /></button>
                </div>
              </div>

              <div className="stack">
                <span className="label gl">HAFIZA · {mem.items.length} MADDE</span>
                <div className="group">
                  {mem.items.map((i) => (
                    <div className="frow mem-item" key={i.id}>
                      <textarea rows={1} defaultValue={i.text} aria-label="Hafıza maddesi"
                        onBlur={async (e) => { const v = e.target.value.trim(); if (v && v !== i.text) setMem(await window.api.updateMemory(i.id, v)); else e.target.value = i.text }} />
                      <button className="ib" aria-label="Maddeyi sil" onClick={async () => setMem(await window.api.deleteMemory(i.id))}><Trash size={15} /></button>
                    </div>
                  ))}
                  <form className="frow mem-add" onSubmit={async (e) => { e.preventDefault(); if (!newMem.trim()) return; setMem(await window.api.addMemory(newMem)); setNewMem('') }}>
                    <Plus size={16} />
                    <input value={newMem} onChange={(e) => setNewMem(e.target.value)} aria-label="Hafızaya elle ekle" placeholder="Elle ekle: Örn. Kullanıcı İzmir'de yaşıyor." />
                    <button className="pill sm" type="submit" disabled={!newMem.trim()}>Ekle</button>
                  </form>
                </div>
              </div>
              <p className="note gcap">Otomatik kayıt için her cevaptan sonra seçili modele kısa bir ek istek gönderilir. Parola gibi hassas bilgileri kaydetmemesi için modele talimat verilir; yine de listeyi kontrol edin.</p>
              {mem.items.length > 0 && <button className="pill sm plain danger" style={{ alignSelf: 'flex-start' }} onClick={async () => { if (confirm('Tüm hafıza silinsin mi?')) setMem(await window.api.clearMemory()) }}>Tüm hafızayı sil</button>}
            </>}
            {tab === 'archive' && <>
              <h2>Arşiv ve arama</h2>

              <div className="stack">
                <span className="label gl">TARANMIŞ SAYFALAR (OCR)</span>
                <div className="seg wrap" role="group" aria-label="OCR">
                  {OCR_MODES.map((m) => <button key={m.id} aria-pressed={arc.ocr === m.id} onClick={() => setArc({ ocr: m.id })}>{m.label}</button>)}
                </div>
              </div>
              <p className="note gcap">{arc.ocr === 'off' ? 'Metni çıkarılamayan (taranmış) PDF sayfaları aranamaz ve modele gösterilemez.'
                : arc.ocr === 'local' ? 'Taranmış PDF sayfalarındaki yazı bu bilgisayarda tanınır (Tesseract, Türkçe + İngilizce). Dil dosyaları ilk kullanımda bir kez indirilir; sayfalar bilgisayardan çıkmaz.'
                : `Her taranmış sayfanın görüntüsü sohbette seçili modele (${p.name}) gönderilir. Görsel destekli bir model gerekir; sayfa başına ücretlendirilir ve sayfa içeriği sağlayıcıya gider. El yazısı ve karmaşık sayfalarda daha iyi sonuç verebilir.`}
                {status && status.ocr.pending > 0 ? ` Şu an ${status.ocr.pending} sayfa OCR bekliyor${status.ocr.running ? ' (çalışıyor)' : ''}.` : ''}</p>

              <div className="group">
                <div className="frow">
                  <div className="fl col" id="arc-sem"><span>Anlamsal arama</span><span className="note">Yalnızca kelime eşleşmesiyle değil, anlam yakınlığıyla da bul</span></div>
                  <button className="sw" role="switch" aria-checked={arc.semantic} aria-labelledby="arc-sem" disabled={status ? !status.semantic.available : false} onClick={() => setArc({ semantic: !arc.semantic })}><i /></button>
                </div>
                {status?.semantic.enabled && (
                  <div className="frow"><span className="fl">İndeks</span>
                    <span className="note">{status.semantic.error ? 'Hata: ' + status.semantic.error
                      : status.semantic.embedded < status.semantic.total ? `${status.semantic.embedded} / ${status.semantic.total} parça hazırlandı${status.semantic.busy ? '…' : ''}`
                      : `${status.semantic.total} parça hazır`}</span>
                  </div>
                )}
              </div>
              <p className="note gcap">{status && !status.semantic.available ? 'Anlamsal arama bu kurulumda kullanılamıyor (vektör uzantısı yüklenemedi).'
                : 'Açıldığında eş anlamlı ve farklı dildeki ifadeler de bulunur (ör. "backcross" araması "geriye melezleme" geçen sayfayı getirir). Çok dilli küçük bir model (yaklaşık 145 MB) ilk kullanımda bir kez indirilir ve bu bilgisayarda çalışır; dosyalarınız dışarı gönderilmez. Değişiklik "Kaydet" ile uygulanır.'}</p>

              <div className="group">
                <div className="frow">
                  <div className="fl col" id="nt-auto"><span>Yeni not oluşturmayı onaysız yap</span><span className="note">Model sohbetten not oluşturduğunda önizleme gösterilmeden kaydedilir</span></div>
                  <button className="sw" role="switch" aria-checked={!!s.notes?.autoCreate} aria-labelledby="nt-auto" onClick={() => setS({ ...s, notes: { autoCreate: !s.notes?.autoCreate } })}><i /></button>
                </div>
              </div>
              <p className="note gcap">Kapalıyken model bir not oluşturmak istediğinde sohbette önizleme kartı çıkar ve not ancak onaylarsanız kaydedilir. Oluşturulan not her durumda sohbetten geri alınabilir. Mevcut bir nota ekleme her zaman onay ister.</p>
            </>}
          </div>

          <div className="set-foot">
            <p className="note">{tab === 'api'
              ? 'Anahtarlar işletim sisteminin güvenli depolamasıyla şifrelenerek yalnızca bu bilgisayarda saklanır ve sadece seçtiğiniz API adresine gönderilir.'
              : tab === 'archive' ? 'OCR ve anlamsal arama arka planda çalışır; uygulamayı kullanmaya devam edebilirsiniz.'
              : 'Hafıza maddeleri anında kaydedilir ve silinir; Kaydet yalnızca talimatlar ve sağlayıcı ayarları içindir.'}</p>
            <div className="row-btns">
              <button className="pill" onClick={onClose}>Vazgeç</button>
              <button className="pill primary" onClick={async () => { await onSave({ ...s, activeProvider: sel }); onClose() }}>Kaydet ve bunu kullan</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
