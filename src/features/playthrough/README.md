# `playthrough` slice (React)

Header switcher + create modal + hooks for the rest of the app to read the
active playthrough's tier. Pairs with `src-tauri/src/features/playthrough/`.

## Public surface

- `<PlaythroughSwitcher />` — drop into the app shell header. Dropdown of
  playthroughs in the registry; switching opens that playthrough in the
  background, click "New playthrough" to launch the create modal.
- `<CreatePlaythroughModal />` — name + starting-tier form. Validates client
  side and surfaces server errors via `role=alert`.
- Hooks (`usePlaythroughList`, `useCurrentPlaythrough`,
  `useCreatePlaythrough`, `useOpenPlaythrough`, `useClosePlaythrough`,
  `useSetCurrentTier`, `useDeletePlaythrough`) — TanStack Query wrappers.
  Mutations invalidate the `list` and `current` keys.

## Cross-slice consumers

- The `library` slice's tables call `useCurrentPlaythrough()` to dim and
  lock-icon any item / building / recipe / milestone whose `unlockTier`
  exceeds the active playthrough's `currentTier`. With no active
  playthrough, nothing is locked.

## Tests

- `CreatePlaythroughModal.test.tsx` — empty name rejected, name > 80 chars
  rejected, valid submit invokes the api and closes the modal.
- `PlaythroughSwitcher.test.tsx` — list rendering, "active" pill on the
  current playthrough, "no playthroughs yet" empty state, opening another
  entry calls the API.
