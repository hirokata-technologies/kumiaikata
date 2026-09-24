# `.railway/railway.ts` — the `kata` partial

This file is a **named partial** (`export const partial = "kata";`) for the shared Railway
project `hirokata.web`. It declares only the five resources this repo owns — `kata-api`,
`kata-web`, `kata-relay-service`, `kata-db` and `Redis` — plus their volumes and the `kata`
canvas group.

The same Railway project also hosts `hirokata-web` and `hirokata-web-db`, which belong to an
unrelated portfolio repo. They are deliberately absent from this file, not even to exclude
them — the partial name is what stops a future `railway config apply` from proposing to delete
them.

Agents working on this file only ever run:

- `railway link --project 368123c0-af61-4468-ae3b-e39135bd673c --environment production`
- `railway config pull` (never `--include-variables`, which would inline decrypted secrets)
- `railway config plan` (never `--yes`, `--confirm-destructive`, `--show-values` or
  `--decrypt-variables`)

`railway config apply` is the guild master's own manual step, after review — never run by an
agent or CI, whether via the CLI or the Railway MCP tools.

`pnpm check:railway` type-checks the file. `pnpm lint:railway` lints it. See
`test/railway-iac/` for the offline safety test that asserts on the partial's shape without
network access or credentials.
