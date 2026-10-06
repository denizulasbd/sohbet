# Modelin Projelere Not Yazması — Uygulama Spesifikasyonu

## Bağlam

Uygulamada sohbet için araç döngüsü (`search_knowledge`, `read_source`, OpenRouter web araması), `@proje` etiketi, `[K#]` kaynak etiketleri, notlar için `[[dosya adı#sayfa]]` bağlantı sözdizimi ve web sonuçlarını nota kaydetme işlevi zaten var. Bu iş, modelin sohbet içinden projelere not oluşturabilmesini ve mevcut notlara ekleme yapabilmesini sağlıyor.

Örnek kullanım: "@bitki ıslahı Hafta 4 PDF'inin önemli noktalarını çıkar, notlara ekle ve kaynak göster."

## Çalışma şekli

- Kod yazmadan önce mevcut araç döngüsünü, not kaydetme ve indeksleme akışını, web sonucunu nota kaydetme işlevini ve `[[...]]` bağlantı sistemini incele. Mevcut not oluşturma kodunu yeniden kullan. Kısa bir plan yaz ve onayımı bekle.
- Fazları sırayla uygula; her fazın sonunda dur, özetle ve onay bekle.
- Mevcut özellikleri bozma. Paketleme veya release işlemi yapma.

## Faz 1 — Not oluşturma ve ekleme

### Yeni araçlar

Mevcut istemci araçlarının yanına eklenir:

- `list_sources()`: Hedef projedeki dosya ve notları listeler (id, ad, tür, sayfa sayısı). Model "Hafta 4 PDF'i" gibi bir ifadeyi doğru dosyaya bu sayede eşler.
- `summarize_source(source_id, focus?)`: Bir dosyanın tamamından önemli noktaları çıkarır (aşağıya bakın).
- `create_note(title, content)`: Hedef projede yeni bir not oluşturur. `content` Markdown.
- `append_to_note(note_id, content)`: Mevcut bir notun sonuna içerik ekler. Mevcut içeriği asla silmez veya değiştirmez.

### Hedef proje

- Mesajda `@proje` etiketi varsa hedef o projedir; model hedef projeyi değiştiremez.
- Etiket yoksa `create_note` isteğe bağlı bir `project_name` alabilir. Uygulama bunu mevcut projelerle eşleştirir (büyük/küçük harf duyarsız). Eşleşme yoksa not "Genel" altına gider. Hedef her durumda onay kartında gösterilir ve kullanıcı oradan değiştirebilir.

### Uzun belgeleri özetleme (`summarize_source`)

Bu araç ana sohbet bağlamını şişirmemek için özetlemeyi uygulama tarafında yapar:

1. Belgenin sayfalarını ~8–10 sayfalık gruplara böl.
2. Her grup için modele ayrı bir çağrı yap: "Bu sayfalardaki önemli noktaları çıkar; her noktanın hangi sayfadan geldiğini belirt." Çıktı JSON: `[{ "point": "...", "page": 12 }]`.
3. Tüm grupların sonuçlarını birleştir, tekrarları ayıkla. `focus` verildiyse o konuya odaklan.
4. Ana modele yalnızca bu birleştirilmiş, sayfa numaralı nokta listesini döndür.

Belgenin tüm sayfaları işlenmeli; hiçbir bölüm atlanmamalı. İşlem sırasında sohbette ilerleme göster ("Sayfa 21–30 işleniyor…").

### Kaynak gösterimi

- Model not içeriğinde kaynakları sohbetteki gibi `[K#]` etiketleriyle yazar (`summarize_source` sonuçları da etiketli döner).
- Uygulama kaydetmeden önce her `[K#]` etiketini kalıcı bir `[[dosya adı#sayfa]]` bağlantısına çevirir. Dosya adlarını ve sayfa numaralarını modelin yazmasına güvenme; dönüşüm deterministik olmalı.
- Kaydedilen notta bu bağlantılar tıklanınca PDF ilgili sayfada açılır (mevcut davranış).

### Onay akışı

- `create_note` veya `append_to_note` çağrıldığında not hemen yazılmaz. Sohbette bir önizleme kartı gösterilir: hedef proje, başlık (eklemede hedef notun adı) ve içeriğin işlenmiş önizlemesi. Düğmeler: **Kaydet**, **Düzenle**, **Vazgeç**.
- Araç döngüsü kullanıcı seçim yapana kadar bekler. Araç sonucu modele şöyle döner: onaylandıysa "Not kaydedildi (id: …)", vazgeçildiyse "Kullanıcı kaydetmeyi reddetti". Düzenlendiyse kullanıcının son hali kaydedilir.
- Ayarlarda "Yeni not oluşturmayı onaysız yap" seçeneği olsun (varsayılan kapalı). Mevcut nota ekleme her zaman onay ister.
- Kayıttan sonra sohbette tıklanabilir bir chip görünür: "Not oluşturuldu: <başlık>" veya "Nota eklendi: <başlık>".

### Geri alma

- Oluşturulan not için chip'te **Geri al**: notu siler.
- Ekleme için **Geri al**: notu eklemeden önceki haline döndürür. Bunun için her ekleme öncesinde notun önceki içeriğini bir `note_revisions` tablosunda sakla.

### Yapay zekâ notlarının işaretlenmesi

- Model tarafından oluşturulan notlarda `created_by = 'ai'` ve kaynak sohbetin id'si saklanır. Not listesinde küçük bir "AI" işareti görünür.
- Bu notlar normal notlar gibi indekslenir. `search_knowledge` sonuçlarında AI notu olduğu belirtilir; sistem talimatına "kaynak gösterirken mümkünse orijinal belgeleri tercih et" eklenir.

### Sağlayıcı uyumu

Yazma araçları yalnızca araç desteği olan modellerde etkindir. Araç desteklemeyen modellerde bu araçlar gönderilmez.

### Faz 1 kabul kriterleri

- "@bitki ıslahı Hafta 4 PDF'inin önemli noktalarını çıkar, notlara ekle ve kaynak göster" isteğinde model doğru dosyayı buluyor, tüm sayfaları işliyor, önizleme kartı çıkıyor ve onaydan sonra not projede oluşuyor.
- Nottaki kaynak bağlantıları doğru dosya ve sayfaya gidiyor.
- 80+ sayfalık bir PDF'te işlem tamamlanıyor ve ana sohbet bağlamı şişmiyor.
- "Bu notun sonuna geriye melezleme için bir örnek ekle" isteğinde mevcut içerik korunarak ekleme yapılıyor.
- Vazgeç'e basıldığında hiçbir şey yazılmıyor ve model bunu biliyor.
- Geri al hem oluşturmada hem eklemede çalışıyor.

## Faz 2 — Mevcut notu düzenleme

- Yeni araç: `edit_note(note_id, old_text, new_text)`. `old_text` notta tam olarak bir kez geçmeli; geçmiyorsa veya birden fazla geçiyorsa araç hata döndürür ve hiçbir şey değişmez.
- Onay kartı farkı (diff) gösterir: silinen kısım kırmızı, eklenen kısım yeşil. Düzenleme her zaman onay ister; onaysız seçeneği yoktur.
- Her düzenleme öncesi önceki içerik `note_revisions`'a yazılır; Geri al çalışır.

### Faz 2 kabul kriterleri

- "Bu nottaki 'F1 bitkileri' bölümünü daha anlaşılır yaz" isteğinde yalnızca o bölüm değişiyor, onay kartında fark doğru görünüyor ve geri alınabiliyor.
