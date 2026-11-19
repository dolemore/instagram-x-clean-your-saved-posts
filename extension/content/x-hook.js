/* Runs in the page's own JavaScript world on x.com, before X's scripts, and copies the text of
 * every bookmark-related GraphQL response to the relay content script (x-relay.js) with
 * window.postMessage. Nothing else is read or changed: the page still receives its responses
 * untouched. */
(function () {
  'use strict';

  if (window.__savedPostsHook) return;
  window.__savedPostsHook = true;

  const TAG = '__saved_posts_archiver__';

  /** Operation name of a bookmark GraphQL request, else null. */
  function bookmarkOperation(url) {
    try {
      const path = new URL(url, location.href).pathname;
      if (path.indexOf('/graphql/') === -1) return null;
      const operation = path.split('/').pop();
      return /bookmark/i.test(operation) ? operation : null;
    } catch (_) {
      return null;
    }
  }

  function forward(operation, text) {
    try {
      window.postMessage({ [TAG]: true, operation, text }, location.origin);
    } catch (_) { /* never disturb the page */ }
  }

  const originalFetch = window.fetch;
  window.fetch = function (input) {
    const result = Reflect.apply(originalFetch, this, arguments);
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || String(input);
      const operation = bookmarkOperation(url);
      if (operation) {
        result.then((response) => response.clone().text())
          .then((text) => forward(operation, text))
          .catch(() => {});
      }
    } catch (_) { /* never disturb the page */ }
    return result;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__savedPostsOperation = bookmarkOperation(String(url));
    return Reflect.apply(originalOpen, this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    if (this.__savedPostsOperation) {
      this.addEventListener('load', () => {
        try {
          const text = this.responseType === '' || this.responseType === 'text'
            ? this.responseText
            : JSON.stringify(this.response);
          forward(this.__savedPostsOperation, text);
        } catch (_) { /* never disturb the page */ }
      });
    }
    return Reflect.apply(originalSend, this, arguments);
  };
})();
