# BuddyTrip

Mobile-first group trip planning and competition scoring app. Plan trips with your crew, vote on destinations, manage logistics, and run Ryder Cup-style golf competitions with live scoring and leaderboards.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 15 (App Router) |
| UI | React 18 + Tailwind v4 |
| API | tRPC v11 + TanStack Query v5 |
| Database | Supabase (Postgres + Row Level Security) |
| Auth | Supabase Auth (email/password) |
| Realtime | Supabase Realtime |
| Validation | Zod |
| Testing | Vitest + Playwright |
| Deployment | Vercel |

## Local Development

```bash
# Clone the repo
git clone https://github.com/zgrether/buddytrip.git
cd buddytrip

# Install dependencies
npm install

# Set up environment variables
cp .env.local.example .env.local
# Fill in your Supabase credentials (see below)

# Start local Supabase (requires Docker)
npx supabase start

# Run the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Environment Variables

| Variable | Description |
|----------|------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server-side only) |

## Screens

| Screen | Route | Description |
|--------|-------|------------|
| Dashboard | `/dashboard` | Trip cards grouped by status, notification bell |
| New Trip | `/trips/new` | 2-step creation wizard |
| Trip Detail | `/trips/[tripId]` | 5-tab layout (Home, Schedule, Crew, Comp, More) |
| Idea Comparison | `/trips/[tripId]/compare` | Side-by-side destination voting |
| Competition Setup | `/trips/[tripId]/competition/setup` | Team builder, round builder, player assignment |
| Trip Messages | `/trips/[tripId]/messages` | Trip chat + team chat |
| Live Leaderboard | `/trips/[tripId]/leaderboard` | Live scores, groups, round history |

## Spec Repository

The visual and data specs live in [`buddytripworkflow`](https://github.com/zgrether/buddytripworkflow) (read-only):

| Document | Purpose |
|----------|---------|
| `buddytrip-2.html` | Visual spec — open in browser, match screen-for-screen |
| `types.ts` | Data spec — every interface maps to a Supabase table |
| `SCHEMA.md` | Database schema reference |
| `PERMISSIONS.md` | Auth spec — who can do what (3-tier: Owner/Planner/Member) |
| `REALTIME.md` | Which features use Realtime vs polling |
| `SCORING_PLAYBOOK.md` | Competition scoring rules and round lifecycle |

## Development Status

See [PLAN_OF_ATTACK.md](./PLAN_OF_ATTACK.md) for the full development plan and current progress.
