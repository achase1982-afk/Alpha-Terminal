# Chat state lifecycle audit — alpha-terminal frontend (read-only)

**Date:** 2026-05-21  
**Scope:** Static trace of `MarketNewsChatPanel` state lifecycle, unmount/remount behavior, re-hydration from `GET /api/chat/threads` and `/messages`, and explicit clearing logic. **No application source changes** in this audit.

**Symptom (reported):** Chat session disappears from the UI when navigating away from Chat and returning; backend persists threads (runtime logs show `GET /api/chat/threads?symbol=…` and `GET /api/chat/threads/<id>/messages` returning 200). Defect is attributed to frontend state lifecycle, not backend storage.

**Path convention:** File references use paths under `artifacts/alpha-terminal/` unless noted.

---

## Executive summary

| Finding | Severity |
|--------|----------|
| `MarketNewsChatPanel` is **conditionally mounted** (`contextTab === "newsChat"`). Leaving the Chat tab **unmounts** the component and **destroys** all chat UI state held in `useState`. | Root cause |
| **`activeThreadId` is never persisted** (not in Zustand, `sessionStorage`, or `localStorage`). On remount it is always `null` until the user selects a thread or a new SSE assigns one. | Root cause |
| A **`useEffect` on `symU` runs on every mount** and explicitly calls `setActiveThreadId(null)` and `setMessages([])`, so even a hypothetical preserved ID would be cleared when the panel remounts. | Root cause |
| **No auto-restore** of the last active thread: `refreshThreads()` loads the thread list, but nothing sets `activeThreadId` from server data on mount. Messages load only when `activeThreadId` is non-null. | Root cause |
| Zustand **`marketNewsChatBySymbol`** (persisted via `partialize`) and related actions exist in `store.ts` but are **unused** by `MarketNewsChatPanel` — a prior or parallel persistence design that the current UI does not read or write. | Architectural gap |

**Conclusion:** The session “disappears” because the visible conversation lives entirely in component-local state that is wiped on unmount, and remount deliberately resets `activeThreadId` and `messages` without re-selecting a thread or re-fetching messages. Backend data remains available; the UI shows the empty-state placeholder until the user opens the threads menu and picks a chat (or starts a new one).

---

## Phase 1 — Component map and state ownership

### 1.1 Chat component and mount points

| Item | Location |
|------|----------|
| **Component** | `MarketNewsChatPanel` — `artifacts/alpha-terminal/src/components/MarketNewsChatPanel.tsx` (exported at line 103) |
| **Parent page** | `TerminalPage` — `artifacts/alpha-terminal/src/pages/Terminal.tsx` |
| **Route** | Single-page app: `App.tsx` routes `/` → `TerminalPage` (no dedicated chat route) |

**Mount rule (all layouts):** Chat renders only when the user is on the **Markets** bottom tab **and** the markets **context** tab is **`newsChat`**:

```651:651:artifacts/alpha-terminal/src/pages/Terminal.tsx
                  {contextTab === "newsChat" && <MarketNewsChatPanel />}
```

Equivalent conditional mounts appear at lines **708** (desktop three-panel right rail) and **751** (tablet/desktop non–three-panel markets column).

**Tab chrome:**

- Mobile / non–three-panel: `MarketDataTabs` — `artifacts/alpha-terminal/src/components/MarketDataTabs.tsx` (`newsChat` label: "CHAT").
- Desktop three-panel right rail: `DesktopContextTabs` in `Terminal.tsx` (lines 57–62, 696).

### 1.2 Does navigation away unmount chat?

**Yes**, in these cases:

| Navigation | `MarketNewsChatPanel` mounted? | `contextTab` / `activeBottom` preserved? |
|------------|--------------------------------|------------------------------------------|
| Markets → another context tab (News, Options, Company, Chart) | **No** — unmounts | `contextTab` stays in `Terminal.tsx` `useState` (line 146); user can return to Chat tab name |
| Markets → another bottom tab (AI, Portfolio, Watchlist, Search) | **No** — entire markets subtree unmounts | `activeBottom` persisted to `sessionStorage` key `alpha_session_tab` (lines 139–145, 415–417); **`contextTab` is not persisted** |
| Symbol change while chat mounted | Stays mounted; symbol-driven effect runs | N/A |

`contextTab` defaults to `"news"` (line 146) and is **not** written to `sessionStorage` (unlike `activeBottom` and `aiSubTab`). Returning to Markets after a bottom-nav switch therefore often lands on **News**, not Chat, even though the user may have been in Chat before.

### 1.3 Where state lives

#### Component-local (`useState` in `MarketNewsChatPanel.tsx`)

| State | Lines | Role |
|-------|-------|------|
| `threads` | 140 | Server thread list for current symbol |
| `activeThreadId` | 141 | **Required** to call `loadThreadMessages` |
| `messages` | 142 | Rendered transcript |
| `toolPills`, `input`, `isStreaming`, `composerFocused`, `threadsMenuOpen`, `lastFailedMessage` | 143–148 | UI / streaming |
| `useMultiAgent`, `multiAgentModels`, `synthesizerModel`, etc. | 111–137 | Multi-agent UI |

**Symbol** and **chat model** come from Zustand (`useTerminalStore`): `symbol` (line 104), `aiFeatureSettings.chat.model` (lines 105–106).

#### `sessionStorage` (survives panel unmount; not thread/messages)

| Key | Lines | Content |
|-----|-------|---------|
| `marketNewsChatMultiModels` | 22, 113–125, 202–208 | Multi-agent model IDs |
| `marketNewsChatSynthesizerModel` | 23, 127–135, 211–217 | Synthesizer model |

#### Zustand store (`artifacts/alpha-terminal/src/lib/store.ts`)

| Field / API | Lines | Used by `MarketNewsChatPanel`? |
|-------------|-------|-------------------------------|
| `marketNewsChatBySymbol` + `marketNewsChat*` actions | 330–337, 687–840 | **No** — no imports or calls in the panel |
| `chatHistory`, `addChatMessage`, `clearChat` | 325–327, 683–685 | **No** — legacy; no references elsewhere in alpha-terminal |
| `aiFeatureSettings.chat` | persisted in `partialize` | **Yes** — model selection only |

`marketNewsChatBySymbol` **is included** in Zustand `partialize` (lines 1362–1374: `...rest` includes it), so it can persist to `localStorage` under `alpha-terminal-storage`, but the live chat UI never reads or updates it.

#### Context / React Query

No React Context for chat. No TanStack Query hooks for threads/messages in the panel — only manual `fetchWithAuth` in `refreshThreads` and `loadThreadMessages`.

---

## Phase 2 — Unmount and remount behavior

### 2.1 On unmount (leave Chat tab or leave Markets)

When `contextTab !== "newsChat"` or `activeBottom !== "markets"`:

- React **destroys** the `MarketNewsChatPanel` instance.
- All `useState` values are discarded, including **`activeThreadId`** and **`messages`**.
- In-flight `fetch` / SSE: `sendMessage` uses `AbortController` in `abortRef` (lines 150, 271–273, 384–388), but there is **no `useEffect` cleanup** on unmount to abort. A stream started before unmount may continue until completion in the background; UI state to display results is gone after remount.

Refs (`abortRef`, `scrollRef`, `textareaRef`) are also discarded.

### 2.2 On remount (return to Chat tab)

Fresh mount initializes:

- `activeThreadId = null`
- `messages = []`
- `threads = []` (until `refreshThreads` completes)

**Lifecycle sequence:**

```mermaid
sequenceDiagram
  participant User
  participant Terminal
  participant Panel as MarketNewsChatPanel
  participant API

  User->>Terminal: contextTab = newsChat
  Terminal->>Panel: mount
  Note over Panel: activeThreadId=null, messages=[]
  Panel->>API: GET /api/chat/threads?symbol=SYM
  API-->>Panel: threads[]
  Note over Panel: setThreads only; activeThreadId stays null
  Panel->>Panel: symU effect: setActiveThreadId(null), setMessages([])
  Panel->>Panel: activeThreadId effect: else setMessages([])
  User->>Panel: sees empty-state copy (messages.length === 0)
```

### 2.3 Hooks involved

| Hook | Dependency | On mount / change behavior |
|------|------------|----------------------------|
| `useEffect` | `[symU, refreshThreads]` | Lines 190–195: `refreshThreads()`, **`setActiveThreadId(null)`**, **`setMessages([])`**, `setThreadsMenuOpen(false)` |
| `useEffect` | `[activeThreadId, loadThreadMessages]` | Lines 197–200: if `activeThreadId` → `loadThreadMessages`; **else `setMessages([])`** |
| `useEffect` | `[multiAgentModels]` / `[synthesizerModel]` | Persist multi-agent prefs to `sessionStorage` |
| `useEffect` | `[messages, isStreaming, toolPills]` | Scroll to bottom |

**Critical:** The `symU` effect runs on **every mount**, not only when the symbol changes. Remounting Chat after navigation away therefore **always clears** thread selection and messages, even for the same symbol.

---

## Phase 3 — Re-hydration path

### 3.1 API calls

| Function | Endpoint | When invoked | Updates state |
|----------|----------|--------------|---------------|
| `refreshThreads` | `GET /api/chat/threads?symbol={symU}` | `symU` effect on mount; after successful `sendMessage` (line 355) | `threads` only |
| `loadThreadMessages` | `GET /api/chat/threads/{threadId}/messages` | When `activeThreadId` is truthy (effect lines 197–200) | `messages` from JSON; on error `setMessages([])` |

Send path uses `POST /api/ai/chat` (SSE), not the thread list endpoints.

### 3.2 Does `activeThreadId` survive navigation?

**No.**

- Stored only in component `useState` (line 141).
- Set from SSE `thread` event during send (lines 318–320).
- Set when user picks a thread in the menu (`handleSelectThread`, line 403).
- Cleared by: `symU` effect (line 192), `handleNewThread` / `handleClear` (lines 394–395), and initial state on mount.

There is no `sessionStorage` / `localStorage` key for the active server thread ID per symbol.

### 3.3 Post-remount user experience

1. **Thread list:** Populated asynchronously via `refreshThreads` (user may open threads menu to see titles).
2. **Messages:** Remain empty until `activeThreadId` is set.
3. **Empty UI:** Lines 708–712 render placeholder copy when `messages.length === 0`.
4. **Manual recovery:** User opens threads menu (lines 626–697) and taps a thread → `handleSelectThread` → `loadThreadMessages`.
5. **No “resume last thread”:** No code selects `threads[0]`, most recently updated thread, or a stored ID on mount.

### 3.4 Comparison: unused Zustand bundle

`marketNewsChatBySymbol[sym].activeThreadId` in `store.ts` (lines 159–163, 781–791) was designed to hold per-symbol active thread and messages client-side, with persistence. The current panel bypasses this entirely in favor of ephemeral `useState` plus server fetch on explicit selection.

---

## Phase 4 — Clearing logic

### 4.1 Explicit clears (`setMessages([])` / `setActiveThreadId(null)`)

| Trigger | Location | What is cleared |
|---------|----------|-----------------|
| **Symbol change** (`symU` changes) | Lines 190–195 | `activeThreadId`, `messages`, threads menu closed; `refreshThreads` for new symbol |
| **Panel mount** (same symbol) | Same effect — runs on mount | Same as symbol change: **always** null ID + empty messages |
| **`activeThreadId` becomes null** | Lines 197–200 | `messages` |
| **New chat** (`handleNewThread`) | Lines 391–397 | Stops stream/speech; `activeThreadId`, `messages`, `lastFailedMessage`; closes menu |
| **Clear button** (`handleClear` = `handleNewThread`) | Lines 407, 678–686 | Same as new chat |
| **`loadThreadMessages` failure** | Lines 185–187 | `messages` only |
| **Blur / composer focus** | Lines 472–478 | **Does not** clear chat state |

### 4.2 Navigation-related clearing (implicit)

| User action | Mechanism |
|-------------|-----------|
| Switch context tab away from Chat | Unmount → all local state destroyed |
| Switch bottom tab away from Markets | Unmount → same |
| Return to Chat | Remount → `symU` effect clears ID + messages again |

### 4.3 What is *not* cleared on navigation

- Server-side threads and messages (backend unchanged).
- `sessionStorage` multi-agent model prefs.
- Zustand `marketNewsChatBySymbol` in `localStorage` (unchanged by panel; stale if ever populated by old code).
- `Terminal.tsx` `contextTab` value in memory while the SPA stays open (but not restored to Chat on remount unless user selects Chat again).

---

## Root cause chain (condensed)

1. **Ephemeral UI state** — conversation lives in `useState`, not in a store that survives tab changes.
2. **Conditional mount** — leaving Chat unmounts the panel.
3. **Mount reset** — `useEffect([symU, refreshThreads])` forces `activeThreadId = null` and `messages = []` on every mount.
4. **No re-hydration without ID** — `loadThreadMessages` never runs until the user selects a thread or a new message assigns one via SSE.
5. **Unused persisted store** — `marketNewsChatBySymbol` could have bridged navigation but is not wired to the component.

---

## Suggested fix directions (informational only; out of audit scope)

These are not implemented in this audit branch:

1. Persist `activeThreadId` per symbol (`sessionStorage` or Zustand) and restore on mount; remove or narrow the mount-time `setActiveThreadId(null)` in the `symU` effect so remount does not always wipe selection.
2. On mount after `refreshThreads`, auto-select the most recently updated thread (or last active ID if still in list) and call `loadThreadMessages`.
3. Keep the panel mounted but hidden (`display: none` / CSS) when switching context tabs, or lift thread/message state to Zustand/context above the conditional.
4. Reconnect `MarketNewsChatPanel` to `marketNewsChatBySymbol` **or** delete dead store APIs to avoid confusion.

---

## Files reviewed

| File | Relevance |
|------|-----------|
| `artifacts/alpha-terminal/src/components/MarketNewsChatPanel.tsx` | Chat UI, state, effects, API fetch |
| `artifacts/alpha-terminal/src/pages/Terminal.tsx` | Mount conditions, `contextTab` / `activeBottom` |
| `artifacts/alpha-terminal/src/components/MarketDataTabs.tsx` | Context tab definitions |
| `artifacts/alpha-terminal/src/lib/store.ts` | Unused `marketNewsChatBySymbol`, persist `partialize` |
| `artifacts/alpha-terminal/src/App.tsx` | Routing |
| `artifacts/alpha-terminal/src/lib/chatSse.ts` | SSE consumption (send path) |

---

## Verification notes for engineers

To reproduce in devtools:

1. Open Markets → Chat, send a message (observe `thread` SSE sets `activeThreadId`).
2. Switch to News or AI bottom tab.
3. Return to Markets → Chat.
4. Observe: empty placeholder; Network may still show `GET /api/chat/threads?symbol=…` 200 with threads; **`GET .../messages` absent** until a thread is selected in the menu.

This matches “backend persists, frontend session disappears.”
