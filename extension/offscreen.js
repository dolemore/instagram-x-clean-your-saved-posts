/* Offscreen document: the service worker has no URL.createObjectURL, so it asks this page to
 * turn the CSV and Markdown text into blob: URLs that chrome.downloads can fetch.
 * Messages are addressed with `target: 'offscreen'`:
 *   { type: 'blob:create', text, mime }  ->  { url }
 *   { type: 'blob:revoke', url }         ->  { ok: true } */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target !== 'offscreen') return false;
  if (message.type === 'blob:create') {
    const blob = new Blob([message.text], { type: message.mime || 'text/plain' });
    sendResponse({ url: URL.createObjectURL(blob) });
  } else if (message.type === 'blob:revoke') {
    URL.revokeObjectURL(message.url);
    sendResponse({ ok: true });
  }
  return false;
});
