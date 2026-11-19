/* Service worker: wires the popup's requests and the X page hook's captures to the job engine
 * (lib/engine.js). Message types:
 *   start   { kind, site, tabId, limit, url, confirmed } -> { ok } | { ok: false, error, args }
 *   stop    {}                                           -> { ok }
 *   reset   {}                                           -> { ok } | { ok: false, error, args }
 *   x:captured  from the X relay content script; no reply
 * Messages with `target: 'offscreen'` are for offscreen.js and ignored here. */
importScripts('lib/common.js', 'lib/instagram.js', 'lib/xparse.js', 'lib/engine.js');

const engine = self.SA.engine;

const unexpected = (e) => ({ ok: false, error: 'errUnexpected', args: [String((e && e.message) || e)] });

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target === 'offscreen') return false;
  switch (message.type) {
    case 'start':
      engine.start(message).then(sendResponse, (e) => sendResponse(unexpected(e)));
      return true; // the reply is asynchronous
    case 'stop':
      engine.stop();
      sendResponse({ ok: true });
      return false;
    case 'reset':
      engine.reset().then(sendResponse, (e) => sendResponse(unexpected(e)));
      return true;
    case 'x:captured':
      engine.onCaptured(message, sender);
      return false;
    default:
      return false;
  }
});

engine.recoverStaleJob().catch(() => {});
