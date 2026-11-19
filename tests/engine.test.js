'use strict';

/* Runs the service worker's scripts against a fake `chrome` and fake Instagram / X pages:
 * node --test tests/
 *
 * The fake clock advances by the length of every timer that fires, so the engine's real delays
 * (2-5 s between requests, 20 s page waits) cost no test time. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const EXT = path.join(__dirname, '..', 'extension');
const TAKEN = Date.UTC(2026, 0, 2, 12, 0, 0) / 1000;

function makeWorld() {
  let virtual = 0;
  const BASE = Date.now();
  class FakeDate extends Date {
    static now() { return BASE + virtual; }
  }
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const updated = new Set();
  const removed = new Set();
  let nextId = 1;
  let nextBlob = 1;

  const world = {
    store: {},
    downloads: [],
    blobs: new Map(),
    tabs: new Map(),
    vanished: new Set(), // download ids whose file the user deleted
    handlers: {}, // page function name -> fake page behaviour
    messageListeners: [],
    offscreenOpen: false
  };

  function navigateTab(id, url) {
    if (!world.tabs.has(id)) return Promise.reject(new Error('No tab with id: ' + id));
    world.tabs.set(id, url);
    setTimeout(() => {
      for (const f of [...updated]) f(id, { status: 'loading' });
      for (const f of [...updated]) f(id, { status: 'complete' });
    }, 0);
    return Promise.resolve({ id, url });
  }

  const chrome = {
    storage: {
      local: {
        async get(keys) {
          if (keys === null || keys === undefined) return clone(world.store);
          const out = {};
          for (const k of [].concat(keys)) if (k in world.store) out[k] = clone(world.store[k]);
          return out;
        },
        async set(obj) {
          for (const [k, v] of Object.entries(obj)) world.store[k] = clone(v);
        },
        async remove(keys) {
          for (const k of [].concat(keys)) delete world.store[k];
        }
      }
    },
    downloads: {
      async download(o) {
        if (world.failDownload && world.failDownload(o)) throw new Error('NETWORK_FAILED');
        const id = nextId++;
        let filename = o.filename;
        const taken = world.downloads.some((d) => d.filename === filename);
        if (taken && o.conflictAction === 'uniquify') filename = filename.replace(/(\.[^.]+)$/, ' (1)$1');
        if (taken && o.conflictAction === 'overwrite') world.downloads = world.downloads.filter((d) => d.filename !== filename);
        world.downloads.push({ id, filename, requested: o.filename, url: o.url, conflict: o.conflictAction, saveAs: o.saveAs });
        return id;
      },
      async search({ id }) {
        const d = world.downloads.find((x) => x.id === id);
        if (!d) return [];
        return [{
          id, state: 'complete', filename: 'C:\\Users\\me\\Downloads\\' + d.filename.replace(/\//g, '\\'),
          fileSize: 1234, bytesReceived: 1234, exists: !world.vanished.has(id)
        }];
      },
      async cancel() {}
    },
    runtime: {
      onMessage: { addListener: (f) => world.messageListeners.push(f) },
      async getContexts() { return world.offscreenOpen ? [{}] : []; },
      async getPlatformInfo() { return {}; },
      async sendMessage(m) {
        if (m.type === 'blob:create') {
          const url = 'blob:fake/' + nextBlob++;
          world.blobs.set(url, m.text);
          return { url };
        }
        if (m.type === 'blob:revoke') return { ok: true };
        throw new Error('unexpected message ' + m.type);
      }
    },
    offscreen: {
      async createDocument() { world.offscreenOpen = true; },
      async closeDocument() { world.offscreenOpen = false; }
    },
    tabs: {
      async get(id) {
        if (!world.tabs.has(id)) throw new Error('No tab with id: ' + id);
        return { id, url: world.tabs.get(id) };
      },
      update: (id, props) => navigateTab(id, props.url),
      reload: (id) => navigateTab(id, world.tabs.get(id)),
      onUpdated: { addListener: (f) => updated.add(f), removeListener: (f) => updated.delete(f) },
      onRemoved: { addListener: (f) => removed.add(f), removeListener: (f) => removed.delete(f) }
    },
    scripting: {
      async executeScript({ target, func, args }) {
        const handler = world.handlers[func.name];
        if (!handler) throw new Error('no fake page behaviour for ' + func.name);
        return [{ result: await handler(target.tabId, ...(args || [])) }];
      }
    }
  };

  const sandbox = {
    chrome,
    console,
    URL,
    importScripts: () => {}, // the libraries are loaded below
    setTimeout: (fn, ms, ...rest) => setTimeout(() => { virtual += ms || 0; fn(...rest); }, 0),
    clearTimeout,
    setInterval,
    clearInterval,
    Date: FakeDate
  };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  for (const file of ['lib/common.js', 'lib/instagram.js', 'lib/xparse.js', 'lib/engine.js', 'background.js']) {
    vm.runInContext(fs.readFileSync(path.join(EXT, file), 'utf8'), sandbox, { filename: file });
  }
  world.SA = sandbox.SA;
  return world;
}

async function finished(world, ms = 30000) {
  const end = Date.now() + ms;
  for (;;) {
    const job = world.store.job;
    if (job && job.status !== 'running') return job;
    if (Date.now() > end) throw new Error('job did not finish: ' + JSON.stringify(world.store.job));
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

async function runJob(world, request) {
  const started = await world.SA.engine.start(request);
  if (!started.ok) return { started };
  return { started, job: await finished(world) };
}

const recordKeys = (world, prefix) => Object.keys(world.store).filter((k) => k.startsWith(prefix)).sort();
const lastDownloadId = (world) => Math.max(0, ...world.downloads.map((d) => d.id));
const csvOf = (world, suffix) => world.blobs.get(world.downloads.find((d) => d.requested.endsWith(suffix)).url);

// ---- Instagram -------------------------------------------------------------------------------

const image = (url) => ({ image_versions2: { candidates: [{ url, width: 1000, height: 1000 }] } });
const igItem = (code, user, parts) => ({
  media: Object.assign({ code, taken_at: TAKEN, user: { username: user }, caption: { text: 'caption of ' + code } },
    parts.length > 1 ? { carousel_media: parts } : parts[0])
});

function igWorld() {
  const world = makeWorld();
  world.tabs.set(1, 'https://www.instagram.com/');
  world.pages = {
    first: {
      items: [
        igItem('AAA', 'alice', [image('https://scontent.cdninstagram.com/a1.jpg'), image('https://scontent.cdninstagram.com/a2.jpg')]),
        igItem('BBB', 'bob', [{ video_versions: [{ url: 'https://instagram.fist1-1.fna.fbcdn.net/b.mp4' }] }])
      ],
      more_available: true,
      next_max_id: 'M2'
    },
    M2: { items: [igItem('CCC', 'cara', [image('https://scontent.cdninstagram.com/c.jpg')])], more_available: false }
  };
  world.saved = new Set(['AAA', 'BBB', 'CCC']);
  const codeOf = (url) => (/\/p\/([^/]+)\//.exec(url) || [])[1];
  world.handlers.pageFetchSaved = async (tabId, maxId) => ({ status: 200, text: JSON.stringify(world.pages[maxId || 'first']) });
  world.handlers.pageSaveState = async (tabId) => (world.saved.has(codeOf(world.tabs.get(tabId))) ? 'saved' : 'unsaved');
  world.handlers.pageClickUnsave = async (tabId) => {
    world.saved.delete(codeOf(world.tabs.get(tabId)));
    return true;
  };
  return world;
}

test('Instagram download saves every file, writes the index and resumes without repeating', async () => {
  const world = igWorld();
  const { job } = await runJob(world, { kind: 'download', site: 'instagram', tabId: 1 });
  assert.equal(job.status, 'done', JSON.stringify(job));
  assert.equal(job.counters.files, 4);
  assert.equal(job.summary.k, 'sumDownload');

  const date = world.SA.localDate(TAKEN);
  const media = world.downloads.filter((d) => !d.requested.endsWith('.csv'));
  assert.deepEqual(media.map((d) => d.requested), [
    `instagram-x-saved/instagram/${date}_alice_AAA_01.jpg`,
    `instagram-x-saved/instagram/${date}_alice_AAA_02.jpg`,
    `instagram-x-saved/instagram/${date}_bob_BBB_01.mp4`,
    `instagram-x-saved/instagram/${date}_cara_CCC_01.jpg`
  ]);
  assert.ok(media.every((d) => d.conflict === 'uniquify' && d.saveAs === false), 'media never overwrites');

  const index = world.downloads.find((d) => d.requested === 'instagram-x-saved/instagram/posts.csv');
  assert.equal(index.conflict, 'overwrite');
  const csv = world.blobs.get(index.url);
  assert.equal(csv.split('\r\n').filter(Boolean).length, 4, 'header and three posts');
  assert.ok(csv.includes(`${date}_alice_AAA_01.jpg | ${date}_alice_AAA_02.jpg`));

  assert.deepEqual(world.store['ig:AAA'].need, [1, 2]);
  assert.ok(world.store['ig:AAA'].files.every((f) => f.ok && typeof f.id === 'number'));
  assert.equal(typeof world.store.meta.csvAt.instagram, 'number');
  assert.equal(world.offscreenOpen, false, 'the offscreen document is closed afterwards');

  const before = lastDownloadId(world);
  const second = await runJob(world, { kind: 'download', site: 'instagram', tabId: 1 });
  assert.equal(second.job.counters.skipped, 4);
  assert.equal(second.job.counters.files, 0);
  assert.deepEqual(world.downloads.filter((d) => d.id > before).map((d) => d.requested), ['instagram-x-saved/instagram/posts.csv']);
});

test('"First N" limits the posts handled', async () => {
  const world = igWorld();
  const { job } = await runJob(world, { kind: 'download', site: 'instagram', tabId: 1, limit: '1' });
  assert.equal(job.status, 'done');
  assert.equal(job.counters.processed, 1);
  assert.deepEqual(recordKeys(world, 'ig:'), ['ig:AAA']);
});

test('Instagram clean needs the confirmation and leaves incomplete posts alone', async () => {
  const world = igWorld();
  await runJob(world, { kind: 'download', site: 'instagram', tabId: 1 });

  const refused = await runJob(world, { kind: 'clean', site: 'instagram', tabId: 1 });
  assert.equal(refused.started.ok, false);
  assert.equal(refused.started.error, 'errUnexpected');
  assert.equal(world.saved.size, 3);

  world.store['ig:CCC'].files = []; // its file is not recorded as saved
  const { job } = await runJob(world, { kind: 'clean', site: 'instagram', tabId: 1, confirmed: true });
  assert.equal(job.status, 'done', JSON.stringify(job));
  assert.deepEqual(world.saved, new Set(['CCC']));
  assert.equal(world.store['ig:AAA'].cleaned, true);
  assert.equal(world.store['ig:BBB'].cleaned, true);
  assert.equal(world.store['ig:CCC'].cleaned, false);
  assert.equal(job.counters.cleaned, 2);
  assert.equal(job.summary.k, 'sumClean');
});

test('"First N" limits cleaning', async () => {
  const world = igWorld();
  await runJob(world, { kind: 'download', site: 'instagram', tabId: 1 });
  const { job } = await runJob(world, { kind: 'clean', site: 'instagram', tabId: 1, confirmed: true, limit: 1 });
  assert.equal(job.counters.cleaned, 1);
  assert.equal(world.saved.size, 2);
  assert.deepEqual(job.summary.a, ['1', '0', '2'], 'one cleaned, none failed, two still waiting');
});

test('a post whose file the user deleted is not cleaned', async () => {
  const world = igWorld();
  await runJob(world, { kind: 'download', site: 'instagram', tabId: 1 });
  world.vanished.add(world.store['ig:AAA'].files[0].id);
  const { job } = await runJob(world, { kind: 'clean', site: 'instagram', tabId: 1, confirmed: true });
  assert.deepEqual(world.saved, new Set(['AAA']));
  assert.ok(job.log.some((e) => e.k === 'logUnverified' && e.a[0] === '1'));
});

test('a download run repairs a post whose file was deleted', async () => {
  const world = igWorld();
  await runJob(world, { kind: 'download', site: 'instagram', tabId: 1 });
  world.vanished.add(world.store['ig:BBB'].files[0].id);
  const { job } = await runJob(world, { kind: 'download', site: 'instagram', tabId: 1 });
  assert.equal(job.counters.files, 1);
  assert.equal(job.counters.skipped, 3);
});

test('three failures in a row stop a clean job and mark nothing cleaned', async () => {
  const world = igWorld();
  await runJob(world, { kind: 'download', site: 'instagram', tabId: 1 });
  world.handlers.pageSaveState = async () => null; // the save icon never appears
  const { job } = await runJob(world, { kind: 'clean', site: 'instagram', tabId: 1, confirmed: true });
  assert.equal(job.status, 'error');
  assert.equal(job.error.k, 'errThreeInRow');
  assert.equal(job.counters.failed, 3);
  assert.ok(recordKeys(world, 'ig:').every((k) => !world.store[k].cleaned));
  assert.equal(world.saved.size, 3);
});

test('a click that the page does not confirm counts as a failure', async () => {
  const world = igWorld();
  await runJob(world, { kind: 'download', site: 'instagram', tabId: 1 });
  world.handlers.pageClickUnsave = async () => true; // the click does nothing
  const { job } = await runJob(world, { kind: 'clean', site: 'instagram', tabId: 1, confirmed: true, limit: 1 });
  assert.equal(job.counters.failed, 1);
  assert.equal(job.counters.cleaned, 0);
  assert.ok(recordKeys(world, 'ig:').every((k) => !world.store[k].cleaned));
});

test('a failed download is retried', async () => {
  const world = igWorld();
  let failures = 1;
  world.failDownload = (o) => !o.filename.endsWith('.csv') && failures-- > 0;
  const { job } = await runJob(world, { kind: 'download', site: 'instagram', tabId: 1 });
  assert.equal(job.status, 'done');
  assert.equal(job.counters.files, 4);
  assert.equal(job.counters.failed, 0);
});

test('three download failures in a row stop the job; the index still lists what is known', async () => {
  const world = igWorld();
  world.failDownload = (o) => !o.filename.endsWith('.csv');
  const { job } = await runJob(world, { kind: 'download', site: 'instagram', tabId: 1 });
  assert.equal(job.status, 'error');
  assert.equal(job.error.k, 'errThreeInRow');
  assert.equal(job.counters.failed, 3);
  assert.deepEqual(world.downloads.map((d) => d.requested), ['instagram-x-saved/instagram/posts.csv']);
  assert.deepEqual(world.store['ig:AAA'].files, []);
  assert.equal((await runJob(world, { kind: 'clean', site: 'instagram', tabId: 1, confirmed: true })).job.error.k,
    'errNothingToClean', 'nothing is complete, so nothing may be cleaned');
});

test('a tab on the wrong site is refused', async () => {
  const world = igWorld();
  world.tabs.set(1, 'https://example.com/');
  const { started } = await runJob(world, { kind: 'download', site: 'instagram', tabId: 1 });
  assert.equal(started.error, 'errWrongSite');
  assert.equal((await runJob(world, { kind: 'download', site: 'instagram', tabId: 7 })).started.error, 'errTabClosed');
});

test('a login wall and rate limiting are reported', async () => {
  const world = igWorld();
  world.handlers.pageFetchSaved = async () => ({ status: 401, text: '{"message":"login_required"}' });
  assert.equal((await runJob(world, { kind: 'download', site: 'instagram', tabId: 1 })).job.error.k, 'errLogin');
  world.handlers.pageFetchSaved = async () => ({ status: 429, text: '' });
  assert.equal((await runJob(world, { kind: 'download', site: 'instagram', tabId: 1 })).job.error.k, 'errRateLimit');
  world.handlers.pageFetchSaved = async () => ({ status: 500, text: '' });
  const failed = (await runJob(world, { kind: 'download', site: 'instagram', tabId: 1 })).job;
  assert.deepEqual(failed.error, { k: 'errListRead', a: ['500'] });
  assert.equal(world.downloads.length, 0, 'nothing known, so no empty index');
});

test('Stop ends the job after the current step and still writes the index', async () => {
  const world = igWorld();
  const original = world.handlers.pageFetchSaved;
  let calls = 0;
  world.handlers.pageFetchSaved = async (tabId, maxId) => {
    if (++calls === 2) world.SA.engine.stop();
    return original(tabId, maxId);
  };
  const { job } = await runJob(world, { kind: 'download', site: 'instagram', tabId: 1 });
  assert.equal(job.status, 'stopped');
  assert.deepEqual(recordKeys(world, 'ig:'), ['ig:AAA', 'ig:BBB']);
  assert.ok(csvOf(world, '/posts.csv').includes('_AAA_01.jpg'));
});

// ---- X ---------------------------------------------------------------------------------------

const xPost = (code, user, media, caption) => ({
  site: 'x', code, user, date: '2026-01-02', link: `https://x.com/${user}/status/${code}`, caption, media
});

function xWorld(extraBatch) {
  const world = makeWorld();
  world.tabs.set(2, 'https://x.com/home');
  world.bookmarked = new Set(['111', '222', '333']);
  const batches = [
    [xPost('111', 'carol', [{ n: 1, url: 'https://pbs.twimg.com/media/AAA.jpg?name=orig', ext: 'jpg' }], 'photo'),
      xPost('333', 'erin', [], 'just text')],
    [xPost('222', 'dave', [{ n: 1, url: 'https://video.twimg.com/high.mp4', ext: 'mp4' }], 'video')].concat(extraBatch || [])
  ];
  let scrolls = 0;
  world.handlers.pageXScroll = async (tabId) => {
    const batch = batches[scrolls++];
    if (batch) world.SA.engine.onCaptured({ operation: 'Bookmarks', tweets: batch }, { tab: { id: tabId } });
    if (scrolls === 2) {
      // Data that must be ignored: another tab, and an id that is not numeric.
      world.SA.engine.onCaptured({ operation: 'Bookmarks', tweets: [xPost('999', 'zed', [], 'x')] }, { tab: { id: 77 } });
      world.SA.engine.onCaptured({ operation: 'Bookmarks', tweets: [xPost('abc', 'zed', [], 'x')] }, { tab: { id: tabId } });
    }
    return scrolls;
  };
  world.handlers.pageXProbe = async (tabId, id) => (world.bookmarked.has(id) ? 'bookmarked' : 'plain');
  world.handlers.pageXClick = async (tabId, id) => {
    world.bookmarked.delete(id);
    return true;
  };
  return world;
}

test('X download scans the bookmarks, keeps text-only posts and writes the index', async () => {
  const world = xWorld();
  const { job } = await runJob(world, { kind: 'download', site: 'x', tabId: 2, url: 'https://x.com/i/bookmarks' });
  assert.equal(job.status, 'done', JSON.stringify(job));
  assert.equal(world.tabs.get(2), 'https://x.com/i/bookmarks');
  assert.deepEqual(world.downloads.filter((d) => !d.requested.endsWith('.csv')).map((d) => d.requested), [
    'instagram-x-saved/x/2026-01-02_carol_111_01.jpg',
    'instagram-x-saved/x/2026-01-02_dave_222_01.mp4'
  ]);
  assert.deepEqual(recordKeys(world, 'x:'), ['x:111', 'x:222', 'x:333']);
  assert.ok(csvOf(world, '/x/posts.csv').includes('2026-01-02,erin,https://x.com/erin/status/333,,just text'));
  assert.equal(world.store['x:333'].need.length, 0);
});

test('X download: only the first N bookmarks are kept', async () => {
  const world = xWorld();
  const { job } = await runJob(world, { kind: 'download', site: 'x', tabId: 2, url: 'https://x.com/i/bookmarks', limit: 1 });
  assert.equal(job.status, 'done');
  assert.deepEqual(recordKeys(world, 'x:'), ['x:111']);
});

test('X download refuses addresses outside x.com and downloads only from twimg', async () => {
  const world = xWorld([xPost('444', 'mal', [{ n: 1, url: 'https://evil.example/a.jpg', ext: 'jpg' }], 'hostile')]);
  assert.equal((await runJob(world, { kind: 'download', site: 'x', tabId: 2, url: 'https://evil.example/i/bookmarks' })).started.error, 'errBadUrl');
  assert.equal((await runJob(world, { kind: 'download', site: 'x', tabId: 2, url: 'http://x.com/i/bookmarks' })).started.error, 'errBadUrl');
  const { job } = await runJob(world, { kind: 'download', site: 'x', tabId: 2, url: 'https://x.com/i/history' });
  assert.equal(world.tabs.get(2), 'https://x.com/i/history');
  assert.equal(job.counters.failed, 1);
  assert.ok(!world.downloads.some((d) => d.url.includes('evil.example')));
  assert.deepEqual(world.store['x:444'].files, []);
});

test('X clean removes bookmarks; a text-only post waits for its index', async () => {
  const world = xWorld();
  await runJob(world, { kind: 'download', site: 'x', tabId: 2, url: 'https://x.com/i/bookmarks' });

  const csvAt = world.store.meta.csvAt.x;
  world.store.meta.csvAt.x = 1; // pretend the index is older than the posts
  const first = await runJob(world, { kind: 'clean', site: 'x', tabId: 2, confirmed: true });
  assert.equal(first.job.status, 'done', JSON.stringify(first.job));
  assert.deepEqual(world.bookmarked, new Set(['333']), 'the text-only bookmark is kept until its index is written');

  world.store.meta.csvAt.x = csvAt;
  const second = await runJob(world, { kind: 'clean', site: 'x', tabId: 2, confirmed: true });
  assert.equal(second.job.counters.cleaned, 1);
  assert.equal(world.bookmarked.size, 0);
  assert.equal(world.tabs.get(2), 'https://x.com/i/status/333');
});

test('X clean without confirmation does nothing', async () => {
  const world = xWorld();
  await runJob(world, { kind: 'download', site: 'x', tabId: 2, url: 'https://x.com/i/bookmarks' });
  assert.equal((await runJob(world, { kind: 'clean', site: 'x', tabId: 2 })).started.ok, false);
  assert.equal(world.bookmarked.size, 3);
});

test('X scan that captures nothing reports it', async () => {
  const world = xWorld();
  world.handlers.pageXScroll = async () => 0;
  const { job } = await runJob(world, { kind: 'download', site: 'x', tabId: 2, url: 'https://x.com/i/bookmarks' });
  assert.equal(job.error.k, 'errNoBookmarks');
  assert.ok(job.log.some((e) => e.k === 'logOps'));
});

// ---- Export, reset, recovery, message routing ------------------------------------------------

test('NotebookLM export writes one Markdown file per site that has records', async () => {
  const world = igWorld();
  await runJob(world, { kind: 'download', site: 'instagram', tabId: 1 });
  const { job } = await runJob(world, { kind: 'export' });
  assert.equal(job.status, 'done', JSON.stringify(job));
  const files = world.downloads.filter((d) => d.requested.startsWith('instagram-x-saved/notebooklm/'));
  assert.deepEqual(files.map((d) => d.requested), ['instagram-x-saved/notebooklm/instagram_saved_posts.md']);
  const text = world.blobs.get(files[0].url);
  assert.ok(text.startsWith('# Saved posts archive: instagram\n\n## @'));
  assert.ok(text.includes('caption of AAA'));
  assert.deepEqual(job.summary, { k: 'sumExport', a: ['1', '3'] });

  const empty = await runJob(makeWorld(), { kind: 'export' });
  assert.equal(empty.job.error.k, 'errNothingToExport');
});

test('reset forgets records and the job but keeps the settings', async () => {
  const world = igWorld();
  world.store.settings = { limit: '5' };
  await runJob(world, { kind: 'download', site: 'instagram', tabId: 1 });
  assert.equal((await world.SA.engine.reset()).ok, true);
  assert.deepEqual(Object.keys(world.store), ['settings']);
});

test('a job left running by a killed worker is marked interrupted', async () => {
  const world = makeWorld();
  world.store.job = { status: 'running', counters: {} };
  await world.SA.engine.recoverStaleJob();
  assert.equal(world.store.job.status, 'interrupted');
});

test('the service worker routes popup and page messages', async () => {
  const world = makeWorld();
  const [listener] = world.messageListeners;
  const call = (message, sender = {}) => new Promise((resolve) => {
    let replied = false;
    const keepOpen = listener(message, sender, (reply) => {
      replied = true;
      resolve(reply);
    });
    if (!keepOpen && !replied) resolve(undefined);
  });
  assert.equal((await call({ type: 'stop' })).ok, true);
  assert.equal(await call({ type: 'x:captured', tweets: [] }), undefined);
  assert.equal(await call({ target: 'offscreen', type: 'blob:create' }), undefined);
  assert.equal(await call({ type: 'unknown' }), undefined);
  assert.equal((await call({ type: 'start', kind: 'nonsense' })).error, 'errUnexpected');
  assert.equal((await call({ type: 'reset' })).ok, true);
});
