/* Runs in the extension's isolated world on x.com. Receives the bookmark responses that
 * x-hook.js copies out of the page, reduces them to compact posts (lib/xparse.js) and sends
 * them to the service worker, which keeps them only while a download job is scanning this tab.
 * Requires lib/common.js and lib/xparse.js to be loaded before it. */
(function () {
  'use strict';

  const TAG = '__saved_posts_archiver__';

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (event.source !== window || !data || data[TAG] !== true || typeof data.text !== 'string') return;

    let json;
    try {
      json = JSON.parse(data.text);
    } catch (_) {
      return; // aborted or non-JSON response
    }

    const tweets = [];
    for (const tweet of self.SA.findTweets(json)) {
      const post = self.SA.parseTweet(tweet);
      if (post) tweets.push(post);
    }

    try {
      chrome.runtime.sendMessage({ type: 'x:captured', operation: data.operation, tweets }).catch(() => {});
    } catch (_) { /* the extension was reloaded; this page keeps working without it */ }
  });
})();
