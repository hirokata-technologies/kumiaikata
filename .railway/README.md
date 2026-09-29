# `.railway/railway.ts` — the `kata` partial

This file is a **named partial** (`export const partial = "kata";`) for the Railway project
`kumiaikata`. It declares the five resources this repo owns — `kata-api`, `kata-web`,
`kata-relay-service`, `kata-db` and `Redis` — plus their volumes and the `kata` canvas group.

The services were first defined against the shared `hirokata.web` project, which still hosts
`hirokata-web` and `hirokata-web-db` for an unrelated portfolio repo. This repo no longer
targets that project and nothing here names those resources. The partial name still stops a
future `railway config apply` from proposing to delete anything another partial owns.

Agents working on this file only ever run:

- `railway link --project ea58de81-e8f9-448d-9b0e-65352cae0736 --environment production`
- `railway config pull` (never `--include-variables`, which would inline decrypted secrets)
- `railway config plan` (never `--yes`, `--confirm-destructive`, `--show-values` or
  `--decrypt-variables`)

`railway config apply` is run by the `railway-config.yml` workflow when a pull request merges,
and only for the plan reviewed on that pull request. That workflow never confirms a destructive
change. Any other apply, and any destructive one, is the guild master's own manual step. Agents
run it only when the guild master explicitly authorizes it.

Custom domains cannot be registered through Railway configuration yet, so `kata-api.hirokata.dev`
and `kata.hirokata.dev` are added in the dashboard and are not declared in `railway.ts`.

`pnpm check:railway` type-checks the file. `pnpm lint:railway` lints it. See
`test/railway-iac/` for the offline safety test that asserts on the partial's shape without
network access or credentials.
