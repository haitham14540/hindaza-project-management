# Cloudflare deployment checklist

## 1. Create D1

In Cloudflare Dashboard, open **Workers & Pages > D1 SQL Database**, then create:

`hindaza-project-management-db`

Copy the database ID and replace `00000000-0000-0000-0000-000000000000` in `wrangler.jsonc`.

## 2. Configure the setup secret

In the Worker settings, add an encrypted secret:

- Name: `SETUP_KEY`
- Value: a long random value known only to the system owner

This value is used only when creating the first manager account.

## 3. Apply migrations

From a computer authenticated with Wrangler, run:

```bash
npm ci
npm run db:migrate:remote
```

## 4. Connect GitHub

In **Workers & Pages**, connect the `haitham14540/hindaza-project-management` repository.

- Production branch: `main`
- Deploy command: `npm run deploy`
- Root directory: `/`

Cloudflare installs dependencies before running the deployment.

## 5. Create the first manager

Open the deployed URL and go to `/login`. When the database has no users, the page shows the one-time manager setup form. Enter:

- the `SETUP_KEY`
- manager name
- manager email
- discipline
- a password of at least 10 characters

## 6. Add employees

Sign in as the manager, open **Team**, and add each employee with a temporary password. Send passwords through a secure channel.

## 7. Optional custom domain

From the Worker settings, add a custom domain such as `tasks.eng-bim.com` after the `workers.dev` deployment is verified.
