import type { Mode } from './modes'
export type Role = 'user' | 'assistant'
export type ReasoningLevel = 'off' | 'low' | 'medium' | 'high'
export interface ReasoningConfig { level: ReasoningLevel }
/** Bir cevabın düşünme süreci: ne istendi, ne zaman başladı/bitti, kaç token harcandı. note: model seviyeyi yok saydı / kapatılamadı. */
export interface ThinkInfo { requested: boolean; level: string; start: number; end?: number; tokens?: number; note?: 'ignored' | 'lowest' }
/** Sohbete eklenen notun o anki kopyası (not sonradan değişse de mesaj aynı kalır). */
export interface NoteRef { id: string; title: string; text: string }
/** projectId yoksa not "Genel" altındadır. createdBy 'ai': notu model sohbetten oluşturdu (chatId: hangi sohbette). */
export interface Note { id: string; title: string; body: string; pinned?: boolean; projectId?: string; createdBy?: 'ai'; chatId?: string; createdAt: number; updatedAt: number }
/** Modelin sohbetten yaptığı not önerisi ve sonucu. body: kaydedilecek metin (not biçiminde; eklemede yalnızca eklenen kısım,
 *  düzenlemede oldText'in yerine geçecek metin; oldText notta tam bir kez geçer).
 *  pending: önizleme kartı onay bekliyor · saved: yazıldı (noteId; eklemede revId = önceki halin revizyonu) · undone: geri alındı.
 *  savedAt: notun yazıldığı andaki updatedAt değeri (sonradan elle değişti mi anlamak için). */
/** target 'event': takvim önerisi (kind create | update | delete). event: yazılacak alanlar · eventId: hedef etkinlik · before: değişiklikten ya da silmeden önceki hali (geri alma).
 *  target 'tracker': yeni takip önerisi (tracker: alanlar, trackerId: oluşan takip) · target 'entry': modelin onaysız eklediği takip kaydı (entryId; body: "6 bardak · bugün"), yalnızca geri alınabilir. */
export interface NoteOp { target?: 'note' | 'event' | 'tracker' | 'entry'; tracker?: TrackerInput; trackerId?: string; entryId?: string; event?: EventInput; eventId?: string; before?: CalEvent; id: string; kind: 'create' | 'append' | 'edit' | 'update' | 'delete'; oldText?: string; status: 'pending' | 'saved' | 'cancelled' | 'undone'; title: string; body: string; projectId?: string | null; noteId?: string; revId?: number; savedAt?: number; auto?: boolean; error?: string }
/** Önizleme kartında kullanıcının son hali. */
export interface NoteEdit { title: string; body: string; projectId: string | null }
/** Uygulama bölümleri (kenar çubuğundaki seçici ve ana alan). Yeni bölüm eklemek için buraya ekleyin. */
export type SbPage = 'chat' | 'notes' | 'projects' | 'calendar' | 'trackers'
// ---- takip ----
/** check: yapıldı/yapılmadı · number: sayı (bardak, sayfa) · duration: süre (dakika, saat). */
export type TrackerKind = 'check' | 'number' | 'duration'
/** target: frequency dönemindeki hedef (günlük ya da haftalık miktar; check türünde haftada/günde kaç kez). */
export interface TrackerInput { name: string; kind: TrackerKind; unit: string | null; frequency: 'daily' | 'weekly'; target: number | null }
export interface Tracker extends TrackerInput { id: string; createdAt: number }
/** Takip ve bir haftanın değerleri: days pazartesiden pazara günlük toplamlar, total haftanın toplamı. */
export interface TrackerWeek extends Tracker { days: number[]; total: number }
// ---- takvim ----
export type EventKind = 'ders' | 'sinav' | 'odev' | 'antrenman' | 'ogun' | 'diger'
export type WeekDay = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU'
/** days yalnızca haftalık tekrarda anlamlıdır (boşsa başlangıç gününün haftanın günü); until: son gün, YYYY-AA-GG. */
export interface EventRepeat { freq: 'daily' | 'weekly'; days: WeekDay[]; until: string | null }
/** startAt/endAt: yerel saatle epoch ms. allDay ise saat yok sayılır. Tekrarlayan etkinlik tek kayıttır; değişiklik tüm seriye uygulanır. */
export interface EventInput { title: string; kind: EventKind; startAt: number; endAt: number | null; allDay: boolean; repeat: EventRepeat | null; projectId: string | null; notes: string | null }
export interface CalEvent extends EventInput { id: string; createdBy: 'user' | 'ai'; createdAt: number }
/** Etkinliğin takvimde görünen bir günü: at/until o günün başlangıcı ve bitişi. */
export interface EventOcc extends CalEvent { at: number; until: number | null }
export type ProjectKind = 'ders' | 'kisisel'
export interface Project { id: string; name: string; kind: ProjectKind; createdAt: number; fileCount: number }
export type FileStatus = 'queued' | 'processing' | 'ready' | 'error'
/** Arşivdeki dosya. ocrPages: metni çıkarılamayan (taranmış) sayfa sayısı; pageCount düz metinde null. */
export interface ArchiveFile { id: string; projectId: string; name: string; mime: string; size: number; pageCount: number | null; ocrPages: number; status: FileStatus; error: string | null; createdAt: number }
/** rejected: desteklenmeyen ya da okunamayan dosyaların adları. */
export interface AddFilesResult { added: ArchiveFile[]; rejected: string[] }
/** Arama sonucu: bir dosya ya da not parçası. page: sayfa/slayt numarası; not ve sayfasız belgelerde null. */
export interface SearchHit { chunkId: number; sourceType: 'file' | 'note'; sourceId: string; sourceName: string; page: number | null; text: string }
export type FileEvent =
  | { type: 'changed'; file: ArchiveFile }
  | { type: 'progress'; id: string; page: number; total: number }
  /** Taranmış sayfalarda OCR ilerlemesi; finished gelince bitmiştir (error varsa yarıda kalmıştır). */
  | { type: 'ocr'; id: string; done: number; total: number; finished?: boolean; error?: string }
/** ocr: taranmış PDF sayfaları için — 'local' Tesseract, 'model' sayfa görselini seçili modele gönderir. semantic: anlamsal (vektör) arama. */
export interface ArchiveSettings { ocr: 'off' | 'local' | 'model'; semantic: boolean }
export interface ArchiveStatus {
  ocr: { mode: ArchiveSettings['ocr']; pending: number; running: boolean }
  semantic: { available: boolean; enabled: boolean; busy: boolean; total: number; embedded: number; error: string | null; model: string }
}
/** Cevaptaki [K<n>] etiketinin karşılığı. loc: "sayfa 37" / "slayt 3" / "not"; sayfasız dosyada boş. Numaralar sohbet boyunca sabittir. */
export interface SourceRef { n: number; sourceType: 'file' | 'note'; sourceId: string; sourceName: string; page: number | null; loc: string; ai?: boolean }
/** Cevaptaki [W<n>] etiketinin karşılığı: web aramasından gelen bir sayfa. content: aramanın döndürdüğü alıntı.
 *  quotes: sağlayıcı konum bildirdiyse kaynağın dayandığı metin parçaları. Numaralar sohbet boyunca sabittir. */
export interface WebRef { n: number; url: string; title: string; content: string; quotes?: string[] }
/** Modelin proje içinde yaptığı bir arama, okuma, kaynak listeleme ya da belge özetleme; 'web': web araması (count: arama sayısı). count yoksa işlem sürüyor. */
export interface ToolStep { kind: 'search' | 'read' | 'web' | 'list' | 'summarize' | 'memory' | 'calendar' | 'tracker'; text: string; count?: number }
/** projectId: mesajda @ ile seçilen proje (metne gömülmez); projectName gösterim için o anki adıdır. */
/** web: bu cevapta gelen web kaynaklarının numaraları; webSearches/webCost: yapılan arama sayısı ve dolar karşılığı. */
/** tokens/inTokens: cevabın çıkış ve giriş token sayısı (araç turları ve alt çağrılar dahil); cost: sağlayıcının bildirdiği dolar karşılığı (yalnızca OpenRouter). */
export interface Msg { inTokens?: number; cost?: number; noteOps?: NoteOp[]; web?: number[]; webSearches?: number; webCost?: number; webNote?: string; projectId?: string; projectName?: string; steps?: ToolStep[]; notes?: NoteRef[]; id: string; role: Role; text: string; ms?: number; tokens?: number; error?: boolean; memo?: string[]; memoErr?: string; thinking?: string; think?: ThinkInfo }
/** mode yoksa sohbet 'chat' modundadır. */
export interface Chat { mode?: Mode; id: string; title: string; updatedAt: number; msgs: Msg[]; sources?: SourceRef[]; webSources?: WebRef[] }
// ---- quiz ----
export type QuizDifficulty = 'easy' | 'medium' | 'hard'
export type QuizKind = 'mcq' | 'open' | 'mixed'
/** focus boşsa tüm proje kapsanır; sources boşsa tüm kaynaklar. */
export interface QuizSettings { difficulty: QuizDifficulty; type: QuizKind; count: number; focus: string; sources: { type: 'file' | 'note'; id: string }[] }
/** Proje sayfasındaki quiz listesi satırı. lastScore: teslim edilmiş son denemenin puanı (0–100); klasik sorular puanlanamadıysa null. */
export interface QuizSummary { id: string; projectId: string; title: string; settings: QuizSettings; createdAt: number; questionCount: number; lastScore: number | null; lastSubmittedAt: number | null; inProgress: boolean }
/** Quiz'in bir kaynak etiketi; dosya ya da not sonradan silindiyse deleted. */
export interface QuizSource extends SourceRef { chunkId: number; deleted: boolean }
/** answer: çoktan seçmelide seçenek sırası ("0"–"3"), klasikte metin. Doğru cevap, açıklama, kaynak ve puan alanları yalnızca teslimden sonra gelir. */
export interface QuizQuestion {
  id: string; idx: number; type: 'mcq' | 'open'; prompt: string; options: string[]; answer: string | null
  correctIndex?: number | null; modelAnswer?: string; keyPoints?: string[]; explanation?: string; sources?: number[]
  isCorrect?: boolean | null; score?: number | null; feedback?: string | null
}
export interface QuizInterpretation { summary: string; strengths: string[]; weaknesses: { topic: string; reason: string; sources: number[] }[]; recommendations: string[] }
/** mode 'run': çözme ekranı (yarım deneme); 'result': teslim edilmiş deneme. pending: puanlama ya da yorum tamamlanamadı, yeniden denenebilir. */
export interface QuizState {
  quiz: { id: string; projectId: string; title: string; settings: QuizSettings; createdAt: number }
  mode: 'run' | 'result'
  attempt: { id: string; startedAt: number; submittedAt: number | null; score: number | null; interpretation: QuizInterpretation | null; pending: boolean }
  questions: QuizQuestion[]
  sources: QuizSource[]
}
/** insufficient: kaynak yetersiz; available kadar soruyla devam edilebilir (0: hiç uygun kaynak yok). */
export type QuizGenResult = { ok: true; quizId: string; notice?: string } | { ok: false; reason: 'insufficient'; available: number } | { ok: false; reason: 'error' | 'aborted'; message?: string }
export type QuizSubmitResult = { ok: true } | { ok: false; reason: 'error' | 'aborted'; message?: string }
export type QuizPhase = 'sources' | 'questions' | 'grading' | 'interpreting'

export interface Provider {
  id: string; kind: 'anthropic' | 'openai'; name: string; baseUrl: string
  apiKey: string; hasKey?: boolean; model: string; savedModels?: string[]
}
/** Hafıza alanı: 'akademik' sohbet modunun, 'yasam' koç modunun, 'genel' iki modun kaydıdır. */
export type MemoryDomain = 'akademik' | 'yasam' | 'genel'
/** domain yoksa 'genel'. modeOnly: kayıt yalnızca kendi alanının modunda kullanılır, diğer moda hiçbir yoldan geçmez. */
export interface MemoryItem { id: string; text: string; domain?: MemoryDomain; modeOnly?: boolean; createdAt: number }
export interface MemoryStore { enabled: boolean; items: MemoryItem[] }
/** Koç modunun kendi talimatı ve modeli. providerId/model yoksa sohbet modunun sağlayıcısı ve modeli kullanılır. */
export interface CoachSettings { systemPrompt: string; providerId?: string; model?: string }
/** lastMode: son kullanılan mod · coachNoticeSeen: koç moduna ilk girişteki uyarı görüldü. */
export interface Settings { modes?: { coach?: CoachSettings }; lastMode?: Mode; coachNoticeSeen?: boolean; activeProvider: string; providers: Provider[]; systemPrompt: string; reasoning?: ReasoningConfig; archive?: ArchiveSettings; webSearch?: { defaultOn: boolean }; notes?: { autoCreate: boolean } }

declare global {
  interface Window {
    api: {
      loadChats(): Promise<Chat[]>
      saveChats(c: Chat[]): Promise<void>
      loadNotes(): Promise<Note[]>
      /** immediate: arama indeksi beklemeden güncellenir. */
      saveNotes(n: Note[], immediate?: boolean): Promise<void>
      /** Modelin not önerisine verilen karar; cevabı üreten araç döngüsü bununla devam eder. */
      resolveNote(requestId: string, opId: string, result: { action: 'saved'; noteId?: string; projectName?: string; edited?: boolean; eventId?: string; trackerId?: string } | { action: 'cancel' } | { action: 'error'; message: string }): Promise<void>
      /** Notun o anki halini saklar ("Geri al" için); revizyon numarasını döndürür. */
      addRevision(r: { noteId: string; title: string; body: string; reason: 'append' | 'edit'; chatId?: string }): Promise<number | null>
      getRevision(id: number): Promise<{ id: number; noteId: string; title: string; body: string; reason: string; createdAt: number } | null>
      /** [from, to) aralığında görünen etkinlik günleri (tekrarlayanlar açılmış), başlangıca göre sıralı. */
      listEvents(from: number, to: number): Promise<EventOcc[]>
      createEvent(input: EventInput, createdBy?: 'user' | 'ai'): Promise<CalEvent>
      updateEvent(id: string, input: Partial<EventInput>): Promise<CalEvent | null>
      /** Siler ve silinen etkinliği döndürür (geri yüklemek için); etkinlik yoksa null. */
      deleteEvent(id: string): Promise<CalEvent | null>
      restoreEvent(snapshot: CalEvent): Promise<CalEvent | null>
      /** weekOf: haftanın herhangi bir günü (YYYY-AA-GG); verilmezse bu hafta. */
      listTrackers(weekOf?: string): Promise<TrackerWeek[]>
      createTracker(input: TrackerInput): Promise<Tracker>
      updateTracker(id: string, patch: Partial<TrackerInput>): Promise<Tracker | null>
      /** Takibi tüm kayıtlarıyla siler. */
      deleteTracker(id: string): Promise<void>
      /** Günün değerini doğrudan belirler (0: günü boşaltır). date: YYYY-AA-GG. */
      setTrackerDay(id: string, date: string, value: number): Promise<void>
      deleteTrackerEntry(id: string): Promise<void>
      loadSettings(): Promise<Settings>
      saveSettings(s: Settings): Promise<void>
      clearKey(id: string): Promise<void>
      listModels(id: string): Promise<string[]>
      loadMemory(): Promise<MemoryStore>
      setMemoryEnabled(v: boolean): Promise<MemoryStore>
      addMemory(t: string, domain?: MemoryDomain): Promise<MemoryStore>
      updateMemory(id: string, patch: { text?: string; domain?: MemoryDomain; modeOnly?: boolean }): Promise<MemoryStore>
      deleteMemory(id: string): Promise<MemoryStore>
      clearMemory(): Promise<MemoryStore>
      extractMemory(req: { mode?: Mode; providerId: string; model?: string; userText: string; assistantText: string }): Promise<{ added: string[]; error?: string }>
      listProjects(): Promise<Project[]>
      createProject(init: { name?: string; kind: ProjectKind }): Promise<Project>
      updateProject(id: string, patch: { name?: string; kind?: ProjectKind }): Promise<Project | null>
      /** Projenin dosyalarını da (diskten ve indeksten) siler. */
      deleteProject(id: string): Promise<void>
      /** projectId null: tüm projelerin dosyaları. */
      listFiles(projectId: string | null): Promise<ArchiveFile[]>
      archiveStatus(): Promise<ArchiveStatus>
      getFile(id: string): Promise<ArchiveFile | null>
      /** Dosyanın uygulama içindeki kopyasının baytları (PDF görüntüleyici için); dosya yoksa null. */
      readFile(id: string): Promise<Uint8Array | null>
      /** Dosyadan çıkarılmış metin, sayfa/slayt sırasıyla. */
      fileText(id: string): Promise<{ page: number; text: string; needsOcr: boolean }[]>
      /** Bir metinle (not) aynı projede en ilgili dosya parçaları; query: eşleşmeleri işaretlemek için kullanılan terimler. */
      relatedSources(projectId: string, text: string, limit?: number): Promise<{ hits: SearchHit[]; query: string }>
      /** Sistem dosya seçicisini açar. */
      pickFiles(projectId: string): Promise<AddFilesResult>
      /** Sürükle-bırak ile gelen dosyalar. */
      addFiles(projectId: string, files: File[]): Promise<AddFilesResult>
      deleteFile(id: string): Promise<void>
      /** Projedeki notlar ve dosyalar içinde arar (bm25 sıralı, varsayılan 8 sonuç). Hatalı sorguda boş dizi döner. */
      searchKnowledge(projectId: string, query: string, limit?: number): Promise<SearchHit[]>
      /** Seçili sağlayıcı ve modelde web araması yapılabilir mi; yapılamıyorsa nedeni. */
      webAvailable(providerId: string, model?: string): Promise<{ ok: boolean; reason?: string }>
      /** Adresi sistem tarayıcısında açar (yalnızca http/https); açılamadıysa false. */
      openExternal(url: string): Promise<boolean>
      listQuizzes(projectId: string): Promise<QuizSummary[]>
      /** Yarım kalan deneme varsa çözme ekranı, yoksa son denemenin sonucu; hiç deneme yoksa yenisi başlar. Quiz yoksa null. */
      quizState(quizId: string): Promise<QuizState | null>
      /** Aynı quiz için yeni deneme başlatır. */
      retakeQuiz(quizId: string): Promise<QuizState | null>
      /** Cevabı kaydeder (boş metin cevabı siler); teslim edilmiş denemede false döner. */
      answerQuiz(attemptId: string, questionId: string, answer: string | null): Promise<boolean>
      deleteQuiz(quizId: string): Promise<void>
      /** Quiz üretir; allowFewer: kaynak yetersizse daha az soruyla devam et. onPhase: 'sources' → 'questions'. */
      generateQuiz(req: { requestId: string; projectId: string; settings: QuizSettings; allowFewer?: boolean; providerId: string; model?: string }, onPhase?: (p: QuizPhase) => void): Promise<QuizGenResult>
      /** Denemeyi teslim eder ve puanlar; yarıda kalmış puanlama için yeniden çağrılabilir. onPhase: 'grading' → 'interpreting'. */
      submitQuiz(req: { requestId: string; attemptId: string; providerId: string; model?: string }, onPhase?: (p: QuizPhase) => void): Promise<QuizSubmitResult>
      abortQuiz(requestId: string): void
      /** Dosya durumu ve işlem ilerlemesi bildirimleri; dönen fonksiyon aboneliği kaldırır. */
      onFileEvent(h: (e: FileEvent) => void): () => void
      stream(
        /** projectId verilirse model o projede araçlarla arar; userText son kullanıcı mesajının yalın metni, sources sohbetin mevcut etiketleridir.
         *  web: web araması aracı isteğe eklensin mi; webSources sohbetin mevcut [W#] kaynaklarıdır. */
        req: { mode?: Mode; web?: boolean; webSources?: WebRef[]; requestId: string; messages: { role: Role; content: string }[]; providerId: string; model?: string; reasoning?: ReasoningLevel; projectId?: string; userText?: string; sources?: SourceRef[] },
        h: { onToken(t: string): void; onThinking?(t: string): void; onTool?(e: ToolStep & { phase: 'start' | 'progress' | 'end' }): void; onNote?(op: Omit<NoteOp, 'status'>): void; onSources?(s: SourceRef[]): void; onWeb?(s: WebRef[], ns: number[]): void; onDone(d: { usage?: { inputTokens?: number; cost?: number; webSearches?: number; webCost?: number; webNote?: string; outputTokens: number; reasoningTokens?: number; reasoningNote?: 'ignored' | 'lowest' }; aborted?: boolean }): void; onError(m: string): void }
      ): () => void
    }
  }
}
