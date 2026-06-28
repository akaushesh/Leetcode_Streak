/**
 * LeetCode Current Streak – content.js  (v1.2)
 *
 * Injects "Current streak: N" between "Max streak" and the "Current ▼"
 * dropdown inside the stats row on LeetCode profile pages.
 *
 * Exact target HTML (provided by user):
 *   <div class="flex items-center text-xs">          ← container
 *     <div class="mr-4.5 space-x-1">                 ← child[0]: Total active days
 *     <div class="space-x-1">                        ← child[1]: Max streak
 *     <div class="ml-[21px]">                        ← child[2]: "Current ▼" dropdown
 *   </div>
 *
 * We insert our element before child[2] (the dropdown).
 */

'use strict';

const LOG = (...a) => console.log('[LC-Streak]', ...a);
const ERR = (...a) => console.error('[LC-Streak]', ...a);

LOG('v1.2 loaded — href:', window.location.href);

/* ─── Constants ──────────────────────────────── */

const GRAPHQL_URL    = 'https://leetcode.com/graphql';
const SENTINEL_CLASS = 'lc-current-streak';
const CACHE_TTL_MS   = 5 * 60 * 1000;

const QUERY = `
  query GetSubmissionCalendar($username: String!) {
    matchedUser(username: $username) {
      userCalendar { submissionCalendar }
    }
  }
`;

/* ─── Cache & abort ──────────────────────────── */

/** @type {Map<string, {streak:number, expiresAt:number}>} */
const cache = new Map();
let activeController = null;

/* ─── Streak algorithm ───────────────────────── */

function tsToLocalDate(ts) {
  const d = new Date(ts * 1000);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}

function subtractDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() - n);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}

function computeStreak(calendarJson) {
  let raw;
  try { raw = JSON.parse(calendarJson); }
  catch (e) { ERR('JSON parse failed:', e); return 0; }

  const dates = new Set(Object.keys(raw).map(ts => tsToLocalDate(Number(ts))));
  LOG(`Calendar: ${Object.keys(raw).length} entries → ${dates.size} unique dates`);

  if (dates.size === 0) return 0;

  const today  = tsToLocalDate(Date.now() / 1000);
  const anchor = dates.has(today) ? today : subtractDays(today, 1);
  LOG(`Today: ${today} | Anchor: ${anchor} | Today has sub: ${dates.has(today)}`);

  if (!dates.has(anchor)) { LOG('Anchor missing → streak=0'); return 0; }

  let streak = 0, cursor = anchor;
  while (dates.has(cursor)) { streak++; cursor = subtractDays(cursor, 1); }

  LOG(`Streak: ${streak}`);
  return streak;
}

/* ─── GraphQL fetch ──────────────────────────── */

async function fetchStreak(username) {
  const key = username.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() < hit.expiresAt) {
    LOG(`Cache hit "${username}" → ${hit.streak}`);
    return hit.streak;
  }

  if (activeController) { LOG('Aborting prev request'); activeController.abort(); }
  activeController = new AbortController();

  LOG(`Fetching GraphQL for "${username}" …`);
  try {
    const resp = await fetch(GRAPHQL_URL, {
      method:      'POST',
      headers:     { 'Content-Type': 'application/json' },
      body:        JSON.stringify({ query: QUERY, variables: { username } }),
      signal:      activeController.signal,
      credentials: 'include',
    });
    LOG(`HTTP ${resp.status}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const data = await resp.json();
    LOG('Response data keys:', Object.keys(data?.data ?? {}));

    const calJson = data?.data?.matchedUser?.userCalendar?.submissionCalendar;
    if (!calJson) { ERR('submissionCalendar missing. Full response:', JSON.stringify(data)); throw new Error('no calJson'); }

    const streak = computeStreak(calJson);
    cache.set(key, { streak, expiresAt: Date.now() + CACHE_TTL_MS });
    return streak;
  } catch (err) {
    if (err.name === 'AbortError') { LOG('Fetch aborted'); return -1; }
    ERR('Fetch error:', err);
    return -1;
  }
}

/* ─── DOM: find the stats container ─────────── */

/**
 * Returns the `div.flex.items-center.text-xs` that holds:
 *   "Total active days" | "Max streak" | "Current ▼"
 *
 * Strategy: use the known class string first; fall back to text scan.
 */
function findStatsContainer() {
  // Primary: exact class match from the real DOM
  const byClass = document.querySelectorAll('div.flex.items-center.text-xs');
  for (const el of byClass) {
    const txt = el.textContent || '';
    if (txt.includes('active days') && txt.includes('Max streak')) {
      LOG('findStatsContainer → matched by class + text');
      return el;
    }
  }

  // Fallback: wider search restricted to small child counts
  const all = document.querySelectorAll('div');
  for (const el of all) {
    const n = el.children.length;
    if (n < 2 || n > 6) continue;
    const txt = el.textContent || '';
    if (txt.includes('active days') && txt.includes('Max streak')) {
      LOG('findStatsContainer → matched by fallback text scan, class:', el.className);
      return el;
    }
  }

  LOG('findStatsContainer → NOT FOUND');
  return null;
}

/**
 * Find the "Current ▼" dropdown child inside the container.
 * It is `div.ml-[21px]` in the real DOM.
 * We match by:  (a) class includes ml- , or (b) contains a <button>
 */
function findDropdownElement(container) {
  for (const child of container.children) {
    const cls = child.className || '';
    // The dropdown wrapper has ml-[21px] and contains a <button>
    if ((cls.includes('ml-') || child.querySelector('button')) &&
        !cls.includes('space-x')) {
      LOG('findDropdownElement → found, class:', cls);
      return child;
    }
  }
  LOG('findDropdownElement → NOT FOUND');
  return null;
}

/* ─── DOM: build & insert our element ───────── */

function buildNode(streak) {
  const wrap = document.createElement('div');
  // Match the class pattern of the "Max streak" sibling: "space-x-1"
  // plus mr-4.5 for right margin to match "Total active days" sibling
  // No margin on our div — the spacing comes from patching mr-4.5
  // onto the "Max streak" sibling (see patchMaxStreakSpacing below).
  wrap.className = `space-x-1 ${SENTINEL_CLASS}`;

  const label = document.createElement('span');
  label.className   = 'text-label-3 dark:text-dark-label-3';
  label.textContent = 'Current streak:';

  const val = document.createElement('span');
  val.className   = 'font-medium text-label-2 dark:text-dark-label-2';
  val.textContent = streak !== null ? String(streak) : '—';

  wrap.appendChild(label);
  wrap.appendChild(val);
  return wrap;
}

/**
 * Add mr-4.5 to the "Max streak" sibling so it pushes our element away,
 * matching the spacing that "Total active days" uses via its own mr-4.5.
 * Idempotent — only adds the class once.
 */
function patchMaxStreakSpacing(container) {
  for (const child of container.children) {
    const txt = (child.textContent || '').toLowerCase();
    if (txt.includes('max streak') && !child.classList.contains('mr-4.5')) {
      child.classList.add('mr-4.5');
      LOG('Patched mr-4.5 onto Max streak sibling');
      return;
    }
  }
}

/** Guard: stops our own insertion from re-triggering the MutationObserver */
let _inserting = false;

function upsertStreakElement(streak) {
  // Ensure Max streak has the right-margin before we insert next to it.
  const container = findStatsContainer();
  if (!container) { LOG('upsertStreakElement: container not ready'); return; }
  patchMaxStreakSpacing(container);

  // Update in-place if already present
  const existing = container.querySelector(`.${SENTINEL_CLASS}`);
  if (existing) {
    const v = existing.querySelector('span:last-child');
    const txt = streak !== null ? String(streak) : '—';
    if (v && v.textContent !== txt) { v.textContent = txt; LOG('Updated streak value →', txt); }
    return;
  }

  // Find the "Current ▼" dropdown to insert before it
  const dropdown = findDropdownElement(container);

  _inserting = true;
  try {
    if (dropdown) {
      container.insertBefore(buildNode(streak), dropdown);
      LOG('Inserted before dropdown ✓  streak=', streak);
    } else {
      // Last-resort: insert after the second child (Max streak)
      const secondChild = container.children[1];
      if (secondChild && secondChild.nextSibling) {
        container.insertBefore(buildNode(streak), secondChild.nextSibling);
        LOG('Inserted after child[1] ✓  streak=', streak);
      } else {
        container.appendChild(buildNode(streak));
        LOG('Appended at end ✓  streak=', streak);
      }
    }
  } finally {
    _inserting = false;
  }
}

/* ─── URL extraction ─────────────────────────── */

function getUsernameFromUrl() {
  const path = window.location.pathname;

  // /u/<username>/
  const m1 = path.match(/^\/u\/([^/]+)\/?$/);
  if (m1) { LOG('URL /u/<username> match:', m1[1]); return m1[1]; }

  // /<username>/  (legacy)
  const m2 = path.match(/^\/([^/]+)\/?$/);
  if (m2) {
    const seg = m2[1];
    const skip = new Set([
      'u','problemset','problems','contest','discuss','explore',
      'store','interview','assessment','progress','notifications',
      'graphql','accounts','subscribe','premium','company','tag',
    ]);
    if (!skip.has(seg.toLowerCase())) { LOG('URL /<username> match:', seg); return seg; }
  }

  return null;
}

/* ─── Render pipeline ────────────────────────── */

let currentUsername = null;
let statsObserver   = null;

async function renderStreak(username) {
  LOG(`renderStreak("${username}") start`);
  upsertStreakElement(null);                     // show — immediately

  const streak = await fetchStreak(username);
  if (streak === -1) { LOG('Fetch aborted — skip DOM update'); return; }

  upsertStreakElement(streak >= 0 ? streak : null);
  LOG(`renderStreak("${username}") done → ${streak}`);
}

async function tryRender() {
  const username = getUsernameFromUrl();
  if (!username) return;

  const container = findStatsContainer();
  if (!container) { LOG('tryRender: container not in DOM yet'); return; }

  watchStatsContainer(container);

  if (username === currentUsername) {
    LOG(`Same username "${username}" — refreshing`);
    const hit = cache.get(username.toLowerCase());
    upsertStreakElement(hit ? hit.streak : null);
    if (!hit || Date.now() >= hit.expiresAt) {
      const s = await fetchStreak(username);
      if (s !== -1) upsertStreakElement(s >= 0 ? s : null);
    }
    return;
  }

  LOG(`New username: "${username}"`);
  currentUsername = username;
  await renderStreak(username);
}

/* ─── MutationObserver: container watcher ────── */

function watchStatsContainer(container) {
  if (statsObserver) statsObserver.disconnect();

  statsObserver = new MutationObserver(() => {
    if (_inserting) return;                       // our own mutation — ignore
    LOG('Container mutated by React — restoring element');
    const hit = cache.get((currentUsername || '').toLowerCase());
    upsertStreakElement(hit ? hit.streak : null);
  });

  statsObserver.observe(container, { childList: true, subtree: false });
}


/* ─── Bootstrap: run on page load ───────────── */

/**
 * Wait for the stats container to appear, then render the streak.
 * LeetCode is a React app so the stats row may not exist immediately
 * after DOMContentLoaded — we poll for it (max 10 attempts, 500 ms apart).
 */
function waitAndRender() {
  const username = getUsernameFromUrl();
  if (!username) {
    LOG('Not a profile page — nothing to do');
    return;
  }

  LOG(`Profile page detected for "${username}" — waiting for stats row…`);

  let attempts = 0;
  const MAX    = 20;        // 20 × 500 ms = 10 seconds max wait
  const DELAY  = 500;       // ms between retries

  const poll = setInterval(() => {
    attempts++;
    const container = findStatsContainer();

    if (container) {
      clearInterval(poll);
      LOG(`Stats container found after ${attempts} attempt(s) ✓`);
      currentUsername = username;
      watchStatsContainer(container);   // guard against React re-renders
      renderStreak(username);
      return;
    }

    if (attempts >= MAX) {
      clearInterval(poll);
      LOG(`Stats container not found after ${MAX} attempts — giving up`);
    }
  }, DELAY);
}

// Run as soon as the page (and its scripts) have finished loading.
window.addEventListener('load', () => {
  LOG('window.load fired');
  waitAndRender();
});

