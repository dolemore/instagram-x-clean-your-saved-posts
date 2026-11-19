/* X (Twitter): parsing of bookmark timeline responses, plus the functions injected into the page.
 *
 * Runs in the X relay content script (to reduce a GraphQL response to compact posts before it is
 * sent to the service worker), in the service worker and in the node tests. The `page*` functions
 * are serialized by chrome.scripting.executeScript, so each must stay self-contained. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./common.js'));
  else root.SA = Object.assign(root.SA || {}, factory(root.SA || {}));
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';

  /** Every tweet object in a timeline response. Restricted posts come wrapped one level deeper. */
  function findTweets(node) {
    const found = [];
    (function walk(n) {
      if (Array.isArray(n)) {
        for (const v of n) walk(v);
      } else if (n && typeof n === 'object') {
        const result = n.tweet_results && n.tweet_results.result;
        if (result && typeof result === 'object') found.push(result.tweet || result);
        for (const key of Object.keys(n)) walk(n[key]);
      }
    })(node);
    return found;
  }

  /** A tweet object to { site, code, user, date, link, caption, media: [{ n, url, ext }] }, or
   * null when it has no id (deleted or unavailable posts). Photos are requested in original
   * size and videos at the highest-bitrate mp4. */
  function parseTweet(tweet) {
    const legacy = tweet.legacy || {};
    const id = tweet.rest_id || legacy.id_str;
    if (!id) return null;
    const author = ((tweet.core || {}).user_results || {}).result || {};
    const user = (author.core || {}).screen_name || (author.legacy || {}).screen_name || 'unknown';
    const longText = (((tweet.note_tweet || {}).note_tweet_results || {}).result || {}).text;

    const media = [];
    ((legacy.extended_entities || {}).media || []).forEach((item, i) => {
      const n = i + 1;
      if (item.type === 'photo') {
        if (item.media_url_https) {
          media.push({ n, url: item.media_url_https + '?name=orig', ext: C.extFromUrl(item.media_url_https, 'jpg') });
        }
      } else {
        const variants = ((item.video_info || {}).variants || []).filter((v) => v.content_type === 'video/mp4');
        if (variants.length) {
          const best = variants.reduce((a, b) => ((b.bitrate || 0) > (a.bitrate || 0) ? b : a));
          media.push({ n, url: best.url, ext: 'mp4' });
        }
      }
    });

    return {
      site: 'x',
      code: String(id),
      user,
      date: C.twitterDate(legacy.created_at),
      link: 'https://x.com/' + user + '/status/' + id,
      caption: String(longText || legacy.full_text || '').replace(/\r\n|\r|\n/g, ' '),
      media
    };
  }

  // ---- Injected into the page ----------------------------------------------------------------

  /** Scrolls the timeline so X loads the next page of bookmarks. */
  function pageXScroll() {
    window.scrollBy(0, Math.max(window.innerHeight * 2, 2000));
    const cells = document.querySelectorAll('[data-testid="cellInnerDiv"]');
    if (cells.length) cells[cells.length - 1].scrollIntoView({ block: 'end' });
    return cells.length;
  }

  /** Bookmark state of the post `id` on its /i/status/<id> page: 'bookmarked', 'plain', or null
   * while it is not drawn. Only the post's own article is read, so a bookmarked reply or parent
   * in the same thread is never mistaken for it; a page with a single article is accepted as is. */
  function pageXProbe(id) {
    const link = new RegExp('/status/' + id + '(?:$|[/?#])');
    const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
    const own = articles.find((a) =>
      Array.from(a.querySelectorAll('a[href*="/status/"]')).some((l) => link.test(l.getAttribute('href') || '')));
    const article = own || (articles.length === 1 ? articles[0] : null);
    if (!article) return null;
    if (article.querySelector('[data-testid="removeBookmark"]')) return 'bookmarked';
    if (article.querySelector('[data-testid="bookmark"]')) return 'plain';
    return null;
  }

  /** Clicks the remove-bookmark button of the post's own article (same lookup as pageXProbe). */
  function pageXClick(id) {
    const link = new RegExp('/status/' + id + '(?:$|[/?#])');
    const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
    const own = articles.find((a) =>
      Array.from(a.querySelectorAll('a[href*="/status/"]')).some((l) => link.test(l.getAttribute('href') || '')));
    const article = own || (articles.length === 1 ? articles[0] : null);
    const button = article && article.querySelector('[data-testid="removeBookmark"]');
    if (!button) return false;
    button.click();
    return true;
  }

  return { findTweets, parseTweet, pageXScroll, pageXProbe, pageXClick };
});
