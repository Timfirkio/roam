# Navigation and overlay framework

Roam has three primary tabs: Map, Sessions, and Settings. The tab bar remains available while a tab or subpage is open. Map is a full-screen instrument with its own controls; Sessions and Settings use the shared scrolling-page treatment. Keep this hierarchy consistent when adding screens.

## Which pattern to use

| Destination or action | Pattern | Current example |
| --- | --- | --- |
| Primary destination | Bottom tab | Map, Sessions, Settings |
| Scrolling top-level page | Large title that becomes a sticky top bar | Sessions, Settings |
| Deeper page with a return path | Persistent `PageNavigation` with Back, title, and optional actions | Session details, Design System |
| Contextual choices attached to a control | Portal-based dropdown menu | Add session, session actions |
| Contextual settings that benefit from seeing the page behind them | `ContextualPanel` | Map layers |
| Focused task that takes the whole screen | Full-screen dialog | Session search |
| Confirmation or form | Dialog or alert dialog | Edit title, delete session |

Do not make a new primary tab for a detail view or use a modal as a substitute for a page with its own navigational hierarchy.

## Top-level pages

`SessionsView` and `SettingsView` in `src/main.tsx` place a `.page-heading--morphing` inside an independently scrolling section. At the top, it is a large title with ghost icon actions aligned to its right. Over the first 48px of scrolling, `updateMorphingPageHeading` scales the title to the compact size and reveals the sticky bar background. The title and actions remain the same elements throughout that scroll transition. The Map tab does not use this header; its map controls and overlays are positioned for the map.

The scroll section owns vertical scrolling. Keep the sticky heading in that section, and keep the header surface full width without introducing horizontal overflow. Page content has a 16px outer margin, including any space occupied by a desktop scrollbar. `measureMorphingPageHeading` measures the scrollbar inset on layout changes, and `src/styles.css` uses `--page-scrollbar-inset` for right padding. Touch devices use the native scrollbar and scrolling behavior; precise pointers use a thin, subtle scrollbar. New scrolling pages should follow the same width and overflow rules.

Top-level content normally enters with a subtle fade and 12px upward movement. Do not replay that animation when restoring an already-scrolled page from a subpage: it makes the sticky bar temporarily transparent. Sessions preserves its list scroll position and applies `.top-level-content--restored` when returning to a scrolled list. Map retains its own entrance behavior.

## Subpages

Use `PageNavigation` from `src/components/ui/page-navigation.tsx` for a subpage. It stays visible at the top, has a Back action and title, and accepts optional right-side actions. Use `Button` with the established ghost icon sizes and Phosphor icons. The subpage scroll section uses `.subpage-page` so its first content clears the 64px navigation bar and the system top safe area. The full page content enters with a subtle fade and upward movement.

On return, the outgoing subpage title and actions remain in the bar while it fades away. Do not replace them with the parent page's title before that fade finishes. If the parent is already scrolled, its sticky bar should be fully opaque beneath the outgoing bar. Preserve the parent's scroll position when opening a detail page and restore it before showing the parent.

## Overlays and actions

- Use the shared `DropdownMenu` for short action lists. It is portaled above page content, eases in and out, and remains keyboard accessible. Keep equivalent menus consistent across a list card and its detail page. Session cards themselves open the detail page; their More button is a separate action target.
- Use `ContextualPanel` from `src/components/ui/contextual-panel.tsx` for choices such as Map layers. On phones it is a content-sized bottom sheet with a top border, handle, bottom safe-area padding, and scrollable content on short screens. The handle or heading follows a downward drag; release dismisses or eases it back. Tapping the scrim closes it. On wider screens it is a centered dialog with a close button. Its backdrop is a scrim without blur so map changes remain visible.
- The Layers panel contains Region progress, Region boundaries, 3D terrain, and 3D buildings. Use Phosphor icons at the Map control icon size, normal button-weight labels, inset row dividers, and full-width row hover states. In Region progress mode, the card stays on its selected region while the map moves; tapping a region or its progress badge changes the card and highlight without moving the camera.
- Use the full-screen search dialog for Sessions search. Focus the search field after the dialog enters so the keyboard follows the overlay. The Back button closes it; the X appears only with a query and clears the query. Results are full-width selectable rows. Match titles and regions without requiring exact accents or punctuation, and tolerate small spelling errors. Filters are not part of this pattern yet.
- Use the shared dialog and alert dialog primitives for forms and destructive confirmations. The contextual sheet's clear scrim is a deliberate variant; ordinary dialogs retain their own backdrop treatment.

## Motion, safe areas, and accessibility

Motion should use the existing `--ease-outdoor` timing and stay subtle: fade for title changes, fade plus small upward movement for page entry, and eased entry and exit for menus and dialogs. Honor `prefers-reduced-motion`. Avoid adding a transform or opacity animation to a restored sticky bar.

Use the `--roam-safe-top`, `--roam-safe-right`, `--roam-safe-bottom`, and `--roam-safe-left` tokens in `src/styles.css` for system insets. In particular, account for the top inset under persistent subpage navigation and the bottom inset inside phone sheets. Give icon-only actions an accessible name, use dialog titles and descriptions, expose switch labels, preserve focus styles, and keep a non-gesture way to dismiss overlays (scrim, Back, Escape, or a visible desktop close control as appropriate).

## Adding or changing a page

1. Choose its place in the table above. Reuse `PageNavigation`, `ContextualPanel`, and the shared shadcn primitives instead of creating another header or modal variant.
2. Inspect the in-app Design System in `src/main.tsx`, `src/components/ui/`, and the semantic tokens and motion rules in `src/styles.css`.
3. Check the top and scrolled states, a subpage return to both an unscrolled and scrolled parent, narrow phone width with safe areas, desktop scrollbar width, overlay stacking and dismissal, keyboard focus, and reduced motion where the change applies.
4. Update this guide when the hierarchy or behavior changes. If a shared component changes materially, update its accessible preview and usage text in the in-app Design System in the same change.

The current page composition and scroll calculations live in `src/main.tsx`; shared navigation and sheet behavior live in `src/components/ui/page-navigation.tsx` and `src/components/ui/contextual-panel.tsx`; the layout and motion rules live in `src/styles.css`.
