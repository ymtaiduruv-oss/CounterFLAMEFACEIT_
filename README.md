# Counterflame FACEIT — full-stack starter

A starter kit for a Counterflame competitive platform built with Next.js App Router + Supabase.

## Included
- Supabase email/password authentication
- Player profiles and leaderboard
- Server-side ELO result processing (transactional Postgres RPC)
- Matchmaking queue and basic 5v5 lobby creation RPC
- Team creation and membership
- Admin-only player suspension and match result reporting
- Row Level Security (RLS)
- Vercel deployment notes

## Important limits
This is a secure-oriented starter, not a complete production FACEIT clone. Matchmaking creates a lobby record; it does not launch a Counterflame game server. Use an authoritative game server or trusted match-admin process to verify scores before reporting results. Never expose the Supabase service-role key in browser code. The sample admin action is a starting point; add audit logs, rate limits, anti-cheat and dispute handling before public launch.

## 1. Requirements
- Node.js 20+
- A Supabase project
- A Vercel account for deployment (optional)

## 2. Install
```bash
npm install
cp .env.example .env.local
```
Fill in the Supabase project URL and anon/publishable key. Do not put the service-role key in `NEXT_PUBLIC_*`.

## 3. Database setup
In Supabase Dashboard → SQL Editor, run `supabase/schema.sql` once.

Then create your first account through the site. In Supabase → Authentication → Users, copy its UUID. In SQL Editor, grant admin privileges to that exact UUID:
```sql
update public.profiles set role = 'admin' where id = 'YOUR_AUTH_USER_UUID';
```
Never let users set their own role from the client. Keep admin changes restricted to trusted project owners.

## 4. Run locally
```bash
npm run dev
```
Open http://localhost:3000.

## 5. Auth redirect configuration
In Supabase → Authentication → URL Configuration:
- Site URL: your local URL while developing, then your deployed domain
- Redirect URLs: `http://localhost:3000/**` and your exact Vercel domain, e.g. `https://your-project.vercel.app/**`

## 6. Deploy to Vercel
1. Push this project to a private GitHub repository.
2. Import it in Vercel.
3. Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (or publishable key) to Vercel Project → Settings → Environment Variables.
4. Deploy and add the production URL to Supabase Auth redirect URLs.
5. Test sign-up, sign-in, queue, team creation and admin permissions.

## Security checklist before public launch
- Enable Supabase email confirmation and configure SMTP.
- Add CAPTCHA / rate limiting for auth and queue endpoints.
- Use authoritative game-server results; do not trust client-submitted scores.
- Add audit logs, match dispute flow, ban appeal flow and monitoring.
- Restrict admin access and enable MFA for admin accounts.
- Review RLS policies and test with non-admin accounts.
- Add backups and retention policies.
