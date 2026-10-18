-- Counterflame FACEIT starter schema. Run once in Supabase SQL Editor.
create extension if not exists pgcrypto;

create type public.app_role as enum ('player','admin');
create type public.match_status as enum ('pending','ready','completed','cancelled');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null unique check (char_length(nickname) between 3 and 18),
  elo integer not null default 1000 check (elo between 0 and 100000),
  wins integer not null default 0 check (wins >= 0),
  losses integer not null default 0 check (losses >= 0),
  role public.app_role not null default 'player',
  suspended boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 2 and 28),
  captain_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table public.team_members (
  team_id uuid not null references public.teams(id) on delete cascade,
  player_id uuid not null references public.profiles(id) on delete cascade,
  team_role text not null default 'member' check (team_role in ('captain','member')),
  joined_at timestamptz not null default now(),
  primary key(team_id, player_id)
);
create table public.matches (
  id uuid primary key default gen_random_uuid(),
  map_name text not null default 'TBD',
  status public.match_status not null default 'pending',
  team_a_id uuid references public.teams(id) on delete set null,
  team_b_id uuid references public.teams(id) on delete set null,
  team_a_name text,
  team_b_name text,
  team_a_score integer check (team_a_score is null or team_a_score >= 0),
  team_b_score integer check (team_b_score is null or team_b_score >= 0),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  reported_by uuid references public.profiles(id)
);
create table public.match_players (
  match_id uuid not null references public.matches(id) on delete cascade,
  player_id uuid not null references public.profiles(id) on delete cascade,
  team_side text not null check (team_side in ('A','B')),
  elo_before integer,
  elo_after integer,
  primary key(match_id, player_id)
);
create table public.matchmaking_queue (
  player_id uuid primary key references public.profiles(id) on delete cascade,
  queued_at timestamptz not null default now()
);
create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id),
  action text not null,
  target_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index profiles_elo_idx on public.profiles(elo desc);
create index matches_created_idx on public.matches(created_at desc);
create index queue_time_idx on public.matchmaking_queue(queued_at);

-- Automatically create a profile after signup. Nickname metadata is sanitized by length/constraint.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare chosen_name text;
begin
  chosen_name := coalesce(nullif(trim(new.raw_user_meta_data ->> 'nickname'), ''), 'player_' || substr(new.id::text,1,8));
  chosen_name := left(regexp_replace(chosen_name, '[^a-zA-Z0-9_-]', '', 'g'), 18);
  if char_length(chosen_name) < 3 then chosen_name := 'player_' || substr(new.id::text,1,8); end if;
  insert into public.profiles(id,nickname) values(new.id,chosen_name)
  on conflict (id) do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists(select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin' and p.suspended = false); $$;

alter table public.profiles enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.matches enable row level security;
alter table public.match_players enable row level security;
alter table public.matchmaking_queue enable row level security;
alter table public.audit_logs enable row level security;

create policy "Profiles visible to everyone" on public.profiles for select using (true);
create policy "Player updates own non-sensitive profile fields" on public.profiles for update
using (id = auth.uid() and suspended = false) with check (id = auth.uid() and role = 'player' and suspended = false);
-- Column-level restriction: grant only nickname update, not ELO/role/wins/suspension.
revoke update on public.profiles from authenticated;
grant update(nickname) on public.profiles to authenticated;

create policy "Teams are public" on public.teams for select using (true);
create policy "Signed-in players create teams as captain" on public.teams for insert to authenticated
with check (captain_id = auth.uid() and exists(select 1 from public.profiles p where p.id=auth.uid() and not p.suspended));
create policy "Captain can rename own team" on public.teams for update to authenticated
using (captain_id=auth.uid()) with check (captain_id=auth.uid());
create policy "Captain can delete own team" on public.teams for delete to authenticated using (captain_id=auth.uid());

create policy "Team memberships are public" on public.team_members for select using (true);
create policy "Player can join self as member" on public.team_members for insert to authenticated
with check (player_id=auth.uid() and team_role='member');
create policy "Player can leave own team" on public.team_members for delete to authenticated using (player_id=auth.uid());

create policy "Matches visible to everyone" on public.matches for select using (true);
create policy "Match players visible to everyone" on public.match_players for select using (true);
create policy "Queue visible to self only" on public.matchmaking_queue for select to authenticated using (player_id=auth.uid());
create policy "Audit logs admin only" on public.audit_logs for select to authenticated using (public.is_admin());

-- Create a team and add its captain atomically. Prevents creating a captainless team.
create or replace function public.create_team(p_name text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare uid uuid := auth.uid(); new_id uuid; clean_name text := trim(p_name);
begin
  if uid is null then raise exception 'Sign in required'; end if;
  if char_length(clean_name) < 2 or char_length(clean_name) > 28 then raise exception 'Team name must be 2–28 characters'; end if;
  if not exists(select 1 from public.profiles where id=uid and not suspended) then raise exception 'Account unavailable'; end if;
  if exists(select 1 from public.team_members where player_id=uid) then raise exception 'Leave your current team before creating another'; end if;
  insert into public.teams(name,captain_id) values(clean_name,uid) returning id into new_id;
  insert into public.team_members(team_id,player_id,team_role) values(new_id,uid,'captain');
  insert into public.audit_logs(actor_id,action,target_id) values(uid,'team.create',new_id);
  return new_id;
end;
$$;

-- Queue in this starter creates a 5-player-per-side lobby (10 queued users).
-- It is a queue/lobby prototype, not a game-server launcher. Lock queue rows to avoid double assignment.
create or replace function public.join_matchmaking_queue()
returns uuid language plpgsql security definer set search_path = ''
as $$
declare uid uuid := auth.uid(); queued_count int; new_match uuid; ids uuid[]; i int;
begin
  if uid is null then raise exception 'Sign in required'; end if;
  if not exists(select 1 from public.profiles where id=uid and not suspended) then raise exception 'Account unavailable'; end if;
  insert into public.matchmaking_queue(player_id) values(uid) on conflict(player_id) do nothing;
  select array_agg(player_id order by queued_at, player_id) into ids
    from (select player_id,queued_at from public.matchmaking_queue order by queued_at,player_id for update skip locked limit 10) q;
  queued_count := coalesce(array_length(ids,1),0);
  if queued_count < 10 then return null; end if;
  insert into public.matches(map_name,status,team_a_name,team_b_name)
    values('TBD','ready','Queue Team A','Queue Team B') returning id into new_match;
  for i in 1..10 loop
    insert into public.match_players(match_id,player_id,team_side,elo_before)
      select new_match, ids[i], case when i <= 5 then 'A' else 'B' end, p.elo
      from public.profiles p where p.id=ids[i]
      on conflict(match_id,player_id) do nothing;
    delete from public.matchmaking_queue where player_id=ids[i];
  end loop;
  return new_match;
end;
$$;

create or replace function public.leave_matchmaking_queue()
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  delete from public.matchmaking_queue where player_id=auth.uid();
end;
$$;

-- Admin-only trusted result reporting. Call only after verifying the actual game result.
-- ELO uses a basic Elo expectation formula with K=32 and does not trust client-supplied ELO.
create or replace function public.admin_report_match(
  p_match_id uuid, p_team_a_score integer, p_team_b_score integer
)
returns void language plpgsql security definer set search_path = ''
as $$
declare m public.matches%rowtype; a_score float; b_score float; rec record; expected float; actual float; new_elo int;
begin
  if not public.is_admin() then raise exception 'Admin permission required'; end if;
  if p_team_a_score < 0 or p_team_b_score < 0 or p_team_a_score = p_team_b_score then raise exception 'Invalid final score'; end if;
  select * into m from public.matches where id=p_match_id for update;
  if not found then raise exception 'Match not found'; end if;
  if m.status='completed' then raise exception 'Match already completed'; end if;
  a_score := case when p_team_a_score > p_team_b_score then 1.0 else 0.0 end;
  b_score := 1.0-a_score;
  for rec in select mp.player_id,mp.team_side,p.elo from public.match_players mp join public.profiles p on p.id=mp.player_id where mp.match_id=p_match_id for update of p loop
    expected := 1.0/(1.0+power(10.0, ((case when rec.team_side='A' then
      (select coalesce(avg(p2.elo),1000) from public.match_players x join public.profiles p2 on p2.id=x.player_id where x.match_id=p_match_id and x.team_side='B')
      else (select coalesce(avg(p2.elo),1000) from public.match_players x join public.profiles p2 on p2.id=x.player_id where x.match_id=p_match_id and x.team_side='A') end)-rec.elo)/400.0));
    actual := case when rec.team_side='A' then a_score else b_score end;
    new_elo := greatest(0, rec.elo + round(32*(actual-expected))::int);
    update public.profiles set elo=new_elo,
      wins=wins+case when actual=1 then 1 else 0 end,
      losses=losses+case when actual=0 then 1 else 0 end
      where id=rec.player_id;
    update public.match_players set elo_before=rec.elo,elo_after=new_elo where match_id=p_match_id and player_id=rec.player_id;
  end loop;
  update public.matches set status='completed',team_a_score=p_team_a_score,team_b_score=p_team_b_score,completed_at=now(),reported_by=auth.uid() where id=p_match_id;
  insert into public.audit_logs(actor_id,action,target_id,details)
    values(auth.uid(),'match.report',p_match_id,jsonb_build_object('team_a_score',p_team_a_score,'team_b_score',p_team_b_score));
end;
$$;

-- Admin can suspend/unsuspend a player. Role changes are deliberately done from SQL by project owners.
create or replace function public.admin_set_suspended(p_player_id uuid,p_suspended boolean)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admin permission required'; end if;
  if p_player_id=auth.uid() then raise exception 'Cannot suspend yourself'; end if;
  update public.profiles set suspended=p_suspended where id=p_player_id;
  if not found then raise exception 'Player not found'; end if;
  if p_suspended then delete from public.matchmaking_queue where player_id=p_player_id; end if;
  insert into public.audit_logs(actor_id,action,target_id,details)
    values(auth.uid(),case when p_suspended then 'player.suspend' else 'player.unsuspend' end,p_player_id,jsonb_build_object('suspended',p_suspended));
end;
$$;

revoke all on function public.create_team(text) from public;
revoke all on function public.join_matchmaking_queue() from public;
revoke all on function public.leave_matchmaking_queue() from public;
revoke all on function public.admin_report_match(uuid,integer,integer) from public;
revoke all on function public.admin_set_suspended(uuid,boolean) from public;
grant execute on function public.create_team(text) to authenticated;
grant execute on function public.join_matchmaking_queue() to authenticated;
grant execute on function public.leave_matchmaking_queue() to authenticated;
grant execute on function public.admin_report_match(uuid,integer,integer) to authenticated;
grant execute on function public.admin_set_suspended(uuid,boolean) to authenticated;

-- NOTE: Review all policies in a staging project before a public launch.
