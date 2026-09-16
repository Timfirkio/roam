# Roam project instructions

- Use pnpm 11.19.0 through Corepack.
- Install dependencies with `pnpm install --frozen-lockfile`.
- Do not modify `pnpm-workspace.yaml` during routine installs.
- Build scripts are governed by the committed `allowBuilds` policy.
- Run `pnpm test` and `pnpm build` after dependency or build changes.
- Preserve unrelated working-tree changes.

## UI and design system

- For every UI-related request, inspect the in-app Design System view in `src/main.tsx`, the shared primitives in `src/components/ui/`, and the token definitions in `src/styles.css` before implementing. Reuse the established shadcn components and semantic type, colour, spacing, shape, motion, and accessibility tokens wherever they fit; do not introduce one-off equivalents without a clear need.
- When adding or materially changing a shared shadcn component, update the in-app Design System documentation in `src/main.tsx` in the same change. Include a representative, accessible preview and describe its intended use or relevant variants/states so the component inventory remains complete.
