import { contextBridge, ipcRenderer } from 'electron';
import type { AppSnapshot, PiIdeApi } from '../shared/contracts.js';

const api: PiIdeApi = {
  snapshot: () => ipcRenderer.invoke('ide:snapshot'),
  chooseWorkspace: () => ipcRenderer.invoke('ide:choose-workspace'),
  openWorkspace: path => ipcRenderer.invoke('ide:open-workspace', path),
  saveProfile: profile => ipcRenderer.invoke('ide:save-profile', profile),
  createSession: workspaceId => ipcRenderer.invoke('ide:create-session', workspaceId),
  sendPrompt: (sessionId, message) => ipcRenderer.invoke('ide:send-prompt', sessionId, message),
  closeSession: sessionId => ipcRenderer.invoke('ide:close-session', sessionId),
  openPiLogin: workspaceId => ipcRenderer.invoke('ide:open-pi-login', workspaceId),
  onSnapshot(listener) {
    const receive = (_event: Electron.IpcRendererEvent, snapshot: AppSnapshot) => listener(snapshot);
    ipcRenderer.on('ide:changed', receive);
    return () => { ipcRenderer.removeListener('ide:changed', receive); };
  },
};
contextBridge.exposeInMainWorld('piIde', Object.freeze(api));
