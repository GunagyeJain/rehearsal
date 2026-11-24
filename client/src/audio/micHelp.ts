/** Recovery steps when the microphone is blocked, per browser (spec/screens.md section 2). */

export type BrowserFamily = 'edge' | 'chrome' | 'firefox' | 'safari-ios' | 'safari' | 'other';

export interface MicHelp {
  browser: string;
  steps: readonly string[];
}

export function detectBrowser(userAgent: string): BrowserFamily {
  if (/Edg\//.test(userAgent)) return 'edge';
  if (/Firefox\/|FxiOS\//.test(userAgent)) return 'firefox';
  if (/iPhone|iPad|iPod/.test(userAgent)) return 'safari-ios';
  if (/Chrome\/|CriOS\/|Chromium\//.test(userAgent)) return 'chrome';
  if (/Safari\//.test(userAgent)) return 'safari';
  return 'other';
}

const RELOAD = 'Reload this page.';

const HELP: Readonly<Record<BrowserFamily, MicHelp>> = {
  chrome: {
    browser: 'Chrome',
    steps: ['Select the site controls icon at the left of the address bar.', 'Turn Microphone on, or set it to Allow.', RELOAD],
  },
  edge: {
    browser: 'Edge',
    steps: ['Select the lock icon at the left of the address bar.', 'Open Permissions for this site and set Microphone to Allow.', RELOAD],
  },
  firefox: {
    browser: 'Firefox',
    steps: ['Select the crossed-out microphone icon in the address bar.', 'Clear the Blocked setting next to Use the microphone.', RELOAD],
  },
  safari: {
    browser: 'Safari',
    steps: ['Open the Safari menu and choose Settings for this website.', 'Set Microphone to Allow.', RELOAD],
  },
  'safari-ios': {
    browser: 'Safari on iPhone or iPad',
    steps: ['Tap the page settings button in the address bar.', 'Choose Website Settings and set Microphone to Allow.', RELOAD],
  },
  other: {
    browser: 'your browser',
    steps: ['Open the site settings from the address bar.', 'Allow the microphone for this site.', RELOAD],
  },
};

export function micHelpFor(userAgent: string): MicHelp {
  return HELP[detectBrowser(userAgent)];
}
