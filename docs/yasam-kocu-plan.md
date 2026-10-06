# Sohbet / Yaşam Koçu Modları — Uygulama Planı

## Bağlam

Uygulamanın şu anki hali akademik odaklı: sohbet, projeler, dosya arşivi, notlar, kişisel hafıza, web araması, quiz ve modelin notlara yazabilmesi. Bu plan, uygulamayı iki moda ayırıyor:

- **Sohbet:** Mevcut her şey (akademik taraf).
- **Yaşam Koçu:** Takvim ve programlar, alışkanlık takibi, beslenme ve antrenman gibi kişisel yaşam konuları.

İki mod ayrı ekranlara sahip ama aynı hafızayı ve aynı veritabanını kullanıyor. Amaç arayüzün şişmesini önlerken iki tarafın birbirinden haberdar olması (örneğin koç modunun sınav haftasını bilip antrenmanı hafifletmesi).

## Çalışma şekli

- Plan altı faza bölündü. Fazları sırayla uygula; her fazın sonunda dur, ne yaptığını ve nasıl test edeceğimi özetle, onayımı bekle.
- İlk fazdan önce mevcut kodu incele: hafıza sisteminin nasıl çalıştığı (hafıza sistem talimatına toptan mı ekleniyor, aranarak mı getiriliyor), sohbet geçmişinin nasıl saklandığı, ayarlar yapısı ve telefon arayüzünün veriye nasıl eriştiği (yerel mi, bir sunucu üzerinden senkronizasyon mu). Bulduklarını ve planı mevcut yapıya nasıl uyarlayacağını yaz, onayımı bekle.
- Mevcut özellikleri bozma. Paketleme veya release işlemi yapma.
- Arayüz metinleri Türkçe ve mevcut temayla uyumlu olsun. "Yaşam Koçu" çalışma adıdır; tek bir sabitten değiştirilebilir olsun.
- Model tarafından yapılan her yazma işlemi (etkinlik, takip kaydı, not) mevcut not yazma özelliğindeki gibi onay kartı ve geri alma mantığını kullansın; yeni bir onay sistemi yazma, mevcut olanı genelleştir.

---

## Faz 1 — Mod altyapısı ve güvenlik temeli

Bu fazda veri özellikleri yok; yalnızca iki modun iskeleti ve koç modunun güvenlik temeli kurulur. Koç modu bu fazdan itibaren sohbet edebildiği için güvenlik kuralları ilk günden yerinde olmalı.

### Mod geçişi

- Masaüstünde pencerenin üstünde veya kenar çubuğunun başında belirgin bir mod geçişi (Sohbet / Yaşam Koçu). Telefonda alt sekme çubuğu.
- Her modun kendi sohbet listesi var. Sohbetlere `mode` alanı eklenir; mevcut tüm sohbetler `chat` moduna atanır.
- Son kullanılan mod hatırlanır.

### Moda özel ayarlar

- Her modun ayrı sistem talimatı ve ayrı varsayılan modeli olsun (ayarlardan değiştirilebilir).
- Koç modu için varsayılan olarak güçlü bir model önerilsin; ucuz modeller güvenlik talimatlarına daha az güvenilir uyar.
- Araçlar moda göre ayrılır: proje, quiz ve arşiv araçları Sohbet modunda; koç modunun araçları sonraki fazlarda eklenecek. Web araması iki modda da kullanılabilir.

### Yaş bilgisi

- Koç moduna ilk girişte doğum yılı sorulur (tek seferlik, ayarlardan değiştirilebilir).
- 18 yaş altı kullanıcılar için `restricted` bayrağı tutulur. Bu bayrak sonraki fazlarda bazı özellikleri kapatmak için kullanılacak.

### Koç modu güvenlik talimatları

Koç modunun sistem talimatına şunlar eklenir:

- Beslenme konuları "alışkanlık" çerçevesinde ele alınır: düzenli öğün, su, çeşitlilik, uyku. Kullanıcı açıkça istemedikçe kalori veya kilo hedefi önerilmez.
- Kısıtlı (`restricted`) kullanıcılara kalori sayımı, kilo verme hedefi ve kısıtlayıcı diyet planı hiçbir koşulda verilmez.
- Yetişkinlere de aşırı düşük kalorili, öğün atlatan veya çok kısıtlayıcı planlar verilmez.
- Yeme bozukluğu işaretleri (aşırı kısıtlama, telafi amaçlı egzersiz, kilo/beden konusunda yoğun sıkıntı gibi) görüldüğünde sayısal hedef verilmez; kullanıcıya nazikçe bir uzmandan veya güvendiği birinden destek alması önerilir.
- Bilinen bir sağlık sorunu, ilaç kullanımı veya hamilelik söz konusuysa diyetisyen veya doktora yönlendirilir.
- Antrenmanda kademeli ilerleme esastır; ağrı veya sakatlık durumunda uzmana yönlendirilir.
- Model terapist veya doktor değildir ve öyleymiş gibi davranmaz.
- Kullanıcının kendisine veya başkasına zarar verme riski içeren bir durumda acil yardım (Türkiye'de 112) ve güvendiği kişilerle iletişime geçmesi önerilir.

### Faz 1 kabul kriterleri

- İki mod arasında geçiş yapılabiliyor; her modun sohbet listesi ayrı.
- Mevcut sohbetler Sohbet modunda eksiksiz duruyor.
- Koç moduna ilk girişte doğum yılı soruluyor.
- 16 yaşında bir kullanıcı "kilo vermek için günde kaç kalori yemeliyim" diye sorduğunda sayısal hedef verilmiyor, alışkanlık odaklı ve yönlendirici bir cevap geliyor.

---

## Faz 2 — Ortak hafıza ve alan etiketleri

### Veri

- Hafıza kayıtlarına iki alan eklenir:
  - `domain`: `akademik` | `yasam` | `genel`
  - `mode_only`: true ise kayıt yalnızca kendi alanının modunda kullanılır, diğer moda hiçbir koşulda geçmez.
- Mevcut tüm hafıza kayıtları `genel` olarak işaretlenir.
- Model otomatik hafıza eklerken `domain` değerini kendisi belirler. Sağlık, beslenme, kilo, uyku ve ruh hâli ile ilgili kayıtlar varsayılan olarak `yasam` ve `mode_only = true` olur.

### Kullanım

- Her mod kendi alanının kayıtlarını ve `genel` kayıtları her zaman kullanır.
- Diğer alanın kayıtları (`mode_only` olmayanlar) sistem talimatına eklenmez; bunun yerine modele bir `search_memory(query)` aracı verilir ve diğer alandaki bilgiye yalnızca gerçekten ilgili olduğunda bu araçla erişir. (Mevcut hafıza sistemi farklı çalışıyorsa buna en yakın uyarlamayı planda öner.)
- Sistem talimatına şu eklenir: "Diğer moddan gelen bir bilgiyi yalnızca mevcut soruya doğrudan katkı sağlıyorsa kullan."

### Arayüz

- Hafıza ekranında alana göre filtreleme.
- Her kaydın alanı değiştirilebilir ve "Sadece bu modda kalsın" seçeneği açılıp kapatılabilir.

### Faz 2 kabul kriterleri

- Koç modunda "son zamanlarda iyi uyuyamıyorum" dendiğinde oluşan hafıza kaydı `yasam` ve `mode_only` olarak işaretleniyor ve Sohbet modunda hiçbir koşulda görünmüyor.
- Sohbet modunda kaydedilmiş "final haftası 12 Ocak'ta başlıyor" bilgisi, koç modunda antrenman planı istendiğinde dikkate alınabiliyor.
- Kullanıcı bir kaydın alanını değiştirebiliyor.

---

## Faz 3 — Takvim ve programlar

### Veri

```sql
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,          -- 'ders' | 'sinav' | 'odev' | 'antrenman' | 'ogun' | 'diger'
  start_at INTEGER NOT NULL,
  end_at INTEGER,
  all_day INTEGER NOT NULL DEFAULT 0,
  rrule TEXT,                  -- tekrarlama kuralı (örn. haftalık ders)
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  notes TEXT,
  created_by TEXT NOT NULL DEFAULT 'user',   -- 'user' | 'ai'
  created_at INTEGER NOT NULL
);
```

Tekrarlama için hazır bir RRULE kütüphanesi kullan (örn. `rrule`); kendin yazma.

### Arayüz

- Koç modunda haftalık görünüm ve yaklaşan etkinlikler listesi.
- Ders programı: haftalık tekrarlanan ders etkinlikleri hızlıca girilebilsin.
- Sınav ve ödevler bir projeye bağlanabilir. Bağlı etkinlikler Sohbet modunda ilgili projenin sayfasında da görünür.

### Model araçları (her iki modda)

- `list_events(from, to)`
- `create_event(...)`, `update_event(id, ...)`, `delete_event(id)`: hepsi onay kartı ve geri alma ile.
- Model bugünün tarihini zaten biliyor; göreli ifadeleri ("gelecek salı") doğru çözdüğünü test et.

### Faz 3 kabul kriterleri

- "Pazartesi ve çarşamba 10:00–12:00 Bitki Islahı dersim var, programıma ekle" dendiğinde onaydan sonra haftalık tekrarlanan etkinlikler oluşuyor.
- Sohbet modunda "@istatistik vizem 14 Kasım'da" dendiğinde sınav etkinliği projeye bağlı olarak oluşuyor ve koç modunun takviminde de görünüyor.
- Koç modunda "bu hafta için 3 günlük antrenman planla, sınavlarıma denk getirme" dendiğinde model takvime bakıp çakışmayan günlere antrenman öneriyor.

---

## Faz 4 — Alışkanlık ve takip sistemi

Her konu için ayrı modül yazılmaz; tek bir genel takip yapısı kurulur.

### Veri

```sql
CREATE TABLE trackers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,          -- 'check' (yapıldı/yapılmadı) | 'number' | 'duration'
  unit TEXT,                   -- örn. 'bardak', 'dakika', 'saat'
  frequency TEXT NOT NULL,     -- 'daily' | 'weekly'
  target REAL,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE tracker_entries (
  id TEXT PRIMARY KEY,
  tracker_id TEXT NOT NULL REFERENCES trackers(id) ON DELETE CASCADE,
  date TEXT NOT NULL,          -- YYYY-MM-DD (yerel tarih)
  value REAL,
  note TEXT,
  created_at INTEGER NOT NULL
);
```

### Arayüz

- Hazır şablonlar: su, uyku, antrenman, ders çalışma süresi, düzenli öğün, kitap okuma. Kullanıcı kendi takibini de ekleyebilir.
- Kısıtlı kullanıcılar için kilo ve kalori takibi şablonları gösterilmez ve bu birimlerle takip oluşturulamaz.
- Bugünün takipleri tek dokunuşla işaretlenebilen bir liste olarak görünür; her takip için basit bir haftalık görünüm.

### Model araçları (koç modu)

- `list_trackers()`, `get_tracker_summary(tracker_id, from, to)`
- `log_entry(tracker_id, date, value, note?)`: Düşük riskli olduğu için onay kartı yerine anında kaydedilir ve sohbette "Geri al" düğmeli bir chip gösterilir.
- `create_tracker(...)`: onay kartıyla.

### Faz 4 kabul kriterleri

- "Bugün 6 bardak su içtim ve 40 dakika yürüdüm" dendiğinde iki ilgili takibe kayıt düşüyor ve geri alınabiliyor.
- "Bu hafta uykum nasıldı?" sorusunda model gerçek kayıtlara dayanarak cevap veriyor.
- Kısıtlı bir kullanıcı kilo takibi oluşturamıyor.

---

## Faz 5 — Bugün ekranı

Koç modunun ana sayfası:

- Bugünün etkinlikleri (dersler, antrenman, öğün saatleri).
- Yaklaşan sınav ve ödevler (önümüzdeki 7 gün, projelere bağlantılı).
- Bugünün takip listesi.
- Kısa bir yapay zekâ günlük özeti: takvim, takipler ve ilgili hafıza kayıtlarına dayanır. Günde bir kez üretilir ve önbelleğe alınır; kullanıcı isterse yeniler. Özet planlama odaklıdır, kullanıcıyı yargılamaz.
- Telefon arayüzü bu ekranı da gösterebilmeli (Faz 1 öncesindeki incelemede mimari buna izin vermiyorsa planda belirtilmiş olmalı).

### Faz 5 kabul kriterleri

- Bugün ekranı uygulama açıldığında hızlı yükleniyor; özet her açılışta yeniden üretilmiyor.
- Ertesi gün sınavı olan bir kullanıcı özette bunu görüyor.

---

## Faz 6 — Yaşam projeleri ve modül ayarları

### Yaşam projeleri

- Projelere yeni bir tür eklenir: `kind = 'yasam'` (mevcut: `ders`, `kisisel`).
- Yaşam projeleri (örn. "Spor", "Beslenme") Sohbet modunun proje listesinde değil, koç modunun kenar çubuğunda görünür.
- Mevcut not yazma araçları koç modunda da çalışır. Örneğin "haftada 3 gün evde yapılabilecek bir program hazırla, Spor projeme kaydet" dendiğinde program nota yazılır, istenirse antrenman günleri takvime eklenir.

### Modül ayarları

- Ayarlar → Modüller: Yaşam Koçu modunu tamamen kapatma, Takvim ve Takip modüllerini ayrı ayrı açıp kapatma.
- Kapalı bir modülün araçları modele gönderilmez ve arayüzde hiçbir izi görünmez.

### Faz 6 kabul kriterleri

- Yaşam projeleri yalnızca koç modunda listeleniyor.
- Koç modu kapatıldığında uygulama, bu plandan önceki akademik uygulama gibi görünüyor.

---

## Veri gizliliği notu

Sağlık, beslenme, uyku ve ruh hâli verileri KVKK kapsamında özel nitelikli kişisel veri sayılabilir. İlk incelemede telefon arayüzünün bu verilere nasıl eriştiğini raporla. Veriler bir sunucu üzerinden senkronize ediliyorsa bunu açıkça belirt ve bu verilerin sunucuda nasıl saklanacağına dair bir öneri sun; ben karar vermeden bu verileri sunucuya gönderen bir akış kurma.
