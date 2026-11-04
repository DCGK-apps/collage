import { describe, expect, it } from 'vitest';
import { installMode, isIos, watchForUpdates, type RegistrationLike } from '../../src/pwa';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD_DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0 Mobile Safari/537.36';
const IOS_CHROME = IPHONE.replace('Version/18.0', 'CriOS/153.0');

const base = { standalone: false, dismissed: false, hasPrompt: false, userAgent: ANDROID, maxTouchPoints: 5 };

describe('isIos', () => {
  it('detects iPhone and iPadOS (which pretends to be a Mac)', () => {
    expect(isIos(IPHONE, 5)).toBe(true);
    expect(isIos(IPAD_DESKTOP_UA, 5)).toBe(true);
    expect(isIos(IPAD_DESKTOP_UA, 0)).toBe(false); // a real Mac
    expect(isIos(ANDROID, 5)).toBe(false);
  });
});

describe('installMode', () => {
  it('offers the install button when the browser can prompt', () => {
    expect(installMode({ ...base, hasPrompt: true })).toBe('prompt');
  });
  it('shows instructions in iOS Safari', () => {
    expect(installMode({ ...base, userAgent: IPHONE })).toBe('ios');
  });
  it('stays quiet in other iOS browsers, without a prompt, when installed or dismissed', () => {
    expect(installMode({ ...base, userAgent: IOS_CHROME })).toBe('none');
    expect(installMode(base)).toBe('none');
    expect(installMode({ ...base, hasPrompt: true, standalone: true })).toBe('none');
    expect(installMode({ ...base, hasPrompt: true, dismissed: true })).toBe('none');
    expect(installMode({ ...base, userAgent: IPHONE, dismissed: true })).toBe('none');
  });
});

class FakeWorker extends EventTarget {
  messages: unknown[] = [];
  constructor(public state = 'installing') {
    super();
  }
  postMessage(m: unknown) {
    this.messages.push(m);
  }
  setState(s: string) {
    this.state = s;
    this.dispatchEvent(new Event('statechange'));
  }
}
class FakeReg extends EventTarget implements RegistrationLike {
  installing: FakeWorker | null = null;
  waiting: FakeWorker | null = null;
}

describe('watchForUpdates', () => {
  it('reports a new worker once it is installed while an old one controls the page', () => {
    const reg = new FakeReg();
    const seen: unknown[] = [];
    watchForUpdates(reg, () => true, (w) => seen.push(w));
    const w = new FakeWorker();
    reg.installing = w;
    reg.dispatchEvent(new Event('updatefound'));
    expect(seen).toEqual([]);
    w.setState('installed');
    expect(seen).toEqual([w]);
  });

  it('ignores the very first install (nothing to update from)', () => {
    const reg = new FakeReg();
    const seen: unknown[] = [];
    watchForUpdates(reg, () => false, (w) => seen.push(w));
    const w = new FakeWorker();
    reg.installing = w;
    reg.dispatchEvent(new Event('updatefound'));
    w.setState('installed');
    expect(seen).toEqual([]);
  });

  it('reports an update that was already waiting when the app opened', () => {
    const reg = new FakeReg();
    reg.waiting = new FakeWorker('installed');
    const seen: unknown[] = [];
    watchForUpdates(reg, () => true, (w) => seen.push(w));
    expect(seen).toEqual([reg.waiting]);
  });
});
