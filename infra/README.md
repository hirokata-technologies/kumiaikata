# Infrastructure (Google Cloud)

Terraform for everything Kata runs on Google Cloud: the kumiai app
(`apps/web`, SvelteKit with the API merged in), its Postgres database and
attachments, and the AI agents (`apps/agents`). Kata no longer runs on
Railway.

| File | What it defines |
|---|---|
| `apis.tf` | Google Cloud APIs the project needs |
| `service_accounts.tf` | Agents runtime and deployer service accounts and their roles |
| `github_oidc.tf` | Workload Identity Federation so GitHub Actions can deploy without a stored key |
| `agent_runtime.tf` | The Agent Runtime instance that hosts both agents |
| `kumiai.tf` | kumiai app on Cloud Run (service `kumiai`), its migration job (`kumiai-migrate`), image repository and deployer |
| `database.tf` | Cloud SQL for PostgreSQL 18 (`kumiai`, shared-core `db-f1-micro`, private IP only), database and user |
| `network.tf` | VPC network and subnet for Cloud SQL's private IP and Cloud Run's Direct VPC egress |
| `storage.tf` | Cloud Storage bucket for card attachments |
| `secrets.tf` | Secret Manager secrets for the app (database URL, auth secret, Google OAuth client, Resend) |
| `load_balancer.tf` | Google load balancer and HTTPS certificate for `kumiai.hirokata.dev` |
| `terraform.tfvars` | Project `kumiaikata`, region `asia-southeast1` (Singapore), GitHub repository |

## Who owns what

- **Terraform** owns the Agent Runtime *instance*: its name, region and
  deletion protection.
- **GitHub Actions** (`.github/workflows/deploy-agents.yml`) owns the *code*
  running on it. Terraform ignores changes to the instance's `spec`, so the two
  never fight.
- The same split applies to the web app: Terraform owns the Cloud Run service
  and its settings, and `.github/workflows/deploy-kumiai.yml` ships new images.
  Terraform ignores the image.

## State

State lives on the private RustFS server (`https://s3.apps.hirokata.dev`) in
the `hirokata-cloudflare-tf-state` bucket, under the key
`kumiaikata/terraform.tfstate`. This is the same bucket the other hirokata.dev
stacks use, each under its own key. Locking uses a lock object next to the
state (`use_lockfile`), so no lock table is needed.

The S3 backend reads `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`; use the
RustFS keys (Kubernetes secret `rustfs-credentials` in the `rustfs` namespace
of `k8s-lab-hetzner`), not AWS ones.

## First-time setup

You need the Owner role on the `kumiaikata` project.

```bash
# 1. Google credentials. Terraform uses application default credentials, so
#    point them at the hirokata.dev account (they renew themselves, which
#    matters because creating Cloud SQL takes longer than a one-hour token).
gcloud --configuration hirokata auth application-default login

#    Credentials for the state bucket: the RustFS keys from the Hetzner cluster.
export AWS_ACCESS_KEY_ID="$(kubectl --context k8s-lab-hetzner -n rustfs get secret rustfs-credentials -o jsonpath='{.data.RUSTFS_ACCESS_KEY}' | base64 -d)"
export AWS_SECRET_ACCESS_KEY="$(kubectl --context k8s-lab-hetzner -n rustfs get secret rustfs-credentials -o jsonpath='{.data.RUSTFS_SECRET_KEY}' | base64 -d)"

# 2. Create the infrastructure.
cd infra
terraform init
terraform plan
terraform apply

# 3. Copy the outputs into GitHub repository variables
#    (Settings → Secrets and variables → Actions → Variables).
terraform output
```

| GitHub variable | Terraform output |
|---|---|
| `AGENT_RUNTIME_ID` | `agent_runtime_id` |
| `GCP_DEPLOYER_SERVICE_ACCOUNT` | `deployer_service_account` |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | `workload_identity_provider` |
| `KUMIAI_IMAGE_REPOSITORY` | `kumiai_image_repository` |
| `GCP_KUMIAI_DEPLOYER_SERVICE_ACCOUNT` | `kumiai_deployer_service_account` |

## kumiai app: secrets, DNS and cutover

### Secrets

Terraform generates `kumiai-database-url` and `kumiai-better-auth-secret`.
The other three start as placeholders; add the real values by hand so they
never enter Terraform state:

```bash
printf '%s' '<value>' | gcloud --configuration hirokata secrets versions add kumiai-google-client-id --data-file=-
printf '%s' '<value>' | gcloud --configuration hirokata secrets versions add kumiai-google-client-secret --data-file=-
printf '%s' '<value>' | gcloud --configuration hirokata secrets versions add kumiai-resend-api-key --data-file=-
```

The service reads `latest`, so deploy a new revision afterwards.

In the Google OAuth client, add the redirect URI
`https://kumiai.hirokata.dev/api/auth/callback/google`.

### Database

The organization blocks public IPs on Cloud SQL (`sql.restrictPublicIp`), so
the instance has a **private IP only** on the `kumiai` VPC network
(`network.tf`, Private Service Access). Cloud Run joins that network with
Direct VPC egress and connects over TCP with an encrypted connection.

Because there is no public IP, the database can't be reached from a laptop.
Migrations run as the Cloud Run Job `kumiai-migrate` before every deploy; for
one-off access, run a Cloud Run Job or a temporary VM on the `kumiai` network.

### DNS (Cloudflare, in hirokata-monorepo)

`hirokata.dev` is on Cloudflare. Add two records from `terraform output`:

| Name | Type | Content | Proxy |
|---|---|---|---|
| `kumiai` | A | `kumiai_ip_address` | Proxied (orange cloud) |
| `kumiai_certificate_dns_record.name` | CNAME | `kumiai_certificate_dns_record.data` | DNS only (grey cloud) |

- The CNAME lets Certificate Manager issue and renew the HTTPS certificate. It
  must stay DNS only. The certificate is usually active within 15–60 minutes.
- Cloudflare's SSL/TLS mode must be **Full (strict)**: the load balancer has a
  valid Google certificate.
- Check the certificate with
  `gcloud --configuration hirokata certificate-manager certificates describe kumiai`.

### Go-live

1. Add the three secrets and the OAuth redirect URI, and set the GitHub
   variables.
2. Run **Deploy Kumiai** in GitHub Actions (migrates, then deploys). The
   database starts empty: no data is carried over from Railway.
3. Add the DNS records above, wait for the certificate to become `ACTIVE`,
   and sign in at `https://kumiai.hirokata.dev`.
4. Delete the old Railway project and the old `kata` and `kata-api` DNS
   records.

## Calling the agents from the kumiai app

The kumiai app runs as `kumiai-runtime`, which has `roles/aiplatform.user`, so
it calls Agent Runtime with its own identity and no key. The instance's full
resource name reaches the app as `AGENT_RUNTIME_NAME`.

## Day-to-day

Export the two RustFS variables as in first-time setup, then:

```bash
cd infra
terraform fmt
terraform plan
terraform apply
```

CI runs `terraform fmt -check` and `terraform validate` on every pull request.
Applying is always done by hand.

## Terraform in CI

`.github/workflows/terraform.yml` plans and applies this directory:

1. **Pull request** touching `infra/`: runs `terraform plan` and posts it as a comment.
   Nothing changes.
2. **Review**: the org ruleset "Protect main" requires an approving review, and
   `.github/CODEOWNERS` makes changes to `infra/` and the Terraform workflow need the
   `developer-operations` team. **The merge is the approval.**
3. **Merge to `main`**: plans again and, when there are changes, applies that plan
   automatically. No changes means no apply.
4. **Manual run** (Actions -> Terraform -> Run workflow, from `main`): plans, and also
   applies when "apply" is ticked. Use it to re-run a failed apply or to apply drift fixes.

One-time setup (not managed by Terraform on purpose, so CI cannot grant itself access):

- **GitHub environment** `infra-production`, limited to the `main` branch.
- **Two Google service accounts** trusted through the existing `github` workload identity pool:
  - planner: read-only (for example `roles/viewer` plus access to any secret metadata the
    plan reads); bound with `roles/iam.workloadIdentityUser` to
    `principalSet://.../attribute.repository/hirokata-technologies/kumiaikata`.
  - applier: the roles Terraform needs to change this project; bound only to the `main` ref,
    like `github_deploy_principal` in `github_oidc.tf`.
- **Repository variables** `GCP_TERRAFORM_PLANNER_SERVICE_ACCOUNT` and
  `GCP_TERRAFORM_APPLIER_SERVICE_ACCOUNT`, and **secrets** `TF_STATE_ACCESS_KEY_ID` and
  `TF_STATE_SECRET_ACCESS_KEY` (the RustFS keys).
