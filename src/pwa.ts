/**
 * Installable app (PWA): install prompt and "new version available" banner.
 * The decision logic is pure and unit-tested; `initPwa` wires it to the page.
 */

/** Chrome/Edge/Samsung `beforeinstallprompt` event. */
export interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type InstallMode = 'prompt' | 'ios' | 'none';

/** iPhone/iPad Safari cannot prompt – it needs "Share → Add to Home Screen". */
export function isIos(userAgent: string, maxTouchPoints: number): boolean {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return true;
  // iPadOS reports itself as a Mac; touch support gives it away.
  return /Macintosh/i.test(userAgent) && maxTouchPoints > 1;
}

export function installMode(o: {
  standalone: boolean;
  dismissed: boolean;
  hasPrompt: boolean;
  userAgent: string;
  maxTouchPoints: number;
}): InstallMode {
  if (o.standalone || o.dismissed) return 'none';
  if (o.hasPrompt) return 'prompt';
  // Other iOS browsers (CriOS, FxiOS) cannot add to home screen reliably – only hint in Safari.
  if (isIos(o.userAgent, o.maxTouchPoints) && !/CriOS|FxiOS|EdgiOS/i.test(o.userAgent)) return 'ios';
  return 'none';
}

/* ------------------------------------------------------------------ updates */

interface WorkerLike extends EventTarget {
  state: string;
  postMessage(msg: unknown): void;
}

export interface RegistrationLike extends EventTarget {
  installing: WorkerLike | null;
  waiting: WorkerLike | null;
}

/**
 * Calls `onUpdate(worker)` once a new service worker is installed and waiting
 * while an older one controls the page (i.e. a real update, not the first install).
 */
export function watchForUpdates(
  reg: RegistrationLike,
  hasController: () => boolean,
  onUpdate: (worker: WorkerLike) => void,
): void {
  if (reg.waiting && hasController()) onUpdate(reg.waiting);
  reg.addEventListener('updatefound', () => {
    const w = reg.installing;
    if (!w) return;
    w.addEventListener('statechange', () => {
      if (w.state === 'installed' && hasController()) onUpdate(w);
    });
  });
}

/* ------------------------------------------------------------------ wiring */

export interface PwaDeps {
  loadPref: <T>(key: string, fallback: T) => T;
  savePref: (key: string, value: unknown) => void;
  toast: (text: string) => void;
}

export function initPwa(deps: PwaDeps): void {
  const $ = (id: string) => document.getElementById(id)!;
  const installBanner = $('install-banner');
  const updateBanner = $('update-banner');
  let deferred: InstallPromptEvent | null = null;

  const standalone = (): boolean =>
    window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

  const refreshInstall = (): void => {
    const mode = installMode({
      standalone: standalone(),
      dismissed: deps.loadPref('installDismissed', false),
      hasPrompt: !!deferred,
      userAgent: navigator.userAgent,
      maxTouchPoints: navigator.maxTouchPoints ?? 0,
    });
    installBanner.hidden = mode === 'none';
    installBanner.dataset.mode = mode;
  };

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    refreshInstall();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installBanner.hidden = true;
    deps.toast('Zainstalowano Collage');
  });
  $('btn-install').addEventListener('click', async () => {
    if (!deferred) return;
    const ev = deferred;
    deferred = null;
    installBanner.hidden = true; // a prompt can be shown only once per event
    await ev.prompt();
    await ev.userChoice.catch(() => undefined);
  });
  $('btn-install-close').addEventListener('click', () => {
    deps.savePref('installDismissed', true);
    installBanner.hidden = true;
  });
  refreshInstall();

  // Service worker: offline support + update notice. Only in the built app.
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  let waiting: WorkerLike | null = null;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!reloading && waiting) {
      reloading = true;
      window.location.reload();
    }
  });
  $('btn-update').addEventListener('click', () => {
    updateBanner.hidden = true;
    waiting?.postMessage({ type: 'SKIP_WAITING' });
  });
  $('btn-update-later').addEventListener('click', () => {
    updateBanner.hidden = true;
  });

  navigator.serviceWorker
    .register('./sw.js')
    .then((reg) => {
      watchForUpdates(reg, () => !!navigator.serviceWorker.controller, (w) => {
        waiting = w;
        updateBanner.hidden = false;
      });
      // Look for a new version when the app comes back to the foreground, and hourly.
      const check = () => reg.update().catch(() => undefined);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void check();
      });
      setInterval(check, 60 * 60 * 1000);
    })
    .catch(() => undefined);
}
