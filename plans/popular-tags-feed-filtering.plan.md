# Popular Tags Feed Filtering

## Application Overview

The RealWorld/Conduit app (hash-routing at http://localhost:3000/#/) displays a two-column home page. The left column shows a feed with two default tabs — "Your Feed" and "Global Feed". The right column contains a "Popular Tags" sidebar (aside/complementary landmark) listing available tags as clickable buttons with class "tag-pill tag-default". Clicking a tag transforms the feed: a third tab appears in the feed tab list (button with class "nav-link active", containing an ion-pound icon and the tag name), the clicked sidebar tag button gains an [active] state, and the app fires a filtered API request GET /api/articles?tag=<tagname>&&limit=3&&offset=0. Navigating away to "Global Feed" or "Your Feed" removes the ephemeral tag tab and clears the sidebar tag's active state. The URL remains http://localhost:3000/#/ throughout — no URL change occurs; all state is in-page. The app was explored with one tag visible in the sidebar: "e2e".

## Test Scenarios

### 1. Popular Tags feed filtering

**Seed:** `adapters/realworld-conduit/setup.ts`

#### 1.1. clicking a Popular Tag filters the Global Feed to show only that tag's articles

**File:** `adapters/realworld-conduit/specs/popular-tags-feed-filtering.spec.ts`

**Steps:**
  1. Navigate to http://localhost:3000/#/ and wait for the page title 'Conduit' to be present.
    - expect: The home page loads at URL http://localhost:3000/#/.
    - expect: The main content area renders two feed tabs: 'Your Feed' and 'Global Feed'.
    - expect: The right sidebar (complementary landmark) contains a 'Popular Tags' heading (h6) and at least one tag button (e.g. 'e2e') with role=button inside the complementary landmark.
  2. Click the 'Global Feed' button (role=button, name='Global Feed') in the feed tab list.
    - expect: The 'Global Feed' button becomes the active tab. In the accessibility snapshot it is marked [active]; in the DOM its button element carries CSS class 'nav-link active'.
    - expect: Exactly two tabs are present in the feed tab list: 'Your Feed' and 'Global Feed'. No third tag tab exists.
    - expect: The app fires GET /api/articles?limit=3&&offset=0 and receives HTTP 200.
  3. In the 'Popular Tags' sidebar (complementary landmark with heading text 'Popular Tags'), locate the first visible tag button. Record its accessible name as TAG (observed value: 'e2e'). Click that tag button.
    - expect: A third tab appears in the feed tab list. The new tab button has accessible name matching TAG and contains a pound/hash icon (rendered via CSS class ion-pound on an <i> element). Its button element has CSS class 'nav-link active'.
    - expect: In the accessibility snapshot the new tab button is the only feed tab marked [active]. The 'Your Feed' and 'Global Feed' buttons are no longer active.
    - expect: The tag button in the Popular Tags sidebar gains the [active] accessibility state (the sidebar button for TAG appears as [active] in the snapshot).
    - expect: The app fires the network request GET /api/articles?tag=TAG&&limit=3&&offset=0 and receives HTTP 200.
    - expect: The URL remains http://localhost:3000/#/ — no URL change occurs.
    - expect: The feed content area shows either article previews for articles tagged with TAG, or the message 'Articles not available.' if no tagged articles exist. The feed does not show articles from unrelated tags.
  4. Click the 'Global Feed' tab button to switch away from the tag-filtered view.
    - expect: The tag tab (button with name TAG and pound icon) is removed from the feed tab list. The list reverts to exactly two items: 'Your Feed' and 'Global Feed'.
    - expect: The 'Global Feed' button is now the active tab (CSS class 'nav-link active' / accessibility [active]).
    - expect: The tag button in the Popular Tags sidebar loses its [active] state — it appears without [active] in the snapshot.
    - expect: The app fires GET /api/articles?limit=3&&offset=0 and receives HTTP 200.
  5. Click the same tag button again in the Popular Tags sidebar.
    - expect: The tag tab reappears as the third tab in the feed tab list, active (CSS class 'nav-link active').
    - expect: The sidebar tag button regains the [active] state.
    - expect: The app fires a new GET /api/articles?tag=TAG&&limit=3&&offset=0 request and receives HTTP 200.
    - expect: Feed content is consistent with the first tag-filter activation.
  6. Click the 'Your Feed' tab button.
    - expect: The tag tab disappears from the feed tab list. Only 'Your Feed' and 'Global Feed' tabs remain.
    - expect: The 'Your Feed' button becomes the active tab.
    - expect: The tag button in the Popular Tags sidebar loses its [active] state.
    - expect: The app fires GET /api/articles/feed?limit=3&&offset=0 and receives HTTP 200.
