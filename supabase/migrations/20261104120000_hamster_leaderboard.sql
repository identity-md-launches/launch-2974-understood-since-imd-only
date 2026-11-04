-- Hamster Friendship: wallet sign-in, ranked runs and the public Top 100.
--
-- Security model
--   * Every table has row level security on. The browser (anon / publishable key) can read
--     best_scores and the leaderboard_top100 view, and nothing else. It cannot write anything.
--   * All writes go through the Edge Functions in supabase/functions, which use the service role
--     key server-side after checking a wallet signature (auth-verify) and a session token.
--   * Guest play never reaches the database: only signed-in wallets can open a ranked run.

create extension if not exists pgcrypto with schema extensions;

-- Wallets that have signed in at least once. Addresses are stored lowercase.
create table public.players (
  wallet_address text primary key
    check (wallet_address ~ '^0x[0-9a-f]{40}$'),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

-- One-time sign-in challenges. The server writes the exact message; the wallet signs it.
create table public.auth_nonces (
  nonce text primary key check (length(nonce) between 16 and 64),
  wallet_address text not null check (wallet_address ~ '^0x[0-9a-f]{40}$'),
  message text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index auth_nonces_wallet_idx on public.auth_nonces (wallet_address, created_at desc);
create index auth_nonces_expires_idx on public.auth_nonces (expires_at);

-- Sessions issued after a valid signature. Only the SHA-256 of the token is stored.
create table public.wallet_sessions (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  wallet_address text not null references public.players (wallet_address) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index wallet_sessions_wallet_idx on public.wallet_sessions (wallet_address);

-- Ranked runs: opened by run-start (server time), closed once by score-submit.
create table public.game_runs (
  id uuid primary key default gen_random_uuid(),
  wallet_address text not null references public.players (wallet_address) on delete cascade,
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  score integer check (score >= 0),
  seeds integer check (seeds >= 0),
  friends integer check (friends >= 0),
  duration_ms integer check (duration_ms >= 0),
  status text not null default 'open' check (status in ('open', 'accepted', 'rejected')),
  rejected_reason text
);
create index game_runs_wallet_started_idx on public.game_runs (wallet_address, started_at desc);

-- Best score per wallet: the only table the public can read.
create table public.best_scores (
  wallet_address text primary key references public.players (wallet_address) on delete cascade,
  best_score integer not null check (best_score >= 0),
  best_run_id uuid references public.game_runs (id) on delete set null,
  achieved_at timestamptz not null default now(),
  runs_submitted integer not null default 1 check (runs_submitted >= 1),
  updated_at timestamptz not null default now()
);
create index best_scores_rank_idx on public.best_scores (best_score desc, achieved_at asc);

-- Row level security: on everywhere. Only best_scores gets a (read-only) policy.
alter table public.players enable row level security;
alter table public.auth_nonces enable row level security;
alter table public.wallet_sessions enable row level security;
alter table public.game_runs enable row level security;
alter table public.best_scores enable row level security;

revoke all on public.players, public.auth_nonces, public.wallet_sessions, public.game_runs
  from anon, authenticated;
revoke all on public.best_scores from anon, authenticated;
grant select on public.best_scores to anon, authenticated;

create policy "Best scores are public"
  on public.best_scores for select
  to anon, authenticated
  using (true);

-- The public Top 100. Ties go to whoever reached the score first.
create view public.leaderboard_top100
  with (security_invoker = true) as
select
  rank() over (order by b.best_score desc, b.achieved_at asc)::integer as rank,
  b.wallet_address,
  b.best_score,
  b.achieved_at
from public.best_scores b
order by b.best_score desc, b.achieved_at asc
limit 100;

revoke all on public.leaderboard_top100 from anon, authenticated;
grant select on public.leaderboard_top100 to anon, authenticated;

-- Closes an open run and keeps the wallet's best score, atomically.
-- Called only by the score-submit Edge Function (service role).
create or replace function public.record_score(
  p_wallet text,
  p_run uuid,
  p_score integer,
  p_seeds integer,
  p_friends integer,
  p_duration_ms integer
)
returns table (best_score integer, is_new_best boolean, rank integer)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_prev integer;
  v_best integer;
begin
  update game_runs r
     set submitted_at = now(),
         score = p_score,
         seeds = p_seeds,
         friends = p_friends,
         duration_ms = p_duration_ms,
         status = 'accepted'
   where r.id = p_run
     and r.wallet_address = p_wallet
     and r.status = 'open';
  if not found then
    raise exception 'run_not_open' using errcode = 'P0001';
  end if;

  select b.best_score into v_prev
    from best_scores b
   where b.wallet_address = p_wallet
   for update;

  if v_prev is null then
    insert into best_scores (wallet_address, best_score, best_run_id, achieved_at, runs_submitted, updated_at)
    values (p_wallet, p_score, p_run, now(), 1, now());
    v_best := p_score;
  elsif p_score > v_prev then
    update best_scores b
       set best_score = p_score,
           best_run_id = p_run,
           achieved_at = now(),
           runs_submitted = b.runs_submitted + 1,
           updated_at = now()
     where b.wallet_address = p_wallet;
    v_best := p_score;
  else
    update best_scores b
       set runs_submitted = b.runs_submitted + 1,
           updated_at = now()
     where b.wallet_address = p_wallet;
    v_best := v_prev;
  end if;

  return query
  select v_best,
         (v_prev is null or p_score > v_prev),
         (select l.rank from leaderboard_top100 l where l.wallet_address = p_wallet);
end;
$$;

revoke all on function public.record_score(text, uuid, integer, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.record_score(text, uuid, integer, integer, integer, integer)
  to service_role;

-- Housekeeping: drop expired challenges and sessions. Run from the SQL editor or schedule it
-- with pg_cron (see README); the Edge Functions also prune a wallet's own expired rows.
create or replace function public.prune_expired_auth()
returns void
language sql
security definer
set search_path = public
as $$
  delete from auth_nonces where expires_at < now() - interval '1 day';
  delete from wallet_sessions where expires_at < now() - interval '1 day';
  update game_runs set status = 'rejected', rejected_reason = 'expired'
   where status = 'open' and started_at < now() - interval '1 day';
$$;

revoke all on function public.prune_expired_auth() from public, anon, authenticated;
grant execute on function public.prune_expired_auth() to service_role;
