import { contextBridge } from 'electron'

// API, яке буде доступне в renderer як window.api.
// Поки порожнє — наповнимо, коли почнемо логіку синку (логін, статус, синхронізація).
const api = {}

contextBridge.exposeInMainWorld('api', api)
