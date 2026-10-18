'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('statusApi', {
  get: () => ipcRenderer.invoke('status:get'),
  apply: op => ipcRenderer.invoke('status:apply', op),
  undo: () => ipcRenderer.invoke('status:undo'),
  openFile: () => ipcRenderer.invoke('status:open'),
  openClaude: prompt => ipcRenderer.invoke('claude:open', String(prompt || '')),
  winState: () => ipcRenderer.invoke('win:state'),
  setPinned: on => ipcRenderer.invoke('win:pin', !!on),
  setStay: on => ipcRenderer.invoke('win:stay', !!on),
  setIgnore: on => ipcRenderer.send('win:ignore', !!on),
  setTop: on => ipcRenderer.send('win:top', !!on),
  redraw: () => ipcRenderer.send('win:redraw'),
  resizeBegin: () => ipcRenderer.invoke('win:resize-begin'),
  resizeEnd: h => ipcRenderer.invoke('win:resize-end', Number(h)),
  getWall: () => ipcRenderer.invoke('wall:get'),
  onChanged: cb => ipcRenderer.on('status:changed', (_e, s) => cb(s)),
  onPinned: cb => ipcRenderer.on('win:pinned', (_e, on) => cb(on)),
  onStay: cb => ipcRenderer.on('win:stay', (_e, on) => cb(on)),
  onOpen: cb => ipcRenderer.on('win:open', () => cb()),
  onWall: cb => ipcRenderer.on('wall:update', (_e, w) => cb(w)),
  onBounds: cb => ipcRenderer.on('win:bounds', (_e, b) => cb(b))
});
