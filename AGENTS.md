# Roam project instructions

- Use pnpm 11.19.0 through Corepack.
- Install dependencies with `pnpm install --frozen-lockfile`.
- Do not modify `pnpm-workspace.yaml` during routine installs.
- Build scripts are governed by the committed `allowBuilds` policy.
- Run `pnpm test` and `pnpm build` after dependency or build changes.
- Preserve unrelated working-tree changes.
