// Uygulama veritabanı (userData/app.db). Tek yazıcı ana süreçtir; renderer yalnızca IPC üzerinden erişir.
// Sohbetler, notlar, ayarlar ve hafıza JSON dosyalarında kalır; burada projeler, dosya arşivi ve (sonraki fazlarda) arama indeksi durur.
const fs = require('fs')
const path = require('path')
const Database = require('better-sqlite3')

// Şema sürümleri: her eleman bir kez ve sırayla uygulanır (PRAGMA user_version). Var olanı değiştirmeyin, sona ekleyin.
const MIGRATIONS = [
  `CREATE TABLE projects (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     kind TEXT NOT NULL DEFAULT 'ders',      -- 'ders' | 'kisisel' | 'yasam' (koç modunun projeleri; sonradan eklendi, şema değişmedi)
     created_at INTEGER NOT NULL
   );
   CREATE TABLE files (
     id TEXT PRIMARY KEY,
     project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     name TEXT NOT NULL,
     stored_path TEXT NOT NULL,               -- userData'ya göreli: files/<uuid>.<uzantı>
     mime TEXT NOT NULL,
     size INTEGER NOT NULL DEFAULT 0,
     page_count INTEGER,                      -- düz metinde NULL
     status TEXT NOT NULL DEFAULT 'queued',   -- 'queued' | 'processing' | 'ready' | 'error'
     error TEXT,
     created_at INTEGER NOT NULL
   );
   CREATE INDEX files_project ON files(project_id);
   -- Çıkarılan ham metin, sayfa sayfa. Düz metin dosyaları tek "sayfa"dır (page = 1).
   CREATE TABLE file_pages (
     file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
     page INTEGER NOT NULL,
     text TEXT NOT NULL,
     needs_ocr INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (file_id, page)
   ) WITHOUT ROWID;`,

  // Arama indeksi: dosya ve not parçaları tek tabloda; chunks_fts onun trigram indeksidir.
  `CREATE TABLE chunks (
     id INTEGER PRIMARY KEY,
     project_id TEXT,                         -- NULL = "Genel" (projesiz not)
     source_type TEXT NOT NULL,               -- 'file' | 'note'
     source_id TEXT NOT NULL,
     page INTEGER,                            -- sayfa/slayt; not ve sayfasız belgelerde NULL
     heading TEXT,
     text TEXT NOT NULL,                      -- gösterim için asıl metin
     norm_text TEXT NOT NULL                  -- arama için normalize metin (bkz. chunker.cjs → normalize)
   );
   CREATE INDEX chunks_source ON chunks(source_type, source_id);
   CREATE INDEX chunks_project ON chunks(project_id);
   CREATE VIRTUAL TABLE chunks_fts USING fts5(norm_text, content='chunks', content_rowid='id', tokenize='trigram');
   CREATE TRIGGER chunks_ai AFTER INSERT ON chunks BEGIN
     INSERT INTO chunks_fts(rowid, norm_text) VALUES (new.id, new.norm_text);
   END;
   CREATE TRIGGER chunks_ad AFTER DELETE ON chunks BEGIN
     INSERT INTO chunks_fts(chunks_fts, rowid, norm_text) VALUES ('delete', old.id, old.norm_text);
   END;
   CREATE TRIGGER chunks_au AFTER UPDATE OF norm_text ON chunks BEGIN
     INSERT INTO chunks_fts(chunks_fts, rowid, norm_text) VALUES ('delete', old.id, old.norm_text);
     INSERT INTO chunks_fts(rowid, norm_text) VALUES (new.id, new.norm_text);
   END;
   -- Notların kendisi notes.json'dadır; burada hangi sürümün indekslendiği ve sonuçlarda gösterilecek başlık tutulur.
   CREATE TABLE note_index (
     note_id TEXT PRIMARY KEY,
     project_id TEXT,
     title TEXT NOT NULL,
     updated_at INTEGER NOT NULL
   );
   -- Dosya silinince (proje silmedeki CASCADE dahil) parçaları da gider; proje silinince notları "Genel"e düşer.
   CREATE TRIGGER files_ad AFTER DELETE ON files BEGIN
     DELETE FROM chunks WHERE source_type = 'file' AND source_id = old.id;
   END;
   CREATE TRIGGER projects_ad AFTER DELETE ON projects BEGIN
     UPDATE chunks SET project_id = NULL WHERE source_type = 'note' AND project_id = old.id;
     UPDATE note_index SET project_id = NULL WHERE project_id = old.id;
   END;`,

  // Notlardaki [[dosya adı#sayfa]] bağlantıları (notlar her indekslendiğinde yeniden yazılır).
  `CREATE TABLE links (
     note_id TEXT NOT NULL,
     file_id TEXT NOT NULL,
     page INTEGER
   );
   CREATE INDEX links_note ON links(note_id);
   CREATE INDEX links_file ON links(file_id);
   DROP TRIGGER files_ad;
   CREATE TRIGGER files_ad AFTER DELETE ON files BEGIN
     DELETE FROM chunks WHERE source_type = 'file' AND source_id = old.id;
     DELETE FROM links WHERE file_id = old.id;
   END;`,

  // Anlamsal arama: embedded = 0 olan parçaların vektörü henüz hesaplanmamıştır (ya da artık geçersizdir).
  // Vektörlerin kendisi sqlite-vec sanal tablosunda (chunk_vec) durur; uzantı yüklenemezse şema bozulmasın diye o tablo burada değil search.cjs'te açılır.
  `CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
   ALTER TABLE chunks ADD COLUMN embedded INTEGER NOT NULL DEFAULT 0;
   CREATE INDEX chunks_pending ON chunks(id) WHERE embedded = 0;
   DROP TRIGGER projects_ad;
   CREATE TRIGGER projects_ad AFTER DELETE ON projects BEGIN
     UPDATE chunks SET project_id = NULL, embedded = 0 WHERE source_type = 'note' AND project_id = old.id;
     UPDATE note_index SET project_id = NULL WHERE project_id = old.id;
   END;`,

  // Quiz: sorular, denemeler ve cevaplar. Proje silinince hepsi CASCADE ile gider.
  // quiz_sources: üretimde kullanılan parçaların o anki kopyası. chunks satırları yeniden indekslemede (not düzenleme, OCR) silinip
  // yeniden yazıldığı için chunk id tek başına kalıcı değildir; etiket (n) ↔ kaynak eşlemesi ve puanlamada kullanılan metin burada durur.
  `CREATE TABLE quizzes (
     id TEXT PRIMARY KEY,
     project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     title TEXT NOT NULL,
     settings TEXT NOT NULL,                  -- JSON: zorluk, odak, tür, sayı, seçili kaynaklar
     created_at INTEGER NOT NULL
   );
   CREATE INDEX quizzes_project ON quizzes(project_id);
   CREATE TABLE quiz_sources (
     quiz_id TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
     n INTEGER NOT NULL,                      -- üretimdeki [K<n>] etiketi
     chunk_id INTEGER NOT NULL,
     source_type TEXT NOT NULL,               -- 'file' | 'note'
     source_id TEXT NOT NULL,
     source_name TEXT NOT NULL,
     page INTEGER,
     text TEXT NOT NULL,
     PRIMARY KEY (quiz_id, n)
   ) WITHOUT ROWID;
   CREATE TABLE quiz_questions (
     id TEXT PRIMARY KEY,
     quiz_id TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
     idx INTEGER NOT NULL,
     type TEXT NOT NULL,                      -- 'mcq' | 'open'
     prompt TEXT NOT NULL,
     options TEXT,                            -- JSON
     correct_index INTEGER,
     model_answer TEXT,
     key_points TEXT,                         -- JSON
     explanation TEXT,
     source_chunk_ids TEXT NOT NULL           -- JSON: etiketlerin karşılık geldiği chunk id'leri (bkz. quiz_sources.chunk_id)
   );
   CREATE INDEX quiz_questions_quiz ON quiz_questions(quiz_id, idx);
   CREATE TABLE quiz_attempts (
     id TEXT PRIMARY KEY,
     quiz_id TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
     started_at INTEGER NOT NULL,
     submitted_at INTEGER,
     score REAL,                              -- 0–100; klasik sorular puanlanana kadar NULL
     interpretation TEXT                      -- JSON: genel yorum
   );
   CREATE INDEX quiz_attempts_quiz ON quiz_attempts(quiz_id);
   CREATE TABLE quiz_answers (
     attempt_id TEXT NOT NULL REFERENCES quiz_attempts(id) ON DELETE CASCADE,
     question_id TEXT NOT NULL REFERENCES quiz_questions(id) ON DELETE CASCADE,
     answer TEXT,                             -- çoktan seçmelide seçenek sırası ("0"–"3"), klasikte metin
     is_correct INTEGER,
     score REAL,
     feedback TEXT,
     PRIMARY KEY (attempt_id, question_id)
   ) WITHOUT ROWID;`,

  // Modelin yazdığı notlar: created_by = 'ai' arama sonuçlarında belirtilir (notun kendisi notes.json'dadır).
  // note_revisions: model bir nota dokunmadan önce notun o anki hali; "Geri al" buradan geri yükler. Not silinince revizyonları da silinir (bkz. search.cjs).
  `ALTER TABLE note_index ADD COLUMN created_by TEXT;
   CREATE TABLE note_revisions (
     id INTEGER PRIMARY KEY,
     note_id TEXT NOT NULL,
     title TEXT NOT NULL,
     body TEXT NOT NULL,
     reason TEXT NOT NULL,                    -- 'append' | 'edit'
     chat_id TEXT,
     created_at INTEGER NOT NULL
   );
   CREATE INDEX note_revisions_note ON note_revisions(note_id, id);`,

  // Takvim: tekrarlayan etkinlik tek satırdır (rrule); görünen günler calendar.cjs'te açılır. Proje silinince etkinlik kalır, bağı kopar.
  `CREATE TABLE events (
     id TEXT PRIMARY KEY,
     title TEXT NOT NULL,
     kind TEXT NOT NULL,                      -- 'ders' | 'sinav' | 'odev' | 'antrenman' | 'ogun' | 'diger'
     start_at INTEGER NOT NULL,
     end_at INTEGER,
     all_day INTEGER NOT NULL DEFAULT 0,
     rrule TEXT,                              -- tekrarlama kuralı (örn. FREQ=WEEKLY;BYDAY=MO,WE)
     project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
     notes TEXT,
     created_by TEXT NOT NULL DEFAULT 'user', -- 'user' | 'ai'
     created_at INTEGER NOT NULL
   );
   CREATE INDEX events_start ON events(start_at);
   CREATE INDEX events_project ON events(project_id);`,

  // Alışkanlık ve takip: tek genel yapı. Bir günün değeri o günün kayıtlarının toplamıdır (bkz. trackers.cjs).
  `CREATE TABLE trackers (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     kind TEXT NOT NULL,                      -- 'check' (yapıldı/yapılmadı) | 'number' | 'duration'
     unit TEXT,                               -- örn. 'bardak', 'dakika', 'saat'
     frequency TEXT NOT NULL,                 -- 'daily' | 'weekly'
     target REAL,
     archived INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL
   );
   CREATE TABLE tracker_entries (
     id TEXT PRIMARY KEY,
     tracker_id TEXT NOT NULL REFERENCES trackers(id) ON DELETE CASCADE,
     date TEXT NOT NULL,                      -- YYYY-MM-DD (yerel tarih)
     value REAL,
     note TEXT,
     created_at INTEGER NOT NULL
   );
   CREATE INDEX tracker_entries_day ON tracker_entries(tracker_id, date);`
]

function openDb(dir) {
  fs.mkdirSync(dir, { recursive: true })
  const db = new Database(path.join(dir, 'app.db'))
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  for (let v = db.pragma('user_version', { simple: true }); v < MIGRATIONS.length; v++) {
    db.transaction(() => { db.exec(MIGRATIONS[v]); db.pragma('user_version = ' + (v + 1)) })()
  }
  return db
}

module.exports = { openDb }
