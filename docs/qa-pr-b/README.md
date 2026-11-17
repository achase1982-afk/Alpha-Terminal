# QA PR B Screenshots - Status Report

## Task Overview
Capture real Alpha-Terminal UI screenshots for PR #645 showing:
1. Options chain with crossed bid>ask quotes
2. Order ticket (bottom sheet) from leg tap
3. Review screen
4. FAIL pre-trade state

Target viewports: 440x956 and 402x715

## Work Completed

### 1. Build & Preview Setup
- ✅ Built project with `pnpm run build`
- ✅ Started vite preview server on port 3000
- ✅ Verified server accessibility

### 2. Authentication Bypass
- ✅ Added `.env.local` with `VITE_DEV_BYPASS_AUTH=true`
- ✅ Rebuilt app to bypass Clerk authentication

### 3. QA Harness Development
- ✅ Created `/qa` route with QAHarness component
- ✅ Implemented mock Schwab API intercept for option chain data
- ✅ Added SPX option chain fixture with crossed bid/ask (bid=15.80, ask=15.20)
- ✅ Fixed OrderTicket.tsx syntax error (`??` with `||` operator precedence)
- ✅ Committed harness to git (commit cd9bc102)

### Files Created/Modified:
- `artifacts/alpha-terminal/src/pages/QAHarness.tsx` - New QA harness component
- `artifacts/alpha-terminal/src/App.tsx` - Added /qa route
- `artifacts/alpha-terminal/.env.local` - Dev environment config
- `artifacts/alpha-terminal/src/components/OrderTicket.tsx` - Fixed syntax error

## Blocking Issues

### Primary Blocker: Backend API Dependency
The OptionsTab component requires live backend API data to render the options chain. Without a running backend:

1. **API Calls Fail**: The component uses `useGetOptionChain` which calls `/api/schwab/marketdata/chains`
2. **Mock Intercept Limitations**: Window.fetch override in QAHarness loads but the React Query cache and component lifecycle make the mocked data not propagate correctly
3. **Route Resolution**: The /qa route is compiled into the bundle but appears to have routing issues (404 on access)

### Technical Details
- The QA harness sets mock tokens: `useTerminalStore().setTokens("mock-qa-access-token", ...)`
- Attempts to override `window.fetch` to intercept API calls
- Route exists in compiled bundle (verified in index-*.js)
- Component imports correctly (`import { OptionsTab } from "@/components/OptionsTab"`)

## Alternative Approaches Considered

1. **MSW (Mock Service Worker)**: Not configured in project
2. **React Query Mock Data**: Requires more invasive component changes
3. **Playwright HTML Mocks**: Already exist in `e2e/qa-pr-b-screenshots.spec.ts` but user requested real UI

## Recommendations

### Option A: Backend API Setup
Start the api-server to provide real data:
```bash
cd /agent/repos/Alpha-Terminal/artifacts/api-server
pnpm run dev
```
Then navigate to real terminal with SPX and capture screenshots.

### Option B: Enhanced Playwright Tests
Improve the existing Playwright tests in `e2e/qa-pr-b-screenshots.spec.ts` to use actual component rendering with Storybook or similar.

### Option C: Complete QA Harness
Debug the /qa route routing issue and enhance the mock data injection to work with React Query's caching layer.

## Next Steps

To complete screenshot capture with real UI:

1. **Start Backend**: Launch api-server with proper Schwab API credentials
2. **Configure Symbol**: Navigate to SPX in the running app
3. **Capture States**: Use browser DevTools to resize viewport and capture screenshots
4. **Save PNGs**: Export screenshots to `/agent/repos/Alpha-Terminal/docs/qa-pr-b/`

Or

1. **Fix /qa Route**: Debug why route returns 404 despite being in bundle
2. **Enhance Mocks**: Improve fetch intercept or use MSW
3. **Verify Rendering**: Ensure OptionsTab renders with mocked data
4. **Automate Capture**: Use Playwright to screenshot the /qa route

## Files to Generate

Target screenshot files:
- `chain-scrolled-440x956.png`
- `chain-scrolled-402x715.png`
- `order-ticket-440x956.png`
- `order-ticket-402x715.png`
- `review-screen-440x956.png`
- `review-screen-402x715.png`
- `fail-pretrade-440x956.png`
- `fail-pretrade-402x715.png`

## Summary

The QA harness infrastructure is in place and committed, but the options chain component requires either:
- A live backend API providing option chain data, or
- More sophisticated frontend mocking that integrates with React Query

The current blocker is architectural - the OptionsTab component was designed to work with real backend data and doesn't have a built-in mock/fixture mode.
