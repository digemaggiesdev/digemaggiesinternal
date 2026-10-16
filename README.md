# Digem Aggies Internal Requests

A team workspace for part requests and sponsor relationships. Members sign in to a shared SQLite-backed API; part status, seller communication, donor commitments, deliverables, and renewal dates are saved on the server.

## Run locally

Requires Node.js 22 or later.

```sh
npm install
npm run dev
```

Open the Vite URL shown in the terminal. The development command runs the API on port 3001 and proxies `/api` calls from the web app. New local accounts use the development invite code `digem-dev-invite` unless `TEAM_INVITE_CODE` is set in `.env`.

Useful commands:

```sh
npm test
npm run lint
npm run build
```

## Production deployment

Build and run the app/API together on one server with persistent disk storage:

```sh
npm run build
NODE_ENV=production TEAM_INVITE_CODE='use-a-long-random-secret' DATABASE_PATH='/path/on/persistent-disk/digem.sqlite' npm start
```

Set `PORT` if the host requires a specific port. Set a strong, private `TEAM_INVITE_CODE` before exposing account registration. Serve the app over HTTPS; production sessions use secure, HTTP-only cookies. Keep the SQLite database on persistent storage and back up that file regularly. This SQLite setup is intended for one application server, not multiple server replicas sharing an ephemeral filesystem.

## Data and access

- New member accounts require an invite code. Passwords are stored as salted, derived hashes; sessions expire after seven days.
- Any signed-in team member can read and update the shared requests, sponsor leads, and sponsorships. There are no role-based permissions or password-reset flow yet.
- Members can delete part requests and sponsor leads after confirming; sponsorship records remain separate.
- Sponsor leads can include multiple support types: financial contributions, parts and materials, equipment, services or expertise, and other offers. The cash estimate is optional.
- CSV export opens in Excel or Google Sheets, but it is a snapshot rather than live spreadsheet synchronization.
- Existing entries previously saved only in a browser are not automatically migrated into SQLite.
- The initial deployment starts with empty shared tables; add team records after creating the first account.# digemaggiesinternal
# digemaggiesinternal
