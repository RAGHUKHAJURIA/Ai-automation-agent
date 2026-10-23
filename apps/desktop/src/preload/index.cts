// Electron's CommonJS preload entry requires the CJS import form.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import electron = require('electron');

const { contextBridge, ipcRenderer } = electron;

contextBridge.exposeInMainWorld(
  'desktopApi',
  Object.freeze({
    getStatus: () => ipcRenderer.invoke('desktop:get-status'),
    beginPairing: (input: unknown) => ipcRenderer.invoke('desktop:begin-pairing', input),
    confirmPairing: () => ipcRenderer.invoke('desktop:confirm-pairing'),
    cancelPairing: () => ipcRenderer.invoke('desktop:cancel-pairing'),
    chooseAllowedFolder: (input: unknown) => ipcRenderer.invoke('desktop:choose-folder', input),
    updateFolderPermissions: (input: unknown) =>
      ipcRenderer.invoke('desktop:update-folder-permissions', input),
    removeAllowedFolder: (input: unknown) => ipcRenderer.invoke('desktop:remove-folder', input),
    pauseWorker: () => ipcRenderer.invoke('desktop:pause'),
    resumeWorker: () => ipcRenderer.invoke('desktop:resume'),
    emergencyStop: () => ipcRenderer.invoke('desktop:emergency-stop'),
    resetEmergencyStop: () => ipcRenderer.invoke('desktop:reset-emergency-stop'),
    takeControl: () => ipcRenderer.invoke('desktop:take-control'),
    addApprovedApp: (input: unknown) => ipcRenderer.invoke('desktop:add-app', input),
    disableApprovedApp: (input: unknown) => ipcRenderer.invoke('desktop:disable-app', input),
    removeApprovedApp: (input: unknown) => ipcRenderer.invoke('desktop:remove-app', input),
    focusBrowser: () => ipcRenderer.invoke('desktop:focus-browser'),
    resetBrowserProfile: () => ipcRenderer.invoke('desktop:reset-browser-profile'),
    onStatus: (listener: (status: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, status: unknown) => listener(status);
      ipcRenderer.on('desktop:status', handler);
      return () => ipcRenderer.removeListener('desktop:status', handler);
    },
  }),
);
