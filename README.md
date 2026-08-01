# HINDAZA Project Management

An Arabic-first project, task, team, and performance management application for HINDAZA Engineering BIM.

## Platform

- Cloudflare Workers
- Cloudflare D1
- Vinext / React
- GitHub-connected automatic deployments

## Security model

The application has its own email/password authentication and does not require ChatGPT seats. Passwords are stored as PBKDF2-SHA256 hashes with unique salts. Login sessions use hashed random tokens in D1 and `HttpOnly`, `SameSite=Strict` cookies.

## First Cloudflare deployment

1. Create a D1 database named `hindaza-project-management-db`.
2. Copy its database ID into `wrangler.jsonc`, replacing the all-zero placeholder.
3. Add a Worker secret named `SETUP_KEY`. Use a long random value and do not commit it.
4. Apply the database migrations with `npm run db:migrate:remote`.
5. Connect this repository to Cloudflare Workers Builds and use `npm run deploy` as the deploy command.
6. Open `/login`, choose the first-manager setup form, and enter the same setup key once.

After the first manager is created, the setup form is disabled. Managers can add employee accounts, assign roles and disciplines, and reset passwords from the Team screen.

Detailed dashboard instructions are in [CLOUDFLARE_DEPLOYMENT.md](./CLOUDFLARE_DEPLOYMENT.md).

## Local development

```bash
npm ci
cp .dev.vars.example .dev.vars
npm run dev
```

Do not commit `.dev.vars` or any real secret.
