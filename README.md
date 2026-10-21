# Digem Aggies Internal Requests

A team workspace for part requests and sponsor relationships. Local development uses Express and SQLite; production uses Netlify Functions and Netlify Database (Postgres).

## Run locally

Requires Node.js 22 or later.

```sh
npm install
npm run dev
```

Open the Vite URL shown in the terminal. The development command runs the local Express API on port 3001. New local member accounts use the development invite code `digem-dev-invite` unless `TEAM_INVITE_CODE` is set in `.env`. Set `DEV_INVITE_CODE` to a different private code for local Dev administrator access.

Useful commands:

```sh
npm test
npm run lint
npm run build
```

## Netlify deployment

1. Connect this repository to your Netlify site and enable **Netlify Database** under the site's **Data & storage** settings. Netlify Database requires a credit-based plan.
2. The repository includes `@netlify/database`, the `/api/*` function at `netlify/functions/api.mjs`, and the initial schema migration at `netlify/database/migrations/0001_initial_schema.sql`. Netlify applies migrations during deploy and provides `NETLIFY_DB_URL` to functions automatically.
3. Set `TEAM_INVITE_CODE` and a different, unique `DEV_INVITE_CODE` as private Netlify Functions runtime environment variables. Do not set them as frontend build variables. No `API_ORIGIN`, `PORT`, or `DATABASE_PATH` is needed.
4. Use `npm ci && npm run build` and `dist` as the publish directory; these are configured in `netlify.toml`.
5. Deploy and check `https://<your-site>.netlify.app/api/health` returns `{"status":"ok"}`. Create the first account with the invite code.

Production sign-in, part requests, sponsor leads, and sponsorship records are handled by Netlify Functions and stored in Netlify Database. No Render or separate API server is used. Production sessions use HTTP-only, SameSite=Lax cookies with Secure enabled over HTTPS.

## Data and access

- New member accounts require an invite code and record the member's subteam. A separate `DEV_INVITE_CODE` grants the Dev access tag without replacing the member's subteam. Keep both codes private and distinct. Passwords are stored as salted, derived hashes; sessions expire after seven days.
- Signed-in members can update their account name and email from the Account page. Subteam changes require an in-app request and approval from an Exec member or Dev administrator; the current subteam stays active until approval. Exec membership can be assigned by a Dev administrator and cannot be self-selected during sign-up or requested in the app. Existing Exec assignments are preserved, so an administrator should verify them. Account deletion requires the current password, removes the profile, and unassigns their tasks while preserving shared records.
- Dev administrators see a Management tab for editing any user’s name, email, and subteam (including Exec), and editing all fields on part requests, sponsorships, and sponsor leads. The Dev tag itself is only granted by the unique Dev invite code.
- Any signed-in team member can read and update shared requests, sponsor leads, and sponsorships. Everyone can see task assignments; Business members and members of the original requester's subteam can assign themselves, Exec members can assign another eligible person, and Dev administrators can assign any team member. Eligible Exec assignees belong to the Business subteam or the original requester's subteam. There is no password-reset flow yet.
- Members can delete part requests and sponsor leads after confirming; sponsorship records remain separate.
- Sponsor leads can include multiple support types: financial contributions, parts and materials, equipment, services or expertise, and other offers. The cash estimate is optional.
- CSV export opens in Excel or Google Sheets, but it is a snapshot rather than live spreadsheet synchronization.
- Existing data in the local SQLite database is not automatically migrated into Netlify Database; export or migrate it before cutover if it needs to be kept.
- The initial deployment starts with empty shared tables; add team records after creating the first account.# digemaggiesinternal
# digemaggiesinternal
