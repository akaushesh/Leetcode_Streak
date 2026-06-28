# LeetCode Current Streak — Chrome Extension

A **Manifest V3** Chrome extension that injects your **Current Streak** statistic directly into any LeetCode profile page.

LeetCode stopped showing the current streak publicly, but the data is available through their GraphQL API via `submissionCalendar`. This extension fetches that data and renders it in the existing stats row — matching the site's own typography and dark-mode colours perfectly.

---

## How it looks

```
Total active days: 354    Current streak: 42    Max streak: 91
```

The new element is inserted **between** "Total active days" and "Max streak" using the exact same CSS classes that LeetCode uses for its own stats.

---

## Files

```
Leetcode_Streak/
├── manifest.json       ← Manifest V3 extension descriptor
├── content.js          ← All extension logic (single file, no dependencies)
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## Loading the Extension (Unpacked)

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the **`Leetcode_Streak`** folder (the one containing `manifest.json`)
5. The extension is now active — visit any LeetCode profile page (e.g. `https://leetcode.com/<your-username>/`)

---

## Technical Details

### Streak Algorithm

```
submissionCalendar: { "unixTimestampSecs": count, ... }
```

1. Parse the JSON string.
2. Convert every timestamp to a **local-timezone** `YYYY-MM-DD` date.
3. Build a `Set` of dates that have ≥ 1 submission.
4. Anchor = **today** if today has a submission, else **yesterday**.
5. Walk backwards day-by-day from the anchor, counting consecutive present dates.
6. Stop at the first missing date.

This exactly replicates LeetCode's own streak calculation.

### Architecture

| Feature | Implementation |
|---|---|
| SPA navigation | `history.pushState` / `replaceState` patch + `popstate` listener |
| React re-render recovery | `MutationObserver` on the stats container |
| DOM presence detection | Body-level `MutationObserver` waiting for the stats row |
| Duplicate prevention | Sentinel CSS class `lc-current-streak` |
| Caching | In-memory `Map` with 5-minute TTL |
| Rapid navigation | `AbortController` cancels in-flight requests on navigation |
| Error state | Renders `—` instead of throwing |
| Dark mode | Uses LeetCode's own `dark:text-dark-label-*` Tailwind classes |

### Permissions

- **`host_permissions: ["https://leetcode.com/*"]`** — required to inject the content script and make same-origin GraphQL requests.
- No other permissions requested.

---

## Updating / Reloading

After any code change:
1. Go to `chrome://extensions/`
2. Click the **refresh icon** on the LeetCode Current Streak card.
3. Hard-refresh the LeetCode tab (`Cmd+Shift+R`).

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Streak doesn't appear | Check the browser console for errors; confirm you're on a profile URL (`/username/`) |
| Wrong streak value | The cache is valid for 5 minutes; wait or hard-refresh the tab |
| Element duplicated | Shouldn't happen — the sentinel class prevents it; report as a bug |
| GraphQL blocked | LeetCode occasionally changes API shape; check the Network tab for the response |
