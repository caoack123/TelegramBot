create table if not exists public.chat_messages (
  id bigint generated always as identity primary key,
  chat_id bigint not null,
  role text not null check (role in ('user', 'model')),
  parts jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_chat_id_id_idx
  on public.chat_messages (chat_id, id desc);

alter table public.chat_messages enable row level security;
revoke all on table public.chat_messages from anon, authenticated;
grant all on table public.chat_messages to service_role;
grant usage, select on sequence public.chat_messages_id_seq to service_role;

insert into public.chat_messages (chat_id, role, parts, created_at)
select
  substring(s.key from '^history_(-?[0-9]+)$')::bigint,
  case when item.value->>'role' = 'model' then 'model' else 'user' end,
  coalesce(item.value->'parts', '[]'::jsonb),
  s.updated_at + ((item.ordinality - 1) * interval '1 millisecond')
from public.app_state s
cross join lateral jsonb_array_elements(s.value) with ordinality as item(value, ordinality)
where s.key ~ '^history_-?[0-9]+$'
  and jsonb_typeof(s.value) = 'array'
  and not exists (
    select 1 from public.chat_messages existing
    where existing.chat_id = substring(s.key from '^history_(-?[0-9]+)$')::bigint
  );

update public.chat_messages message
set parts = jsonb_build_array(jsonb_build_object(
  'text',
  trim(regexp_replace(
    coalesce((
      select string_agg(part->>'text', E'\n')
      from jsonb_array_elements(message.parts) part
      where part ? 'text'
    ), ''),
    E'\\[(PHOTO|IMAGE|图片|照片|VIDEO|视频|VOICE)[:：][^\\]]*\\]',
    '',
    'gi'
  ))
));

delete from public.app_state where key ~ '^history_-?[0-9]+$';
