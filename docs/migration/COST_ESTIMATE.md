# HR MAX — AWS Monthly Cost Estimate

Region: **ap-southeast-2 (Sydney)** — the project's assigned region.
All figures are **estimates** (list prices, on-demand, no savings plans), based on
the current workload: ~1,477 DynamoDB items, 14 users, low request volume.

## Current scale (production today)

| Service | Pricing basis | Current usage | Est. /month |
|---|---|---|---|
| DynamoDB (`HRMAX`, PAY_PER_REQUEST) | ~$1.25/M writes, ~$0.30/M reads (Sydney), $0.25/GB-mo | ~50 MB data, light traffic | **$1 – 4** |
| Lambda (5 functions; API = 1024 MB) | 1M req + 400 GB-s free/mo, then ~$0.0000166667/GB-s | well within free tier | **$0 – 3** |
| API Gateway **HTTP API** | $1.00 /M requests | ~0.5 – 2M req | **$0.50 – 2** |
| Cognito user pool | 50,000 MAUs free | 14 users | **$0** |
| S3 (web + files buckets) | $0.025/GB-mo | < 100 MB | **< $0.10** |
| CloudFront | 1 TB egress + 10M req free/mo | small SPA | **$0** |
| SES | $0.10 /1,000 emails | hundreds of mails | **< $1** |
| CloudWatch Logs | $0.50 /GB ingested | ~1 – 5 GB | **$0.50 – 3** |
| EventBridge (3 cron rules) | 14M free custom events/mo | 3 scheduled rules | **$0** |
| **Total** | | | **≈ $5 – 15 /month** |

## Growth sanity checks

- **10× traffic (≈100 daily users, a few 100k API req/month):** ≈ **$10 – 30/mo**
  (DynamoDB + API GW + Lambda scale linearly and stay cheap at this size).
- **1,000 employees / heavy payroll months:** ≈ **$30 – 75/mo** — DynamoDB and
  CloudWatch Logs are the first two line items that grow.
- **Deliberately excluded** (add only if requirements change): NAT gateway
  (Lambda runs **outside a VPC** — no NAT), WAF (~$5+/mo), DynamoDB
  on-demand → provisioned + auto-scaling (saves ~30–50% above steady load),
  Backup vault charges (on-demand backups are free to store), X-Ray.

## Cost-control notes for this project (new AWS experience)

- Billing, invoices, and any **spend limit** are managed in **AWS Settings →
  Billing** (settings.aws.com), not in the AWS console. Only the project owner
  can set/change the limit. If the project suddenly returns "Access Denied" on
  previously working actions, check whether a spend limit paused it.
- **Free tier:** new projects on the Free plan get the free tier on supported
  services (Cognito, Lambda, DynamoDB, S3, CloudFront all qualify — see the
  Free Tier supported-services list). The estimates above are the worst case
  *after* free tier is exhausted.
- **Right-sizing candidates if costs need trimming:**
  1. API Lambda `MemorySize: 1024` → 512 (cold-start trade-off: slightly
     slower cold starts, ~35% cheaper per invocation).
  2. CloudWatch log retention — set `RetentionInDays` on the five log groups
     (template has none → logs kept forever) to 30/60 days.
  3. DynamoDB → provisioned throughput once usage is steady.
- **Cleanup:** nothing in this migration leaves orphaned billable resources —
  the Firebase service-account key was deleted, the old SES identity deleted,
  and no NAT/VPC/tables beyond `HRMAX` exist. The DynamoDB table + buckets are
  the live production data store (keep).

*Generated: 2026-10-20 as part of the Firebase → AWS migration deliverables.*
