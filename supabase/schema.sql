-- ═══════════════════════════════════════════════════════════════════════
--  RETOMA — banco na nuvem (Supabase / Postgres)
--  Rodar uma vez no SQL Editor do Supabase (pode rodar de novo: é idempotente).
--
--  Ideia:
--   • workspaces       = "negócios" do app. kind 'personal' (só o dono) ou 'store' (loja com equipe)
--   • workspace_members = quem participa: owner (dono), manager (gerente), seller (vendedor)
--   • retomas          = os follow-ups (ativos e concluídos). Nunca são apagados de verdade:
--                        deleted_at marca a exclusão (pra sincronizar entre aparelhos)
--   • profiles         = nome, e-mail, plano e preferências (configurações + mensagens prontas)
--
--  Regras (RLS):
--   • Vendedor vê e edita só os retomas dele dentro da loja
--   • Dono/gerente vê e edita tudo da loja, cria e atribui pra qualquer vendedor
--   • Retoma sem dono (owner_id null) = "carteira sem dono": só dono/gerente vê
--   • Cliente é da loja: quem sai da loja deixa os retomas na carteira sem dono
--   • Conflitos: vale a alteração mais recente (client_updated_at) — "last write wins"
-- ═══════════════════════════════════════════════════════════════════════

-- ─── PERFIS ─────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  email            text,
  display_name     text,
  plan             text not null default 'free',          -- pronto pra planos pagos
  prefs            jsonb not null default '{}'::jsonb,    -- configurações + mensagens prontas
  prefs_updated_at timestamptz not null default to_timestamp(0),
  created_at       timestamptz not null default now()
);

-- Cria o perfil quando a pessoa se cadastra
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─── NEGÓCIOS (workspaces) ──────────────────────────────────────────────
create table if not exists public.workspaces (
  id                uuid primary key,
  name              text not null check (char_length(name) between 1 and 30),
  color             text not null default '#1db954',
  kind              text not null default 'personal' check (kind in ('personal', 'store')),
  fields            jsonb not null default '[]'::jsonb,   -- campos personalizados
  plan              text not null default 'free',
  owner_id          uuid not null references auth.users(id) on delete cascade,
  client_updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at        timestamptz,
  created_at        timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  user_id           uuid not null references auth.users(id) on delete cascade,
  role              text not null default 'seller' check (role in ('owner', 'manager', 'seller')),
  wa_phone          text not null default '',            -- número de WhatsApp desta pessoa neste negócio
  show_in_pill      boolean not null default true,
  archived          boolean not null default false,
  client_updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  joined_at         timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index if not exists wm_user_idx on public.workspace_members(user_id);

-- ─── RETOMAS ────────────────────────────────────────────────────────────
create table if not exists public.retomas (
  id                text primary key,                     -- ids antigos não são UUID
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  owner_id          uuid references auth.users(id) on delete set null,   -- null = carteira sem dono
  created_by        uuid references auth.users(id) on delete set null,
  name              text not null default '',
  phone             text not null default '',
  note              text not null default '',
  date              date,
  time              text not null default '',
  prio              text not null default 'media',
  fields            jsonb,
  value             numeric,
  snoozes           int not null default 0,
  status            text not null default 'active' check (status in ('active', 'done')),
  done_at           timestamptz,
  outcome           text check (outcome in ('won', 'lost')),
  recovered         boolean not null default false,
  client_created_at timestamptz not null default now(),
  client_updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at        timestamptz
);
create index if not exists retomas_ws_idx     on public.retomas(workspace_id, server_updated_at);
create index if not exists retomas_owner_idx  on public.retomas(owner_id);
create index if not exists retomas_sync_idx   on public.retomas(server_updated_at);

-- ─── CONVITES ───────────────────────────────────────────────────────────
create table if not exists public.invites (
  code         text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  role         text not null default 'seller' check (role in ('manager', 'seller')),
  created_by   uuid not null references auth.users(id) on delete cascade,
  expires_at   timestamptz not null default now() + interval '7 days',
  uses_left    int not null default 20,
  created_at   timestamptz not null default now()
);

-- 1.1: convite por e-mail (o código continua existindo como reserva)
alter table public.invites add column if not exists email text;
create index if not exists invites_email_idx on public.invites (lower(email));

-- ─── FUNÇÕES DE APOIO (security definer evita recursão nas regras) ──────
create or replace function public.ws_role(ws uuid) returns text
language sql stable security definer set search_path = public as $$
  select role from public.workspace_members where workspace_id = ws and user_id = auth.uid()
$$;
create or replace function public.is_member(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.workspace_members where workspace_id = ws and user_id = auth.uid())
$$;
create or replace function public.is_manager(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.ws_role(ws) in ('owner', 'manager'), false)
$$;

-- ─── GATILHOS: carimbo do servidor + "vale o mais recente" ─────────────
create or replace function public.sync_stamp() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    -- alteração mais antiga que a guardada é ignorada (outro aparelho já mudou depois)
    if new.client_updated_at < old.client_updated_at then return null; end if;
  end if;
  new.server_updated_at := clock_timestamp();
  return new;
end $$;

drop trigger if exists retomas_stamp on public.retomas;
create trigger retomas_stamp before insert or update on public.retomas
  for each row execute function public.sync_stamp();
drop trigger if exists workspaces_stamp on public.workspaces;
create trigger workspaces_stamp before insert or update on public.workspaces
  for each row execute function public.sync_stamp();
drop trigger if exists members_stamp on public.workspace_members;
create trigger members_stamp before insert or update on public.workspace_members
  for each row execute function public.sync_stamp();

-- retoma: quem criou não muda
create or replace function public.retomas_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    -- pode virar null (conta excluída), mas não pode trocar por outra pessoa
    if new.created_by is not null then new.created_by := old.created_by; end if;
    new.client_created_at := old.client_created_at;
  end if;
  return new;
end $$;
drop trigger if exists retomas_guard on public.retomas;
create trigger retomas_guard before update on public.retomas
  for each row execute function public.retomas_guard();

-- Quem cria o negócio vira dono (membro "owner") automaticamente
create or replace function public.workspace_owner_member() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.workspace_members (workspace_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict (workspace_id, user_id) do update set role = 'owner';
  return new;
end $$;
drop trigger if exists workspace_owner_member on public.workspaces;
create trigger workspace_owner_member after insert on public.workspaces
  for each row execute function public.workspace_owner_member();

-- ─── REGRAS DE ACESSO (RLS) ─────────────────────────────────────────────
alter table public.profiles          enable row level security;
alter table public.workspaces        enable row level security;
alter table public.workspace_members enable row level security;
alter table public.retomas           enable row level security;
alter table public.invites           enable row level security;

drop policy if exists profiles_self on public.profiles;
create policy profiles_self on public.profiles for select using (id = auth.uid());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists ws_select on public.workspaces;
create policy ws_select on public.workspaces for select using (public.is_member(id));
drop policy if exists ws_insert on public.workspaces;
create policy ws_insert on public.workspaces for insert with check (owner_id = auth.uid());
drop policy if exists ws_update on public.workspaces;
create policy ws_update on public.workspaces for update using (public.is_manager(id)) with check (public.is_manager(id));

drop policy if exists wm_select on public.workspace_members;
create policy wm_select on public.workspace_members for select using (public.is_member(workspace_id));
drop policy if exists wm_update_self on public.workspace_members;
create policy wm_update_self on public.workspace_members for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists r_select on public.retomas;
create policy r_select on public.retomas for select using (
  public.is_member(workspace_id) and (owner_id = auth.uid() or public.is_manager(workspace_id))
);
drop policy if exists r_insert on public.retomas;
create policy r_insert on public.retomas for insert with check (
  public.is_member(workspace_id) and (owner_id = auth.uid() or public.is_manager(workspace_id))
);
drop policy if exists r_update on public.retomas;
create policy r_update on public.retomas for update
  using (public.is_member(workspace_id) and (owner_id = auth.uid() or public.is_manager(workspace_id)))
  with check (public.is_member(workspace_id) and (owner_id = auth.uid() or public.is_manager(workspace_id)));

drop policy if exists inv_select on public.invites;
create policy inv_select on public.invites for select using (public.is_manager(workspace_id));

-- Permissões por coluna: ninguém troca dono/plano do negócio nem o próprio papel pelo app
revoke all on public.profiles, public.workspaces, public.workspace_members, public.retomas, public.invites from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, prefs, prefs_updated_at) on public.profiles to authenticated;
grant select on public.workspaces to authenticated;
grant insert (id, name, color, kind, fields, owner_id, client_updated_at, deleted_at) on public.workspaces to authenticated;
grant update (name, color, kind, fields, client_updated_at, deleted_at) on public.workspaces to authenticated;
grant select on public.workspace_members to authenticated;
grant update (wa_phone, show_in_pill, archived, client_updated_at) on public.workspace_members to authenticated;
grant select, insert, update on public.retomas to authenticated;
grant select on public.invites to authenticated;

-- ─── EQUIPES (funções chamadas pelo app) ────────────────────────────────

-- Pessoas dos meus negócios (nome pra mostrar nos cards)
create or replace function public.ws_people()
returns table (workspace_id uuid, user_id uuid, role text, display_name text, email text)
language sql stable security definer set search_path = public as $$
  select m.workspace_id, m.user_id, m.role, p.display_name, p.email
  from public.workspace_members m
  join public.profiles p on p.id = m.user_id
  where m.workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid())
$$;

-- Gera código de convite (só dono/gerente, só em loja)
create or replace function public.create_invite(ws uuid, invite_role text default 'seller')
returns text language plpgsql security definer set search_path = public as $$
declare c text; k text; b bytea; alpha text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; i int;
begin
  if not public.is_manager(ws) then raise exception 'sem_permissao'; end if;
  select kind into k from public.workspaces where id = ws;
  if k is distinct from 'store' then raise exception 'so_loja'; end if;
  if invite_role not in ('manager', 'seller') then raise exception 'papel_invalido'; end if;
  if invite_role = 'manager' and public.ws_role(ws) <> 'owner' then raise exception 'sem_permissao'; end if;
  loop   -- 6 letras/números sem os confusos (0/O, 1/I/L); gen_random_uuid é aleatório forte
    b := uuid_send(gen_random_uuid()); c := '';
    for i in 0..5 loop c := c || substr(alpha, (get_byte(b, i) % 31) + 1, 1); end loop;
    exit when not exists (select 1 from public.invites where code = c);
  end loop;
  insert into public.invites (code, workspace_id, role, created_by) values (c, ws, invite_role, auth.uid());
  return c;
end $$;

-- 1.1 — Convidar por e-mail: devolve o código (o app manda o e-mail com o código de acesso)
create or replace function public.invite_by_email(ws uuid, invite_email text, invite_role text default 'seller')
returns text language plpgsql security definer set search_path = public as $$
declare e text := lower(trim(invite_email)); c text; k text; b bytea; alpha text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; i int;
begin
  if not public.is_manager(ws) then raise exception 'sem_permissao'; end if;
  select kind into k from public.workspaces where id = ws;
  if k is distinct from 'store' then raise exception 'so_loja'; end if;
  if invite_role not in ('manager', 'seller') then raise exception 'papel_invalido'; end if;
  if invite_role = 'manager' and public.ws_role(ws) <> 'owner' then raise exception 'sem_permissao'; end if;
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$' then raise exception 'email_invalido'; end if;
  if exists (select 1 from public.workspace_members m join auth.users u on u.id = m.user_id where m.workspace_id = ws and lower(u.email) = e) then raise exception 'ja_membro'; end if;
  -- convite pendente pro mesmo e-mail: renova e devolve o mesmo código
  select code into c from public.invites where workspace_id = ws and lower(email) = e and uses_left > 0 order by created_at desc limit 1;
  if c is not null then
    update public.invites set expires_at = now() + interval '7 days', role = invite_role where code = c;
    return c;
  end if;
  loop
    b := uuid_send(gen_random_uuid()); c := '';
    for i in 0..5 loop c := c || substr(alpha, (get_byte(b, i) % 31) + 1, 1); end loop;
    exit when not exists (select 1 from public.invites where code = c);
  end loop;
  insert into public.invites (code, workspace_id, role, created_by, email, uses_left) values (c, ws, invite_role, auth.uid(), e, 1);
  return c;
end $$;

-- Convites pendentes pro meu e-mail (só nome da loja e quem convidou, pra mostrar no app)
create or replace function public.my_pending_invites()
returns table (workspace_id uuid, workspace_name text, role text, invited_by text)
language sql stable security definer set search_path = public as $$
  select i.workspace_id, w.name, i.role, p.display_name
  from public.invites i
  join public.workspaces w on w.id = i.workspace_id
  left join public.profiles p on p.id = i.created_by
  where lower(i.email) = (select lower(email) from auth.users where id = auth.uid())
    and i.uses_left > 0 and i.expires_at > now()
    and not exists (select 1 from public.workspace_members m where m.workspace_id = i.workspace_id and m.user_id = auth.uid())
$$;

-- Aceitar os convites do meu e-mail. Só vale se eu provei que o e-mail é meu
-- entrando com o código que chegou nele (método "otp" no login).
create or replace function public.accept_my_invites()
returns setof uuid language plpgsql security definer set search_path = public as $$
declare e text; inv public.invites; proved boolean;
begin
  if auth.uid() is null then raise exception 'sem_login'; end if;
  select lower(email) into e from auth.users where id = auth.uid();
  proved := exists (select 1 from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) x where x ->> 'method' in ('otp', 'magiclink', 'email'));
  if not proved then raise exception 'prove_email'; end if;
  for inv in select * from public.invites where lower(email) = e and uses_left > 0 and expires_at > now() for update loop
    insert into public.workspace_members (workspace_id, user_id, role) values (inv.workspace_id, auth.uid(), inv.role)
      on conflict (workspace_id, user_id) do nothing;
    update public.invites set uses_left = uses_left - 1 where code = inv.code;
    return next inv.workspace_id;
  end loop;
end $$;

-- Convites da loja (pra o gerente ver os pendentes e reenviar/cancelar)
create or replace function public.ws_invites(ws uuid)
returns table (code text, email text, role text, expires_at timestamptz)
language sql stable security definer set search_path = public as $$
  select code, email, role, expires_at from public.invites
  where workspace_id = ws and public.is_manager(ws) and uses_left > 0 and expires_at > now() and email is not null
  order by created_at desc
$$;
create or replace function public.cancel_invite(invite_code text)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.invites where code = invite_code and public.is_manager(workspace_id);
end $$;

-- Entrar numa loja com o código
create or replace function public.accept_invite(invite_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare inv public.invites;
begin
  if auth.uid() is null then raise exception 'sem_login'; end if;
  select * into inv from public.invites where code = upper(trim(invite_code)) for update;
  if not found then raise exception 'convite_invalido'; end if;
  if inv.expires_at < now() or inv.uses_left <= 0 then raise exception 'convite_expirado'; end if;
  insert into public.workspace_members (workspace_id, user_id, role)
  values (inv.workspace_id, auth.uid(), inv.role)
  on conflict (workspace_id, user_id) do nothing;
  update public.invites set uses_left = uses_left - 1 where code = inv.code;
  return inv.workspace_id;
end $$;

-- Mudar papel (só o dono; não mexe no dono)
create or replace function public.set_member_role(ws uuid, member uuid, new_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.ws_role(ws) <> 'owner' then raise exception 'sem_permissao'; end if;
  if new_role not in ('manager', 'seller') then raise exception 'papel_invalido'; end if;
  update public.workspace_members set role = new_role, client_updated_at = now()
   where workspace_id = ws and user_id = member and role <> 'owner';
end $$;

-- Tirar alguém da loja: os retomas ativos dele vão pra carteira sem dono
create or replace function public.remove_member(ws uuid, member uuid)
returns int language plpgsql security definer set search_path = public as $$
declare n int; r text;
begin
  select role into r from public.workspace_members where workspace_id = ws and user_id = member;
  if r is null then return 0; end if;
  if r = 'owner' then raise exception 'nao_remove_dono'; end if;
  if member <> auth.uid() and not public.is_manager(ws) then raise exception 'sem_permissao'; end if;
  if member <> auth.uid() and r = 'manager' and public.ws_role(ws) <> 'owner' then raise exception 'sem_permissao'; end if;
  update public.retomas set owner_id = null, client_updated_at = now()
   where workspace_id = ws and owner_id = member and status = 'active' and deleted_at is null;
  get diagnostics n = row_count;
  delete from public.workspace_members where workspace_id = ws and user_id = member;
  return n;
end $$;

-- Sair da loja (eu mesmo)
create or replace function public.leave_workspace(ws uuid)
returns int language sql security definer set search_path = public as $$
  select public.remove_member(ws, auth.uid())
$$;

-- Aviso de cliente duplicado: o mesmo telefone já está com outro vendedor da loja?
create or replace function public.phone_owner(ws uuid, phone8 text)
returns text language sql stable security definer set search_path = public as $$
  select p.display_name
  from public.retomas r join public.profiles p on p.id = r.owner_id
  where public.is_member(ws)
    and r.workspace_id = ws and r.status = 'active' and r.deleted_at is null
    and r.owner_id is distinct from auth.uid()
    and char_length(phone8) >= 8
    and right(regexp_replace(r.phone, '\D', '', 'g'), 8) = phone8
  limit 1
$$;

-- Ids que eu ainda enxergo (o app usa pra tirar do aparelho o que foi passado pra outro vendedor)
create or replace function public.visible_retoma_ids(ws uuid)
returns setof text language sql stable security definer set search_path = public as $$
  select id from public.retomas
  where workspace_id = ws and deleted_at is null
    and public.is_member(ws) and (owner_id = auth.uid() or public.is_manager(ws))
$$;

-- ─── LGPD: excluir minha conta e meus dados ─────────────────────────────
-- • Negócios pessoais: apagados
-- • Lojas que eu sou dono: passam pro gerente mais antigo (ou membro mais antigo); sem ninguém, apagadas
-- • Meus retomas em lojas de outros: ficam na loja, na carteira sem dono (cliente é da loja)
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); w record; heir uuid;
begin
  if me is null then raise exception 'sem_login'; end if;
  for w in select id, kind from public.workspaces where owner_id = me loop
    heir := null;
    if w.kind = 'store' then
      select user_id into heir from public.workspace_members
       where workspace_id = w.id and user_id <> me
       order by (role = 'manager') desc, joined_at asc limit 1;
    end if;
    if heir is null then
      delete from public.workspaces where id = w.id;
    else
      update public.workspaces set owner_id = heir, client_updated_at = now() where id = w.id;
      update public.workspace_members set role = 'owner' where workspace_id = w.id and user_id = heir;
      update public.retomas set owner_id = null, client_updated_at = now() where workspace_id = w.id and owner_id = me;
    end if;
  end loop;
  update public.retomas set owner_id = null, client_updated_at = now() where owner_id = me;
  delete from public.workspace_members where user_id = me;
  delete from public.profiles where id = me;
  delete from auth.users where id = me;
end $$;

revoke all on function public.invite_by_email(uuid, text, text), public.my_pending_invites(), public.accept_my_invites(),
  public.ws_invites(uuid), public.cancel_invite(text) from public, anon;
grant execute on function public.invite_by_email(uuid, text, text), public.my_pending_invites(), public.accept_my_invites(),
  public.ws_invites(uuid), public.cancel_invite(text) to authenticated;
revoke all on function public.create_invite(uuid, text), public.accept_invite(text), public.set_member_role(uuid, uuid, text),
  public.remove_member(uuid, uuid), public.leave_workspace(uuid), public.phone_owner(uuid, text),
  public.visible_retoma_ids(uuid), public.delete_my_account(), public.ws_people() from public, anon;
grant execute on function public.create_invite(uuid, text), public.accept_invite(text), public.set_member_role(uuid, uuid, text),
  public.remove_member(uuid, uuid), public.leave_workspace(uuid), public.phone_owner(uuid, text),
  public.visible_retoma_ids(uuid), public.delete_my_account(), public.ws_people() to authenticated;

-- ─── 1.1 — Endurecimento (verificador de segurança do Supabase) ─────────
-- gatilhos com caminho de busca fixo
alter function public.sync_stamp() set search_path = public;
alter function public.retomas_guard() set search_path = public;
-- funções de gatilho não são chamáveis pela API (o gatilho continua funcionando)
revoke all on function public.handle_new_user(), public.workspace_owner_member() from public, anon, authenticated;
-- funções usadas nas regras (RLS): só pra quem está logado
revoke all on function public.is_member(uuid), public.is_manager(uuid), public.ws_role(uuid) from public, anon;
grant execute on function public.is_member(uuid), public.is_manager(uuid), public.ws_role(uuid) to authenticated;
