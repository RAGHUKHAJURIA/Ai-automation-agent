export {};

declare global {
  interface Window {
    desktopApi: {
      getStatus(): Promise<unknown>;
      beginPairing(input: unknown): Promise<unknown>;
      confirmPairing(): Promise<unknown>;
      cancelPairing(): Promise<unknown>;
      chooseAllowedFolder(input: unknown): Promise<unknown>;
      updateFolderPermissions(input: unknown): Promise<unknown>;
      removeAllowedFolder(input: unknown): Promise<unknown>;
      pauseWorker(): Promise<unknown>;
      resumeWorker(): Promise<unknown>;
      emergencyStop(): Promise<unknown>;
      resetEmergencyStop(): Promise<unknown>;
      focusBrowser(): Promise<unknown>;
      resetBrowserProfile(): Promise<unknown>;
      onStatus(listener: (status: unknown) => void): () => void;
    };
  }
}
