# aws-self-hosting-ai

Personal blog on AWS, set up and managed by Claude.

## Quick start

```bash
git clone https://github.com/lukerohde/aws-self-hosting-ai my-blog
cd my-blog
claude
```

Claude will detect the fresh clone and walk you through the complete setup:
AWS credentials → Pulumi Cloud → domain → deploy infra → live blog.

## What you'll end up with

- Blog at your domain (e.g. `will.dev`)
- S3 + CloudFront CDN + HTTPS (auto-renewed cert)
- GitHub CI/CD — push to main → deploys automatically
- No long-lived AWS keys in CI (GitHub OIDC federation)
- Everything runs in Docker — no tools to install beyond Docker + Claude

## Prerequisites

| Tool | Install |
|------|---------|
| Docker Desktop | https://www.docker.com/products/docker-desktop |
| Claude Code | https://claude.ai/download |
| GitHub account | https://github.com |
| AWS account | https://aws.amazon.com/free |
| Pulumi Cloud account | https://app.pulumi.com/signup |
| A domain name | Namecheap or AWS Route53 (see below) |

### Getting a domain

Claude can check availability and **buy a domain for you via AWS Route53** during `/setup` —
just say "I don't have one yet" and give it a name to check. Route53 purchases automatically
wire up DNS, skipping the manual nameserver delegation step.

If you already have a domain elsewhere (Namecheap, GoDaddy, etc.) that's fine too —
you'll point its nameservers at Route53 during setup (~5 min).

## After setup

```bash
make dev                   # local dev server → http://localhost:4321
make draft IDEA=my-idea    # start a new post
make publish POST=my-post  # mark post ready to publish
make deploy                # build + push to S3

# Claude slash commands (run claude in this directory)
/draft my-idea             # AI-assisted drafting
/publish my-post           # publish with one command
/new-spa                   # add a new app at a subdomain
/teardown                  # destroy all AWS infrastructure
```

## Architecture

```
Route53 hosted zone (your domain)
├── GitHub OIDC provider    — CI deploys without AWS keys
├── IAM deploy role         — S3 sync + CloudFront invalidation (main branch)
├── IAM infra role          — full site lifecycle (all branches, for PR previews)
├── S3 bucket               — blog content
├── CloudFront distribution — HTTPS CDN, global edge
└── ACM certificate         — auto-renewed TLS

GitHub repo
└── CI/CD — preview on PR, deploy on merge to main
```

Two Pulumi stacks:
1. **Ingress** (`infra/pulumi-ingress/`) — Route53 + OIDC + IAM. Deploy once.
2. **Site** (`infra/pulumi/`) — S3 + CloudFront + ACM. Deploy after ingress.

Adding a new subdomain app? Run `/new-spa` — it reuses the ingress stack.

## Phone-based blogging

With Claude Desktop on your Mac and Claude on iOS/Android:
1. Pair them in Claude settings (2 minutes)
2. Open Claude on your phone
3. "Hey, I have an idea for a post about X — can you draft it?"
4. Claude drafts it, you review on your phone, say "looks good, publish it"
5. Claude runs `make publish` + `git push` — your post is live

## Costs (approximate)

All AWS services used are pay-per-use:
- Route53 hosted zone: $0.50/month
- S3 storage: ~$0.01-0.10/month (depends on content size)
- CloudFront: free tier covers most personal blog traffic
- ACM certificate: free

**Total: ~$1-2/month** for a typical personal blog.

## Teardown

To destroy all AWS infrastructure:
```bash
# Via Claude
/teardown

# Or manually
make infra-destroy          # destroy site stack first
make infra-ingress-destroy  # then ingress stack
```

Your code and posts are never deleted — just the AWS resources.
