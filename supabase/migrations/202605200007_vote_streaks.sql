-- Atomic vote-streak accounting. Replaces the previous read-then-write in the
-- vote route, which could lose counts under concurrent votes and never advanced
-- current_streak/longest_streak. A single upsert keeps the counters consistent
-- and computes the consecutive streak from the gap since the last vote.

create or replace function public.apply_vote_streak(
  p_user_id uuid,
  p_minecraft_uuid text,
  p_minecraft_username text,
  p_month_key text,
  p_voted_at timestamptz
)
returns table(
  current_streak integer,
  longest_streak integer,
  monthly_votes integer,
  total_votes integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.vote_streaks (
    user_id, minecraft_uuid, minecraft_username,
    current_streak, longest_streak, monthly_votes, total_votes,
    last_vote_at, month_key
  )
  values (
    p_user_id, p_minecraft_uuid, p_minecraft_username,
    1, 1, 1, 1, p_voted_at, p_month_key
  )
  on conflict (minecraft_username, month_key) do update
  set
    current_streak = case
      when public.vote_streaks.last_vote_at is not null
           and public.vote_streaks.last_vote_at >= excluded.last_vote_at - interval '48 hours'
      then public.vote_streaks.current_streak + 1
      else 1
    end,
    longest_streak = greatest(
      public.vote_streaks.longest_streak,
      case
        when public.vote_streaks.last_vote_at is not null
             and public.vote_streaks.last_vote_at >= excluded.last_vote_at - interval '48 hours'
        then public.vote_streaks.current_streak + 1
        else 1
      end
    ),
    monthly_votes = public.vote_streaks.monthly_votes + 1,
    total_votes = public.vote_streaks.total_votes + 1,
    last_vote_at = excluded.last_vote_at,
    user_id = coalesce(excluded.user_id, public.vote_streaks.user_id),
    minecraft_uuid = coalesce(excluded.minecraft_uuid, public.vote_streaks.minecraft_uuid)
  returning
    vote_streaks.current_streak,
    vote_streaks.longest_streak,
    vote_streaks.monthly_votes,
    vote_streaks.total_votes
  into current_streak, longest_streak, monthly_votes, total_votes;

  return next;
end;
$$;

revoke all on function public.apply_vote_streak(uuid, text, text, text, timestamptz) from public;
revoke all on function public.apply_vote_streak(uuid, text, text, text, timestamptz) from anon;
revoke all on function public.apply_vote_streak(uuid, text, text, text, timestamptz) from authenticated;
grant execute on function public.apply_vote_streak(uuid, text, text, text, timestamptz) to service_role;
