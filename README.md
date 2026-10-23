# Digem Aggies Internal Requests

A team workspace for part requests and sponsor relationships. Local development uses Express and SQLite; production uses Netlify Functions and Netlify Database (Postgres).

## Run locally

Requires Node.js 22 or later.

```sh
cp .env.example .env
npm install
npm run dev
```

Open the Vite URL shown in the terminal. The development command runs the local Express API on port 3001. The local team invite code is `local-team-code`; set `TEAM_INVITE_CODE` in `.env` to override it. The local Dev invite code is `local-dev-code`; set `DEV_INVITE_CODE` to override it. To send password reset and task assignment emails, configure `RESEND_API_KEY` and `RESEND_FROM` with a verified sender in `.env`; password reset links also use `APP_URL=http://localhost:5173`. Restart the server after changing environment variables.

Useful commands:

```sh
npm test
npm run lint
npm run build
```

## Netlify deployment

1. Connect this repository to your Netlify site and enable **Netlify Database** under the site's **Data & storage** settings. Netlify Database requires a credit-based plan.
2. The repository includes `@netlify/database`, the `/api/*` function at `netlify/functions/api.mjs`, and the initial schema migration at `netlify/database/migrations/0001_initial_schema.sql`. Netlify applies migrations during deploy and provides `NETLIFY_DB_URL` to functions automatically.
3. Set `TEAM_INVITE_CODE` and a different, unique `DEV_INVITE_CODE` as private Netlify Functions runtime environment variables. For password reset and task assignment emails, also set `RESEND_API_KEY` and `RESEND_FROM` (an address on a verified Resend domain); password reset links additionally require `APP_URL` set to your site's public URL. Keep these as server-side secrets; do not expose them as frontend build variables. No `API_ORIGIN`, `PORT`, or `DATABASE_PATH` is needed.
4. Use `npm ci && npm run build` and `dist` as the publish directory; these are configured in `netlify.toml`.
5. Deploy and check `https://<your-site>.netlify.app/api/health` returns `{"status":"ok"}`. Create the first account with the invite code.

Production sign-in, part requests, sponsor leads, and sponsorship records are handled by Netlify Functions and stored in Netlify Database. No Render or separate API server is used. Production sessions use HTTP-only, SameSite=Lax cookies with Secure enabled over HTTPS.

## Data and access

- New member accounts require an invite code and record the member's subteam. A separate `DEV_INVITE_CODE` grants the Dev access tag without replacing the member's subteam. Keep both codes private and distinct. Passwords are stored as salted, derived hashes; sessions expire after seven days.
- Users can request a password-reset link with the “Forgot password?” option on the sign-in page; Dev administrators can also email a user a link from Management. The link expires after 30 minutes; the recipient sets their own password, and using the link signs them out of all sessions. Passwords are never sent by email. Password reset email is delivered by Resend; its free transactional tier currently includes 3,000 emails per month with a 100-per-day limit, and requires a verified sending domain. See [Resend pricing](https://resend.com/pricing) and [verified domains](https://resend.com/docs/dashboard/domains/introduction).
- Signed-in members can update their account name and email from the Account page. Subteam changes require an in-app request and approval from an Exec member or Dev administrator; the current subteam stays active until approval. Exec membership can be assigned by a Dev administrator and cannot be self-selected during sign-up or requested in the app. Existing Exec assignments are preserved, so an administrator should verify them. Account deletion requires the current password, removes the profile, and unassigns their tasks while preserving shared records.
- Dev administrators see a Management tab for editing any user’s name, email, subteam (including Exec), and access tag (Member or STL), and editing all fields on part requests, sponsorships, and sponsor leads. The Dev tag itself is only granted by the unique Dev invite code.
- Any signed-in team member can read and submit shared requests, sponsor leads, and sponsorships. Only users with the STL or Dev access tag can edit or delete these records and change task assignments. Dev users can assign any team member; STL users can assign members of their own subteam. An STL user in Exec keeps Exec assignment access, including assignments to Business or the task’s originating subteam.
- Sponsor leads can include multiple support types: financial contributions, parts and materials, equipment, services or expertise, and other offers. The cash estimate is optional.
- CSV export opens in Excel or Google Sheets, but it is a snapshot rather than live spreadsheet synchronization.
- Existing data in the local SQLite database is not automatically migrated into Netlify Database; export or migrate it before cutover if it needs to be kept.
- The initial deployment starts with empty shared tables; add team records after creating the first account.# Digemaggiesinternal
# Digemaggiesinternal
