# HR MAX — HR Management Platform (serverless application)

One-Click deploy of the complete HR MAX backend infrastructure on AWS:

- **Cognito** user pool with custom role/company claims (PreTokenGeneration)
- **DynamoDB** single-table design (`HRMAX`) with GSI1/GSI2/GSI3
- **API Gateway (HTTP API)** + **Lambda (Node.js 22, arm64)** REST API
- **S3** file storage bucket with presigned uploads
- **S3 + CloudFront** web hosting for the bundled SPA
- **SES** transactional email (invites, password resets, alerts)
- **EventBridge Scheduler** jobs (attendance sweep, payroll cutoff)

## Parameters

| Parameter  | Default             | Description                                          |
| ---------- | ------------------- | ---------------------------------------------------- |
| AppDomain  | _(empty)_           | Custom domain for CloudFront (empty = default URL)   |
| EmailFrom  | info@hrmax.in       | SES-verified sender address                          |

## After deployment

1. Open the `WebUrl` / `WebDistribution` output — the hosted HR MAX console.
2. Sign up as the first master-admin account, then configure companies,
   roles, and team members from the console.
3. Verify your `EmailFrom` address in SES (and move out of the SES sandbox
   for production email delivery).

> Proprietary software — see LICENSE.txt. Deployment and use are subject to
> the license terms.
