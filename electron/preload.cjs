const { contextBridge, ipcRenderer, webUtils } = require('electron')

// Uzun quiz işlemleri (üretim, teslim): sonuç invoke ile döner, ara aşamalar 'quiz:event' ile bildirilir.
async function quizTask(channel, req, onPhase) {
  const l = (_e, d) => { if (d.requestId === req.requestId && onPhase) onPhase(d.phase) }
  ipcRenderer.on('quiz:event', l)
  try { return await ipcRenderer.invoke(channel, req) } finally { ipcRenderer.removeListener('quiz:event', l) }
}

contextBridge.exposeInMainWorld('api', {
  loadChats: () => ipcRenderer.invoke('chats:load'),
  saveChats: (c) => ipcRenderer.invoke('chats:save', c),
  loadNotes: () => ipcRenderer.invoke('notes:load'),
  saveNotes: (n, immediate) => ipcRenderer.invoke('notes:save', n, immediate),
  resolveNote: (requestId, opId, result) => ipcRenderer.invoke('note:resolve', requestId, opId, result),
  addRevision: (r) => ipcRenderer.invoke('notes:revisionAdd', r),
  getRevision: (id) => ipcRenderer.invoke('notes:revisionGet', id),
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (s) => ipcRenderer.invoke('settings:save', s),
  clearKey: (id) => ipcRenderer.invoke('settings:clearKey', id),
  listModels: (id) => ipcRenderer.invoke('models:list', id),
  loadMemory: () => ipcRenderer.invoke('memory:load'),
  setMemoryEnabled: (v) => ipcRenderer.invoke('memory:setEnabled', v),
  addMemory: (t, domain) => ipcRenderer.invoke('memory:add', t, domain),
  updateMemory: (id, patch) => ipcRenderer.invoke('memory:update', id, patch),
  deleteMemory: (id) => ipcRenderer.invoke('memory:delete', id),
  clearMemory: () => ipcRenderer.invoke('memory:clear'),
  extractMemory: (req) => ipcRenderer.invoke('memory:extract', req),
  listProjects: () => ipcRenderer.invoke('projects:list'),
  createProject: (init) => ipcRenderer.invoke('projects:create', init),
  updateProject: (id, patch) => ipcRenderer.invoke('projects:update', id, patch),
  deleteProject: (id) => ipcRenderer.invoke('projects:delete', id),
  listFiles: (projectId) => ipcRenderer.invoke('files:list', projectId),
  pickFiles: (projectId) => ipcRenderer.invoke('files:pick', projectId),
  // Sürüklenen dosyaların diskteki yolu yalnızca burada çözülür (File.path artık yok).
  addFiles: (projectId, files) => ipcRenderer.invoke('files:add', projectId, Array.from(files, (f) => webUtils.getPathForFile(f)).filter(Boolean)),
  deleteFile: (id) => ipcRenderer.invoke('files:delete', id),
  searchKnowledge: (projectId, query, limit) => ipcRenderer.invoke('search:knowledge', projectId, query, limit),
  relatedSources: (projectId, text, limit) => ipcRenderer.invoke('search:related', projectId, text, limit),
  archiveStatus: () => ipcRenderer.invoke('archive:status'),
  getFile: (id) => ipcRenderer.invoke('files:get', id),
  readFile: (id) => ipcRenderer.invoke('files:read', id),
  fileText: (id) => ipcRenderer.invoke('files:text', id),
  webAvailable: (providerId, model) => ipcRenderer.invoke('web:available', providerId, model),
  openExternal: (url) => ipcRenderer.invoke('open:external', url),
  listQuizzes: (projectId) => ipcRenderer.invoke('quiz:list', projectId),
  quizState: (quizId) => ipcRenderer.invoke('quiz:state', quizId),
  retakeQuiz: (quizId) => ipcRenderer.invoke('quiz:retake', quizId),
  answerQuiz: (attemptId, questionId, answer) => ipcRenderer.invoke('quiz:answer', attemptId, questionId, answer),
  deleteQuiz: (quizId) => ipcRenderer.invoke('quiz:delete', quizId),
  generateQuiz: (req, onPhase) => quizTask('quiz:generate', req, onPhase),
  submitQuiz: (req, onPhase) => quizTask('quiz:submit', req, onPhase),
  abortQuiz: (requestId) => ipcRenderer.send('quiz:abort', requestId),
  onFileEvent: (fn) => {
    const l = (_e, d) => fn(d)
    ipcRenderer.on('files:event', l)
    return () => ipcRenderer.removeListener('files:event', l)
  },
  stream: (req, handlers) => {
    const { requestId } = req
    const on = (ch, fn) => {
      const l = (_e, d) => { if (d.requestId === requestId) fn(d) }
      ipcRenderer.on(ch, l)
      return () => ipcRenderer.removeListener(ch, l)
    }
    const offs = []
    const cleanup = () => offs.forEach((f) => f())
    offs.push(on('chat:token', (d) => handlers.onToken(d.token)))
    offs.push(on('chat:thinking', (d) => handlers.onThinking && handlers.onThinking(d.token)))
    offs.push(on('chat:tool', (d) => handlers.onTool && handlers.onTool({ phase: d.phase, kind: d.kind, text: d.text, count: d.count })))
    offs.push(on('chat:note', (d) => handlers.onNote && handlers.onNote(d.op)))
    offs.push(on('chat:sources', (d) => handlers.onSources && handlers.onSources(d.sources)))
    offs.push(on('chat:web', (d) => handlers.onWeb && handlers.onWeb(d.webSources, d.ns)))
    offs.push(on('chat:done', (d) => { cleanup(); handlers.onDone(d) }))
    offs.push(on('chat:error', (d) => { cleanup(); handlers.onError(d.message) }))
    ipcRenderer.send('chat:stream', req)
    return () => ipcRenderer.send('chat:abort', requestId)
  }
})
