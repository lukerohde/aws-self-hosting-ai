# /new-site — Deploy a new site at a subdomain

Scaffolds a new sibling repo, deploys Hello World at `<subdomain>.<your-domain>`,
and writes a CLAUDE.md build plan. From there, open the new repo in Claude Code
and build the actual product.

**Arguments:** $ARGUMENTS (optional subdomain name, e.g. `/new-site myapp`)

## How DNS and AWS access work (read before starting)

**DNS:** The new site's own Pulumi stack handles the DNS record. It reads `zone_id`
from the ingress stack via `StackReference`, then the `StaticSite` component adds
a Route53 A/CNAME record for the subdomain into the ingress-owned zone. The ingress
stack itself is never modified — the new site just writes a record into it.
The infra IAM role has `route53:ChangeResourceRecordSets` permission for exactly this.

**AWS auth (OIDC):** The ingress role trusts all `<GITHUB_OWNER>/*` repos via a
wildcard. No ingress update is needed when adding a new repo. The only GitHub secret
needed is `PULUMI_ACCESS_TOKEN`.

**Future hardening (not required now):** The wildcard trust is fine for a personal
project. To scope to specific repos later, add a `trustedRepos` config list to
`infra/pulumi-ingress/Pulumi.prod.yaml` and update the ingress `__main__.py` to use it.
Run `make infra-ingress-up` from the parent blog repo — ingress changes always live
in the parent, never in the child site repo.

---

## Step 0 — Read existing config

Discover all values from the repo. Don't ask for things you can find.

```bash
# Domain, owner, bucket prefix — set by /setup
cat infra/pulumi-ingress/Pulumi.prod.yaml

# Pulumi org
docker compose run --rm pulumi-ingress pulumi whoami

# Ingress stack name
grep "^name:" infra/pulumi-ingress/Pulumi.yaml
```

Parse out:
- DOMAIN from `<GITHUB_OWNER>-ingress:domainName`
- GITHUB_OWNER from `<GITHUB_OWNER>-ingress:githubOwner` (or `gh api user --jq '.login'`)
- BUCKET_PREFIX from `<GITHUB_OWNER>-ingress:bucketPrefix`
- PULUMI_ORG from `pulumi whoami`
- INGRESS_STACK_NAME from Pulumi.yaml `name:` field

Derive: INGRESS_STACK_REF = `<PULUMI_ORG>/<INGRESS_STACK_NAME>/prod`

Verify ingress is deployed:
```bash
make infra-ingress-outputs
```

If `zone_id` is missing, tell the user to run `/setup` first.

---

## Step 1 — Collect config

**a) Subdomain / app name**
If `$ARGUMENTS` was provided, use it. Otherwise ask:
"What subdomain? (e.g. `myapp` → `myapp.<DOMAIN>`)"
Validate: lowercase, numbers, hyphens only. Store as APP_NAME.

**b) GitHub repo name**
"GitHub repo name? (default: <APP_NAME>)"
Store as REPO_NAME.

**c) Description**
"One-sentence description of this site?"
Store as DESCRIPTION.

**d) Public or private repo?**
"Public or private GitHub repo? (default: public)"

---

## Step 2 — Create the repo directory

```bash
mkdir -p ../<APP_NAME>/{infra/pulumi,.github/workflows}
```

---

## Step 3 — Hello World `index.html`

Create `../<APP_NAME>/index.html`:
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title><APP_NAME></title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh; margin: 0; background: #f5f5f5;
    }
    .card {
      background: white; padding: 2rem 3rem; border-radius: 8px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.08); text-align: center;
    }
    h1 { margin: 0 0 0.5rem; font-size: 1.8rem; }
    p  { color: #666; margin: 0; }
  </style>
</head>
<body>
  <div class="card">
    <h1><APP_NAME></h1>
    <p><DESCRIPTION></p>
  </div>
</body>
</html>
```

---

## Step 4 — Pulumi infra

**`../<APP_NAME>/infra/pulumi/__main__.py`:**
```python
"""
<APP_NAME> — <APP_NAME>.<DOMAIN>
S3 + CloudFront SPA. DNS via shared ingress stack.
"""
import pulumi
from pulumi_static_site import StaticSite

config = pulumi.Config()
domain = config.get("domain") or "<APP_NAME>.<DOMAIN>"

ingress = pulumi.StackReference("<INGRESS_STACK_REF>")
zone_id = ingress.get_output("zone_id")

site = StaticSite(
    "<APP_NAME>",
    domain=domain,
    zone_id=zone_id,
    bucket_name="<BUCKET_PREFIX><APP_NAME>",
    spa_mode=True,
)

pulumi.export("bucket",            site.bucket_name)
pulumi.export("distribution_id",   site.distribution_id)
pulumi.export("cloudfront_domain", site.distribution_domain.apply(lambda d: f"https://{d}"))
pulumi.export("aws_region",        pulumi.Config("aws").require("region"))
```

**`../<APP_NAME>/infra/pulumi/Pulumi.yaml`:**
```yaml
name: <GITHUB_OWNER>-<APP_NAME>
runtime: python
description: <APP_NAME> — <APP_NAME>.<DOMAIN>
```

**`../<APP_NAME>/infra/pulumi/Pulumi.prod.yaml`:**
```yaml
config:
  aws:region: <AWS_REGION>
  <GITHUB_OWNER>-<APP_NAME>:domain: <APP_NAME>.<DOMAIN>
```

**`../<APP_NAME>/infra/pulumi/requirements.txt`:**
```
pulumi>=3,<4
pulumi-aws>=6,<7
pulumi-static-site @ git+https://github.com/lukerohde/pulumi-static-site.git@v0.1.0
```

**`../<APP_NAME>/infra/pulumi/Dockerfile`:**
Copy from `infra/pulumi/Dockerfile` in this repo.

---

## Step 5 — Makefile

**`../<APP_NAME>/Makefile`:**
```makefile
.DEFAULT_GOAL := help

ifneq (,$(wildcard .env))
  include .env
  export
endif

PULUMI_YES := $(if $(CI),--yes,)

.PHONY: help
help:
	@grep -E '^[a-zA-Z_/-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-24s\033[0m %s\n", $$1, $$2}'

.PHONY: infra-preview
infra-preview: ## Preview infra changes
	docker compose build pulumi
	docker compose run --rm pulumi preview

.PHONY: infra-up
infra-up: ## Apply infra changes
	docker compose build pulumi
	docker compose run --rm pulumi up $(PULUMI_YES)

.PHONY: infra-destroy
infra-destroy: ## Destroy infra ⚠️  careful
	docker compose run --rm pulumi destroy $(PULUMI_YES)

.PHONY: infra-outputs
infra-outputs: ## Show stack outputs (bucket, CF distribution ID)
	docker compose run --rm pulumi stack output

.PHONY: deploy
deploy: ## Sync to S3 + invalidate CloudFront
	@BUCKET=$${BUCKET:-$$(docker compose run --rm -T pulumi stack output bucket 2>/dev/null | tail -1)}; \
	CFID=$${CF_DISTRIBUTION_ID:-$$(docker compose run --rm -T pulumi stack output distribution_id 2>/dev/null | tail -1)}; \
	test -n "$$BUCKET" || { echo "❌  Run 'make infra-up' first"; exit 1; }; \
	echo "→ Deploying to $$BUCKET"; \
	docker compose run --rm awscli s3 sync /app/ s3://$$BUCKET --delete \
		--exclude '.git/*' --exclude 'infra/*' --exclude '.env' --exclude '*.DS_Store'; \
	docker compose run --rm awscli cloudfront create-invalidation \
		--distribution-id $$CFID --paths '/*'
```

---

## Step 6 — docker-compose.yml

**`../<APP_NAME>/docker-compose.yml`:**
```yaml
services:
  pulumi:
    build: ./infra/pulumi
    working_dir: /infra
    volumes:
      - ./infra/pulumi:/infra
      - pulumi_plugins:/root/.pulumi/plugins
    env_file:
      - path: .env
        required: false
    environment:
      AWS_ACCESS_KEY_ID: ${AWS_ACCESS_KEY_ID:-}
      AWS_SECRET_ACCESS_KEY: ${AWS_SECRET_ACCESS_KEY:-}
      AWS_SESSION_TOKEN: ${AWS_SESSION_TOKEN:-}
      PULUMI_ACCESS_TOKEN: ${PULUMI_ACCESS_TOKEN:-}
      PULUMI_STACK: ${PULUMI_STACK:-prod}
      PULUMI_SKIP_UPDATE_CHECK: "true"

  awscli:
    image: amazon/aws-cli:2.17.0
    volumes:
      - .:/app
    working_dir: /app
    env_file:
      - path: .env
        required: false
    environment:
      AWS_ACCESS_KEY_ID: ${AWS_ACCESS_KEY_ID:-}
      AWS_SECRET_ACCESS_KEY: ${AWS_SECRET_ACCESS_KEY:-}
      AWS_SESSION_TOKEN: ${AWS_SESSION_TOKEN:-}
      AWS_DEFAULT_REGION: ${AWS_DEFAULT_REGION:-}

volumes:
  pulumi_plugins:
```

---

## Step 7 — CI/CD workflows

**`../<APP_NAME>/.github/workflows/deploy-infra.yml`:**
```yaml
name: Deploy Infrastructure

on:
  push:
    branches: [main]
    paths: ["infra/pulumi/**"]
  pull_request:
    paths: ["infra/pulumi/**"]
  workflow_dispatch:

permissions:
  id-token: write
  contents: read

jobs:
  infra:
    name: Infra ${{ github.event_name == 'pull_request' && 'Preview' || 'Up' }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pulumi/setup-pulumi@v2

      - name: Get infra role ARN
        id: roles
        env:
          PULUMI_ACCESS_TOKEN: ${{ secrets.PULUMI_ACCESS_TOKEN }}
        run: |
          pulumi login
          echo "INFRA_ROLE_ARN=$(pulumi stack output infra_role_arn -s <INGRESS_STACK_REF>)" >> $GITHUB_OUTPUT
          echo "AWS_REGION=$(pulumi stack output aws_region -s <INGRESS_STACK_REF>)" >> $GITHUB_OUTPUT

      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ steps.roles.outputs.INFRA_ROLE_ARN }}
          aws-region: ${{ steps.roles.outputs.AWS_REGION }}

      - name: Preview
        env:
          PULUMI_ACCESS_TOKEN: ${{ secrets.PULUMI_ACCESS_TOKEN }}
        run: make infra-preview

      - name: Apply
        if: github.ref == 'refs/heads/main' && github.event_name != 'pull_request'
        env:
          PULUMI_ACCESS_TOKEN: ${{ secrets.PULUMI_ACCESS_TOKEN }}
        run: make infra-up
```

**`../<APP_NAME>/.github/workflows/deploy-site.yml`:**
```yaml
name: Deploy Site

on:
  push:
    branches: [main]
    paths: ["index.html", "*.css", "*.js", "src/**", "public/**"]
  workflow_dispatch:

permissions:
  id-token: write
  contents: read

jobs:
  deploy:
    name: Deploy
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pulumi/setup-pulumi@v2

      - name: Get config from Pulumi
        id: config
        env:
          PULUMI_ACCESS_TOKEN: ${{ secrets.PULUMI_ACCESS_TOKEN }}
        run: |
          pulumi login
          echo "DEPLOY_ROLE_ARN=$(pulumi stack output deploy_role_arn -s <INGRESS_STACK_REF>)" >> $GITHUB_OUTPUT
          echo "BUCKET=$(pulumi stack output bucket -s <PULUMI_ORG>/<GITHUB_OWNER>-<APP_NAME>/prod)" >> $GITHUB_OUTPUT
          echo "CF_DISTRIBUTION_ID=$(pulumi stack output distribution_id -s <PULUMI_ORG>/<GITHUB_OWNER>-<APP_NAME>/prod)" >> $GITHUB_OUTPUT
          echo "AWS_REGION=$(pulumi stack output aws_region -s <PULUMI_ORG>/<GITHUB_OWNER>-<APP_NAME>/prod)" >> $GITHUB_OUTPUT

      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ steps.config.outputs.DEPLOY_ROLE_ARN }}
          aws-region: ${{ steps.config.outputs.AWS_REGION }}

      - name: Deploy
        env:
          BUCKET: ${{ steps.config.outputs.BUCKET }}
          CF_DISTRIBUTION_ID: ${{ steps.config.outputs.CF_DISTRIBUTION_ID }}
        run: make deploy
```

---

## Step 8 — .gitignore and .env

**`../<APP_NAME>/.gitignore`:**
```
.env
.pulumi/
__pycache__/
*.pyc
.DS_Store
.vscode/
.idea/
```

Copy `.env` from this repo:
```bash
cp .env ../<APP_NAME>/.env
```

---

## Step 9 — CLAUDE.md (the build plan)

Write `../<APP_NAME>/CLAUDE.md`. This is both the build plan for building this specific
instance AND a template for making it portable to other domains via a `/setup` skill.

```markdown
# <APP_NAME> — Build Plan

## What this project is

TODO: replace this with a description of what <APP_NAME> does and why it exists.

## Status

Hello World is deployed at https://<APP_NAME>.<DOMAIN>.
The infra pipeline is working. Now build the actual product.

## Architecture (already decided — don't re-litigate)

- Standalone repo: `../<APP_NAME>/`
- S3 + CloudFront via `pulumi-static-site` component
- DNS via shared ingress stack: `<INGRESS_STACK_REF>`
- Three Musketeers: all commands via `make` + Docker
- One GitHub secret: `PULUMI_ACCESS_TOKEN` (OIDC handles AWS auth)

## Reference

- Parent project: `<path-to-parent-blog>/` — owns DNS + ingress
- Ingress stack: `<INGRESS_STACK_REF>`
- pulumi-static-site component: `~/pulumi-static-site/pulumi_static_site/component.py`

## Commands

    make deploy        — sync files to S3 + invalidate CloudFront
    make infra-up      — apply infra changes
    make infra-outputs — show bucket name, CF distribution ID

## Build this app

[Replace this section with what the app should actually do.
Be specific — Claude Code reads this and builds it.]

## After building: write the /setup skill

Write `.claude/commands/setup.md` so someone else can deploy their own instance
of this app at a different domain with their own ingress.

The setup.md should:
- Check prerequisites (Docker, gh CLI, AWS credentials, Pulumi token)
- Collect config: their subdomain, their parent ingress stack reference
  (e.g. `theirorg/theirname-ingress/prod`), Pulumi org, bucket prefix
- Patch `infra/pulumi/` files with their values
- Patch `.github/workflows/` with their stack references
- Deploy infra (`make infra-up`) + first deploy (`make deploy`)
- Create GitHub repo, set `PULUMI_ACCESS_TOKEN` secret, push
- Remind them to add a nav link in their parent site

See `~/reads/.claude/commands/setup.md` for a worked example of a more complex
app. For a simple SPA, the setup is much shorter.
```

---

## Step 10 — Deploy

```bash
cd ../<APP_NAME>
make infra-up    # 5-15 min — CloudFront is the slow part
make deploy
```

---

## Step 11 — Create GitHub repo and push

```bash
cd ../<APP_NAME>
git init
git add -A
git commit -m "Initial <APP_NAME> scaffold"

gh repo create <GITHUB_OWNER>/<REPO_NAME> --public --description "<DESCRIPTION>" --source=. --remote=origin

PULUMI_TOKEN=$(grep PULUMI_ACCESS_TOKEN .env | cut -d= -f2)
gh secret set PULUMI_ACCESS_TOKEN --body "$PULUMI_TOKEN" --repo <GITHUB_OWNER>/<REPO_NAME>

git push -u origin main
```

---

## Step 12 — Confirm and hand off

```
✅  <APP_NAME> is live at https://<APP_NAME>.<DOMAIN>

CI: https://github.com/<GITHUB_OWNER>/<REPO_NAME>/actions

To build the actual product:
  cd ../<APP_NAME>
  # Open in Claude Code — it will read CLAUDE.md and build from there

Day-to-day:
  make deploy     — push changes live
  make infra-up   — update infrastructure
  git push        — CI deploys automatically on push to main

To destroy this site:
  make infra-destroy   (run from ../<APP_NAME>/)
```
