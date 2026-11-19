'use strict';

/* Static and pure-code checks for the extension: node --test tests/ */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const EXT = path.join(__dirname, '..', 'extension');
const read = (...parts) => fs.readFileSync(path.join(EXT, ...parts), 'utf8');
const C = require(path.join(EXT, 'lib', 'common.js'));
const IG = require(path.join(EXT, 'lib', 'instagram.js'));
const X = require(path.join(EXT, 'lib', 'xparse.js'));
const locale = (lang) => JSON.parse(read('_locales', lang, 'messages.json'));

function jsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return jsFiles(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

// ---- Package ---------------------------------------------------------------------------------

test('every script parses', () => {
  for (const file of jsFiles(EXT)) {
    assert.doesNotThrow(() => new vm.Script(fs.readFileSync(file, 'utf8'), { filename: file }), file);
  }
});

test('manifest references files that exist and keeps the permission list small', () => {
  const m = JSON.parse(read('manifest.json'));
  const files = new Set([m.background.service_worker, m.action.default_popup,
    ...Object.values(m.icons), ...Object.values(m.action.default_icon)]);
  for (const cs of m.content_scripts) for (const f of cs.js) files.add(f);
  for (const f of files) assert.ok(fs.existsSync(path.join(EXT, f)), 'missing ' + f);
  assert.ok(fs.existsSync(path.join(EXT, '_locales', m.default_locale, 'messages.json')));

  assert.equal(m.manifest_version, 3);
  assert.ok(Number(m.minimum_chrome_version) >= 116, 'getContexts and MAIN-world scripts need Chrome 116');
  assert.deepEqual([...m.permissions].sort(), ['downloads', 'offscreen', 'scripting', 'storage']);
  assert.deepEqual(m.host_permissions,
    ['*://*.instagram.com/*', '*://x.com/*', '*://*.twimg.com/*', '*://*.cdninstagram.com/*']);

  const hook = m.content_scripts.find((c) => c.js.includes('content/x-hook.js'));
  assert.equal(hook.world, 'MAIN');
  assert.equal(hook.run_at, 'document_start');
});

test('service worker imports and the offscreen page point at real files', () => {
  const imports = /importScripts\(([^)]*)\)/.exec(read('background.js'))[1].match(/'([^']+)'/g).map((s) => s.slice(1, -1));
  for (const f of imports) assert.ok(fs.existsSync(path.join(EXT, f)), f);
  assert.match(read('lib', 'engine.js'), /url: 'offscreen\.html'/);
  assert.ok(fs.existsSync(path.join(EXT, 'offscreen.html')));
  assert.match(read('offscreen.html'), /src="offscreen\.js"/);
});

test('icons are PNGs of the declared sizes', () => {
  for (const size of [16, 48, 128]) {
    const png = fs.readFileSync(path.join(EXT, 'icons', `icon${size}.png`));
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
  }
});

// ---- Locales ---------------------------------------------------------------------------------

test('locales: same keys, consistent placeholders, store length limits', () => {
  const en = locale('en');
  const tr = locale('tr');
  assert.deepEqual(Object.keys(en).sort(), Object.keys(tr).sort());
  for (const [lang, messages] of [['en', en], ['tr', tr]]) {
    for (const [key, entry] of Object.entries(messages)) {
      const where = `${lang}.${key}`;
      const used = [...entry.message.matchAll(/\$([A-Za-z0-9_]+)\$/g)].map((m) => m[1].toLowerCase()).sort();
      const defined = Object.keys(entry.placeholders || {}).sort();
      assert.deepEqual(used, defined, where);
      assert.ok(!entry.message.replace(/\$[A-Za-z0-9_]+\$/g, '').includes('$'), where + ': stray $');
      const contents = Object.values(entry.placeholders || {}).map((p) => p.content).sort();
      assert.deepEqual(contents, defined.map((_, i) => '$' + (i + 1)), where + ': placeholders must be $1..$n');
    }
    assert.ok(messages.extDescription.message.length <= 132, lang + ' description is over 132 characters');
    assert.ok(messages.extName.message.length <= 45, lang + ' name is over 45 characters');
  }
  for (const key of Object.keys(en)) {
    assert.deepEqual(Object.keys(en[key].placeholders || {}), Object.keys(tr[key].placeholders || {}), key);
  }
});

test('locales: every key used in the code exists and every key is used', () => {
  const keys = new Set(Object.keys(locale('en')));
  const sources = {
    manifest: read('manifest.json'),
    html: read('popup.html'),
    popup: read('popup.js'),
    engine: read('lib', 'engine.js'),
    background: read('background.js')
  };
  const used = new Set();
  const collect = (re, text) => { for (const m of text.matchAll(re)) used.add(m[1]); };
  collect(/__MSG_(\w+)__/g, sources.manifest);
  collect(/data-i18n(?:-[a-z]+)?="(\w+)"/g, sources.html);
  const literal = /'((?:ext|site|label|placeholder|hint|btn|warn|chk|confirm|stats?|status|kind|phase|ctr|log|sum|err)[A-Z]\w*)'/g;
  for (const name of ['popup', 'engine', 'background']) collect(literal, sources[name]);

  for (const key of used) assert.ok(keys.has(key), 'missing message: ' + key);
  for (const key of keys) assert.ok(used.has(key), 'unused message: ' + key);
});

// ---- Naming, allowlist, CSV, Markdown --------------------------------------------------------

test('media names and URL allowlist', () => {
  assert.equal(C.mediaName({ date: '2026-01-02', user: 'a.b_c', code: 'Cx-9_z' }, 3, 'jpg'), '2026-01-02_a.b_c_Cx-9_z_03.jpg');
  assert.equal(C.mediaName({ date: '2026-01-02', user: 'a/b', code: '..' }, 1, 'mp4'), '2026-01-02_a_b_.._01.mp4');
  assert.equal(C.extFromUrl('https://pbs.twimg.com/media/A.PNG?name=orig', 'jpg'), 'png');
  assert.equal(C.extFromUrl('https://x.test/a.jpeg', 'png'), 'jpg');
  assert.equal(C.extFromUrl('https://x.test/a.exe', 'jpg'), 'jpg');

  const ok = (site, url) => C.isAllowedMediaUrl(site, url);
  assert.ok(ok('instagram', 'https://scontent-ist1-1.cdninstagram.com/v/a.jpg'));
  assert.ok(ok('instagram', 'https://instagram.fist1-1.fna.fbcdn.net/v/a.mp4'), 'fbcdn serves much Instagram media');
  assert.ok(ok('x', 'https://pbs.twimg.com/media/A.jpg?name=orig'));
  assert.ok(ok('x', 'https://video.twimg.com/ext_tw_video/1/vid/a.mp4'));
  assert.ok(!ok('x', 'https://scontent.cdninstagram.com/a.jpg'));
  assert.ok(!ok('instagram', 'https://pbs.twimg.com/a.jpg'));
  assert.ok(!ok('x', 'http://pbs.twimg.com/a.jpg'), 'http is refused');
  assert.ok(!ok('x', 'https://pbs.twimg.com.evil.example/a.jpg'));
  assert.ok(!ok('x', 'https://eviltwimg.com/a.jpg'));
  assert.ok(!ok('x', 'not a url'));
});

test('CSV quoting, BOM and line endings', () => {
  const rows = [{ date: '2026-01-02', user: 'u', link: 'https://x/1', files: 'a.jpg | b.jpg', caption: 'He said "hi", then\nleft' }];
  const csv = C.toCsv(rows);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.equal(csv.slice(1), 'date,user,link,files,caption\r\n2026-01-02,u,https://x/1,a.jpg | b.jpg,"He said ""hi"", then left"\r\n');
});

test('rows list the names Chrome saved, in slide order, newest post first', () => {
  const recs = [
    { code: 'a', date: '2026-01-01', user: 'u', link: 'l1', caption: 'c1', files: [{ n: 2, name: 'x_02 (1).jpg', ok: true }, { n: 1, name: 'x_01.jpg', ok: true }, { n: 3, name: 'x_03.jpg', ok: false }] },
    { code: 'b', date: '2026-02-01', user: 'v', link: 'l2', caption: 'c2', files: [] }
  ];
  const rows = C.sortedRows(recs);
  assert.deepEqual(rows.map((r) => r.link), ['l2', 'l1']);
  assert.equal(rows[1].files, 'x_01.jpg | x_02 (1).jpg');
});

test('Markdown entry matches the Python export and splits by word count', () => {
  const row = { user: 'alice', date: '2026-01-02', link: 'https://www.instagram.com/p/CAR1/', files: 'a.jpg | b.mp4', caption: ' caption text ' };
  assert.equal(C.markdownEntry(row),
    '## @alice — 2026-01-02\nLink: https://www.instagram.com/p/CAR1/\nFiles: a.jpg, b.mp4\n\ncaption text\n');
  assert.match(C.markdownEntry({ user: 'x', date: 'd', link: 'l', files: '', caption: '' }), /\n\n\(no caption\)\n$/);

  const rows = Array.from({ length: 5 }, (_, i) => ({ user: 'u' + i, date: '2026-01-0' + (i + 1), link: 'l', files: '', caption: 'w '.repeat(20) }));
  const words = C.countWords(C.markdownEntry(rows[0]));
  const parts = C.buildMarkdownParts('x', rows, words * 2 + 1);
  assert.deepEqual(parts.map((p) => p.count), [2, 2, 1]);
  assert.ok(parts.every((p) => p.text.startsWith('# Saved posts archive: x\n\n')));
  assert.equal(C.buildMarkdownParts('x', rows).length, 1, 'default part size is 300,000 words');
  assert.equal(C.WORDS_PER_PART, 300000);
});

// ---- Records ---------------------------------------------------------------------------------

test('completeness and cleaning eligibility', () => {
  const ok = (n) => ({ n, name: 'f' + n, id: n, ok: true });
  assert.ok(!C.isComplete({ site: 'instagram', need: [1, 2], files: [ok(1)] }));
  assert.ok(C.isComplete({ site: 'instagram', need: [1, 3], files: [ok(3), ok(1)] }), 'slide numbers may have gaps');
  assert.ok(!C.isComplete({ site: 'instagram', need: [], files: [] }), 'an Instagram post with no media is never archived');
  assert.ok(C.isComplete({ site: 'x', need: [], files: [] }), 'a text-only bookmark lives in the index');
  assert.ok(!C.isComplete({ site: 'x', need: [1], files: [{ n: 1, ok: false }] }));

  const media = { site: 'instagram', need: [1], files: [ok(1)], updatedAt: 50 };
  assert.ok(C.isReadyToClean(media, undefined), 'a post with files does not wait for the index');
  assert.ok(!C.isReadyToClean({ ...media, cleaned: true }, 100));
  const text = { site: 'x', need: [], files: [], updatedAt: 50 };
  assert.ok(!C.isReadyToClean(text, undefined), 'text-only needs an index');
  assert.ok(!C.isReadyToClean(text, 40), 'the index is older than the post');
  assert.ok(C.isReadyToClean(text, 50));

  const stats = C.summarize([media, { ...media, cleaned: true }, text, { site: 'instagram', need: [1, 2], files: [ok(1)] }], 100);
  assert.deepEqual(stats, { posts: 4, downloaded: 3, ready: 2, cleaned: 1, incomplete: 1 });
});

// ---- Instagram parsing -----------------------------------------------------------------------

const TAKEN = Date.UTC(2026, 0, 2, 12, 0, 0) / 1000;

test('Instagram: carousel, video and plain image', () => {
  const carousel = IG.parseSavedItem({
    media: {
      code: 'CAR1', pk: '9', taken_at: TAKEN, user: { username: 'alice' },
      caption: { text: 'Line one\nline "two", with comma' },
      carousel_media: [
        { image_versions2: { candidates: [
          { url: 'https://scontent.cdninstagram.com/small.jpg', width: 320, height: 320 },
          { url: 'https://scontent.cdninstagram.com/big.jpg?x=1', width: 1080, height: 1350 }] } },
        { video_versions: [{ url: 'https://instagram.fist1-1.fna.fbcdn.net/v/clip.mp4?x=1' }, { url: 'https://scontent.cdninstagram.com/low.mp4' }],
          image_versions2: { candidates: [{ url: 'https://scontent.cdninstagram.com/poster.jpg', width: 100, height: 100 }] } },
        {}
      ]
    }
  });
  assert.equal(carousel.code, 'CAR1');
  assert.equal(carousel.user, 'alice');
  assert.equal(carousel.link, 'https://www.instagram.com/p/CAR1/');
  assert.equal(carousel.caption, 'Line one line "two", with comma');
  assert.match(carousel.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(carousel.media, [
    { n: 1, url: 'https://scontent.cdninstagram.com/big.jpg?x=1', ext: 'jpg' },
    { n: 2, url: 'https://instagram.fist1-1.fna.fbcdn.net/v/clip.mp4?x=1', ext: 'mp4' }
  ]);

  const reel = IG.parseSavedItem({ media: { code: 'REEL1', taken_at: TAKEN, user: { username: 'bob' }, caption: null,
    video_versions: [{ url: 'https://scontent.cdninstagram.com/r.mp4' }] } });
  assert.deepEqual(reel.media, [{ n: 1, url: 'https://scontent.cdninstagram.com/r.mp4', ext: 'mp4' }]);
  assert.equal(reel.caption, '');
  assert.equal(IG.parseSavedItem({ media: { user: {} } }), null);
});

test('Instagram: feed page results', () => {
  const body = JSON.stringify({ items: [{ media: { code: 'A', taken_at: TAKEN, user: { username: 'u' }, image_versions2: { candidates: [{ url: 'https://scontent.cdninstagram.com/a.jpg', width: 1, height: 1 }] } } }], more_available: true, next_max_id: 'NEXT' });
  const ok = IG.parseSavedPage(200, body);
  assert.equal(ok.kind, 'ok');
  assert.equal(ok.posts.length, 1);
  assert.equal(ok.moreAvailable, true);
  assert.equal(ok.nextMaxId, 'NEXT');
  assert.equal(IG.parseSavedPage(200, JSON.stringify({ items: [], more_available: false })).moreAvailable, false);
  assert.equal(IG.parseSavedPage(401, '{}').kind, 'login');
  assert.equal(IG.parseSavedPage(403, '{"message":"login_required","require_login":true}').kind, 'login');
  assert.equal(IG.parseSavedPage(429, '').kind, 'rate');
  assert.deepEqual(IG.parseSavedPage(200, '<html>challenge</html>'), { kind: 'http', status: 200 });
  assert.deepEqual(IG.parseSavedPage(500, '{}'), { kind: 'http', status: 500 });
});

// ---- X parsing -------------------------------------------------------------------------------

const author = (name) => ({ user_results: { result: { core: { screen_name: name } } } });
const entry = (result) => ({ content: { itemContent: { tweet_results: { result } } } });

test('X: photo, video, text-only, long note, restricted and deleted posts', () => {
  const photo = { rest_id: '111', core: author('carol'), legacy: { created_at: 'Wed Oct 10 20:19:24 +0000 2018', full_text: 'photo\nsecond', extended_entities: { media: [
    { type: 'photo', media_url_https: 'https://pbs.twimg.com/media/AAA.png' },
    { type: 'photo', media_url_https: 'https://pbs.twimg.com/media/BBB.jpg' }] } } };
  const video = { rest_id: '222', core: { user_results: { result: { legacy: { screen_name: 'dave' } } } }, legacy: { created_at: 'Wed Oct 10 20:19:24 +0000 2018', full_text: 'vid', extended_entities: { media: [{ type: 'video', video_info: { variants: [
    { content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/x.m3u8' },
    { content_type: 'video/mp4', bitrate: 256000, url: 'https://video.twimg.com/low.mp4' },
    { content_type: 'video/mp4', bitrate: 2176000, url: 'https://video.twimg.com/high.mp4' },
    { content_type: 'video/mp4', bitrate: 832000, url: 'https://video.twimg.com/mid.mp4' }] } }] } } };
  const gif = { rest_id: '223', core: author('dave'), legacy: { created_at: 'Wed Oct 10 20:19:24 +0000 2018', full_text: 'gif', extended_entities: { media: [{ type: 'animated_gif', video_info: { variants: [{ content_type: 'video/mp4', bitrate: 0, url: 'https://video.twimg.com/g.mp4' }] } }] } } };
  const text = { rest_id: '333', core: author('erin'), legacy: { created_at: 'Wed Oct 10 20:19:24 +0000 2018', full_text: 'just text' } };
  const note = { rest_id: '444', core: author('frank'), legacy: { created_at: 'Wed Oct 10 20:19:24 +0000 2018', full_text: 'short…' }, note_tweet: { note_tweet_results: { result: { text: 'the long\ntext' } } } };
  const restricted = { __typename: 'TweetWithVisibilityResults', tweet: { rest_id: '555', core: author('gina'), legacy: { created_at: 'Wed Oct 10 20:19:24 +0000 2018', full_text: 'restricted' } } };
  const timeline = { data: { bookmark_timeline_v2: { timeline: { instructions: [{ entries: [
    entry(photo), entry(video), entry(gif), entry(text), entry(note), entry(restricted), entry({ __typename: 'TweetTombstone' })] }] } } } };

  const found = X.findTweets(timeline);
  assert.equal(found.length, 7);
  const posts = found.map(X.parseTweet).filter(Boolean);
  assert.deepEqual(posts.map((p) => p.code), ['111', '222', '223', '333', '444', '555']);

  const [p1, p2, p3, p4, p5, p6] = posts;
  assert.equal(p1.user, 'carol');
  assert.equal(p1.date, '2018-10-10');
  assert.equal(p1.link, 'https://x.com/carol/status/111');
  assert.equal(p1.caption, 'photo second');
  assert.deepEqual(p1.media, [
    { n: 1, url: 'https://pbs.twimg.com/media/AAA.png?name=orig', ext: 'png' },
    { n: 2, url: 'https://pbs.twimg.com/media/BBB.jpg?name=orig', ext: 'jpg' }]);
  assert.equal(p2.user, 'dave', 'legacy screen_name is the fallback');
  assert.deepEqual(p2.media, [{ n: 1, url: 'https://video.twimg.com/high.mp4', ext: 'mp4' }]);
  assert.deepEqual(p3.media, [{ n: 1, url: 'https://video.twimg.com/g.mp4', ext: 'mp4' }]);
  assert.deepEqual(p4.media, []);
  assert.equal(p5.caption, 'the long text');
  assert.equal(p6.user, 'gina');
  assert.equal(C.twitterDate('garbage'), '0000-00-00');
});

// ---- Functions injected into pages -----------------------------------------------------------
// Each is run in an empty context holding only a fake DOM: a reference to anything declared in the
// library (which would not exist in the page) fails with a ReferenceError.

function inPage(fn, sandbox) {
  return vm.runInNewContext('(' + fn.toString() + ')', sandbox);
}

const icon = (label, click) => ({
  getAttribute: () => label,
  closest: () => ({ click }),
  parentElement: { click }
});

test('page functions: Instagram save icon', () => {
  const clicks = [];
  const withIcons = (...labels) => ({ document: { querySelectorAll: () => labels.map((l) => icon(l, () => clicks.push(l))) } });

  assert.equal(inPage(IG.pageSaveState, withIcons('Kaydet', 'Beğen'))(), 'unsaved');
  assert.equal(inPage(IG.pageSaveState, withIcons('Save'))(), 'unsaved');
  assert.equal(inPage(IG.pageSaveState, withIcons('Kaldır', 'Yorum'))(), 'saved');
  assert.equal(inPage(IG.pageSaveState, withIcons('Remove'))(), 'saved');
  assert.equal(inPage(IG.pageSaveState, withIcons('Saved'))(), 'saved');
  assert.equal(inPage(IG.pageSaveState, withIcons('Kaydedilenler', 'Kaydet'))(), 'unsaved', 'the "Saved" profile tab is not the post toggle');
  assert.equal(inPage(IG.pageSaveState, withIcons('Beğen'))(), null);

  assert.equal(inPage(IG.pageClickUnsave, withIcons('Kaydet'))(), false);
  assert.equal(inPage(IG.pageClickUnsave, withIcons('Kaydedilenler', 'Kaldır'))(), true);
  assert.deepEqual(clicks, ['Kaldır']);
});

test('page function: Instagram feed fetch sends the session headers', async () => {
  const calls = [];
  const sandbox = {
    document: { cookie: 'a=1; csrftoken=TOKEN123; b=2' },
    encodeURIComponent,
    fetch: async (url, init) => { calls.push({ url, init }); return { status: 200, text: async () => '{}' }; }
  };
  const result = await inPage(IG.pageFetchSaved, sandbox)('QVFB=/x');
  assert.equal(result.status, 200);
  assert.equal(result.text, '{}');
  assert.equal(calls[0].url, '/api/v1/feed/saved/posts/?max_id=QVFB%3D%2Fx');
  assert.equal(calls[0].init.credentials, 'include');
  assert.equal(calls[0].init.headers['X-IG-App-ID'], '936619743392459');
  assert.equal(calls[0].init.headers['X-CSRFToken'], 'TOKEN123');
  await inPage(IG.pageFetchSaved, sandbox)(null);
  assert.equal(calls[1].url, '/api/v1/feed/saved/posts/');
  const broken = await inPage(IG.pageFetchSaved, { ...sandbox, fetch: async () => { throw new Error('offline'); } })(null);
  assert.equal(broken.status, 0);
  assert.equal(broken.text, '');
});

function article(statusIds, flags, clicks) {
  return {
    querySelectorAll: () => statusIds.map((id) => ({ getAttribute: () => '/user/status/' + id })),
    querySelector: (selector) => {
      const name = /"(\w+)"/.exec(selector)[1];
      return flags.includes(name) ? { click: () => clicks.push(name) } : null;
    }
  };
}

test('page functions: X reads and clicks only the post\'s own article', () => {
  const clicks = [];
  const page = (...articles) => ({ RegExp, Array, document: { querySelectorAll: () => articles } });
  const parent = article(['100'], ['removeBookmark'], clicks); // a bookmarked ancestor in the thread
  const own = article(['200', '200/analytics'], ['bookmark'], clicks);
  const ownBookmarked = article(['200'], ['removeBookmark'], clicks);

  assert.equal(inPage(X.pageXProbe, page(parent, own))('200'), 'plain', 'the parent\'s bookmark must not count');
  assert.equal(inPage(X.pageXProbe, page(parent, ownBookmarked))('200'), 'bookmarked');
  assert.equal(inPage(X.pageXClick, page(parent, own))('200'), false, 'nothing to remove: no click');
  assert.equal(inPage(X.pageXClick, page(parent, ownBookmarked))('200'), true);
  assert.deepEqual(clicks, ['removeBookmark']);

  assert.equal(inPage(X.pageXProbe, page(parent, own))('999'), null, 'no article of its own and more than one on the page');
  assert.equal(inPage(X.pageXClick, page(parent, ownBookmarked))('999'), false);
  assert.equal(inPage(X.pageXProbe, page(article(['abc'], ['removeBookmark'], clicks)))('999'), 'bookmarked', 'a lone article is the post');
  assert.equal(inPage(X.pageXProbe, page(article(['100'], ['bookmark'], clicks)))('1000'), 'plain', 'a lone article is the post');
  assert.equal(inPage(X.pageXProbe, page())('200'), null);
  assert.equal(inPage(X.pageXProbe, page(article(['2000'], ['removeBookmark'], clicks), article(['3'], [], clicks)))('200'), null, 'an id that only starts the same is not a match');
});

test('page function: X scroll', () => {
  const calls = [];
  const cell = { scrollIntoView: (o) => calls.push(['into', o.block]) };
  const sandbox = {
    Math,
    window: { innerHeight: 900, scrollBy: (x, y) => calls.push(['by', y]) },
    document: { querySelectorAll: () => [{ scrollIntoView() {} }, cell] }
  };
  assert.equal(inPage(X.pageXScroll, sandbox)(), 2);
  assert.deepEqual(calls, [['by', 2000], ['into', 'end']]);
});
