const { PGlite } = require(process.env.PGLITE || '@electric-sql/pglite'); const fs = require('fs')
const U = { dono: '11111111-1111-1111-1111-111111111111', vend: '22222222-2222-2222-2222-222222222222', ger: '33333333-3333-3333-3333-333333333333', fora: '44444444-4444-4444-4444-444444444444' }
const LOJA = 'aaaaaaaa-0000-0000-0000-000000000001', PESS = 'aaaaaaaa-0000-0000-0000-000000000002'
let fails = 0; const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) fails++ }
;(async () => {
  const db = new PGlite()
  await db.exec(fs.readFileSync(require('path').join(__dirname, 'prelude.sql'), 'utf8'))
  await db.exec(fs.readFileSync(require('path').join(__dirname, '../supabase/schema.sql'), 'utf8'))
  await db.exec(fs.readFileSync(require('path').join(__dirname, '../supabase/schema.sql'), 'utf8'))   // idempotente
  ok(true, 'schema roda 2x sem erro')
  for (const [k, id] of Object.entries(U)) await db.query(`insert into auth.users(id,email,raw_user_meta_data) values ($1,$2,$3)`, [id, k + '@t.com', { name: k[0].toUpperCase() + k.slice(1) }])
  ok((await db.query('select count(*)::int n from profiles')).rows[0].n === 4, 'perfil criado no cadastro')
  let AMR = 'password'
  const as = async (u, sql, p = []) => {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${u || ''}', false); select set_config('request.jwt.claims', '{"sub":"${u || ''}","amr":[{"method":"${AMR}"}]}', false); set role authenticated;`)
    try { return await db.query(sql, p) } finally { await db.exec('reset role') }
  }
  const tryAs = async (u, sql, p) => { try { return { r: await as(u, sql, p) } } catch (e) { return { e: e.message } } }
  // dono cria loja e negócio pessoal
  await as(U.dono, `insert into workspaces(id,name,kind,owner_id) values ($1,'Construpac','store',$2)`, [LOJA, U.dono])
  await as(U.dono, `insert into workspaces(id,name,kind,owner_id) values ($1,'Alvamind','personal',$2)`, [PESS, U.dono])
  ok((await as(U.dono, `select role from workspace_members where workspace_id=$1`, [LOJA])).rows[0]?.role === 'owner', 'quem cria vira dono')
  ok((await tryAs(U.vend, `insert into workspaces(id,name,owner_id) values (gen_random_uuid(),'X',$1)`, [U.dono])).e, 'não cria negócio em nome de outro')
  // convites
  const code = (await as(U.dono, `select create_invite($1,'seller') c`, [LOJA])).rows[0].c
  ok(/^[A-Z2-9]{6}$/.test(code), 'código de convite: ' + code)
  ok((await tryAs(U.dono, `select create_invite($1,'seller')`, [PESS])).e?.includes('so_loja'), 'negócio pessoal não tem convite')
  ok((await tryAs(U.vend, `select create_invite($1,'seller')`, [LOJA])).e?.includes('sem_permissao'), 'quem não é gerente não convida')
  await as(U.vend, `select accept_invite($1)`, [code.toLowerCase()])
  const gcode = (await as(U.dono, `select create_invite($1,'manager') c`, [LOJA])).rows[0].c
  await as(U.ger, `select accept_invite($1)`, [gcode])
  ok((await tryAs(U.fora, `select accept_invite('ZZZZZZ')`)).e?.includes('convite_invalido'), 'código errado recusado')
  ok((await as(U.vend, `select role from workspace_members where user_id=$1 and workspace_id=$2`, [U.vend, LOJA])).rows[0]?.role === 'seller', 'vendedor entrou na loja')
  // vendedor não muda o próprio papel
  ok((await tryAs(U.vend, `update workspace_members set role='owner' where user_id=$1`, [U.vend])).e, 'vendedor não se promove (coluna bloqueada)')
  await as(U.vend, `update workspace_members set wa_phone='11977776666' where user_id=$1 and workspace_id=$2`, [U.vend, LOJA])
  ok((await as(U.vend, `select wa_phone from workspace_members where user_id=$1 and workspace_id=$2`, [U.vend, LOJA])).rows[0].wa_phone === '11977776666', 'vendedor salva o próprio WhatsApp')
  // retomas
  const ins = (u, id, owner, ws = LOJA, phone = '11999990000', t = '2026-11-05T10:00:00Z') => tryAs(u,
    `insert into retomas(id,workspace_id,owner_id,created_by,name,phone,date,client_updated_at) values ($1,$2,$3,$4,$1,$5,'2026-11-05',$6)`, [id, ws, owner, u, phone, t])
  ok(!(await ins(U.dono, 'r-dono', U.dono)).e, 'dono cria retoma dele')
  ok(!(await ins(U.vend, 'r-vend', U.vend, LOJA, '11 98888-7777')).e, 'vendedor cria retoma dele')
  ok((await ins(U.vend, 'r-x', U.dono)).e, 'vendedor NÃO cria retoma em nome de outro')
  ok(!(await ins(U.ger, 'r-atrib', U.vend)).e, 'gerente cria e atribui pro vendedor')
  ok((await ins(U.vend, 'r-p', U.vend, PESS)).e, 'vendedor não mexe no negócio pessoal do dono')
  ok(!(await ins(U.dono, 'r-pess', U.dono, PESS)).e, 'dono usa negócio pessoal')
  const ids = async u => (await as(u, `select id from retomas order by id`)).rows.map(r => r.id).join(',')
  ok(await ids(U.vend) === 'r-atrib,r-vend', 'vendedor vê só os dele: ' + await ids(U.vend))
  ok(await ids(U.ger) === 'r-atrib,r-dono,r-vend', 'gerente vê toda a loja (não o pessoal do dono): ' + await ids(U.ger))
  ok(await ids(U.dono) === 'r-atrib,r-dono,r-pess,r-vend', 'dono vê loja + pessoal')
  ok(await ids(U.fora) === '', 'quem está fora não vê nada')
  ok((await tryAs(U.vend, `delete from retomas where id='r-vend'`)).e, 'ninguém apaga de verdade (só deleted_at)')
  // LWW
  await as(U.vend, `update retomas set note='novo', client_updated_at='2026-11-05T12:00:00Z' where id='r-vend'`)
  await as(U.vend, `update retomas set note='velho', client_updated_at='2026-11-05T11:00:00Z' where id='r-vend'`)
  ok((await as(U.vend, `select note from retomas where id='r-vend'`)).rows[0].note === 'novo', 'vale a alteração mais recente (LWW)')
  // upsert como o app faz
  await as(U.vend, `insert into retomas(id,workspace_id,owner_id,name,client_updated_at) values ('r-vend',$1,$2,'Upsert','2026-11-05T13:00:00Z')
    on conflict (id) do update set name=excluded.name, client_updated_at=excluded.client_updated_at`, [LOJA, U.vend])
  const rv = (await as(U.vend, `select name, created_by from retomas where id='r-vend'`)).rows[0]
  ok(rv.name === 'Upsert' && rv.created_by === U.vend, 'upsert atualiza e mantém quem criou')
  // vendedor não passa retoma pra outro
  ok((await tryAs(U.vend, `update retomas set owner_id=$1, client_updated_at=now() where id='r-vend'`, [U.dono])).e || (await ids(U.dono)).includes('r-vend'), 'vendedor não transfere pra outro (bloqueado)')
  // duplicado
  ok((await as(U.dono, `select phone_owner($1,'88887777') n`, [LOJA])).rows[0].n === 'Vend', 'aviso: telefone já está com Vend')
  ok((await as(U.vend, `select phone_owner($1,'88887777') n`, [LOJA])).rows[0].n === null, 'não avisa sobre o próprio cliente')
  ok((await as(U.fora, `select phone_owner($1,'88887777') n`, [LOJA])).rows[0].n === null, 'quem está fora não descobre nada')
  // pessoas
  ok((await as(U.vend, `select count(*)::int n from ws_people()`)).rows[0].n === 3, 'vendedor vê os 3 da loja (nomes)')
  ok((await tryAs(U.vend, `update workspaces set name='Hack', client_updated_at=now() where id=$1 returning id`, [LOJA])).r?.rows.length === 0, 'vendedor não renomeia a loja')
  ok((await as(U.ger, `update workspaces set name='Construpac SP', client_updated_at=now() where id=$1 returning id`, [LOJA])).rows.length === 1, 'gerente edita a loja (nome, campos)')
  ok((await tryAs(U.ger, `update workspaces set owner_id=$2 where id=$1`, [LOJA, U.ger])).e, 'ninguém troca o dono pelo app')
  ok((await as(U.vend, `select count(*)::int n from visible_retoma_ids($1)`, [LOJA])).rows[0].n === 2, 'lista de visíveis do vendedor')
  // papel
  ok((await tryAs(U.ger, `select set_member_role($1,$2,'manager')`, [LOJA, U.vend])).e, 'só o dono muda papel')
  // remover vendedor → carteira sem dono
  const moved = (await as(U.ger, `select remove_member($1,$2) n`, [LOJA, U.vend])).rows[0].n
  ok(moved === 2, 'vendedor saiu: ' + moved + ' retomas pra carteira sem dono')
  ok(await ids(U.vend) === '', 'quem saiu não vê mais nada')
  ok((await as(U.ger, `select count(*)::int n from retomas where owner_id is null`)).rows[0].n === 2, 'gerente vê a carteira sem dono')
  ok(!(await tryAs(U.ger, `update retomas set owner_id=$1, client_updated_at=now() where owner_id is null`, [U.ger])).e, 'gerente redistribui')
  ok((await tryAs(U.ger, `select remove_member($1,$2)`, [LOJA, U.dono])).e?.includes('nao_remove_dono'), 'ninguém tira o dono')
  // ── 1.1: convite por e-mail
  const NOVO = '55555555-5555-5555-5555-555555555555'
  const ic = (await as(U.dono, `select invite_by_email($1,' Novo@T.com ','seller') c`, [LOJA])).rows[0].c
  ok(/^[A-Z2-9]{6}$/.test(ic), 'convite por e-mail gera código de reserva: ' + ic)
  ok((await as(U.dono, `select invite_by_email($1,'novo@t.com','seller') c`, [LOJA])).rows[0].c === ic, 'convidar de novo o mesmo e-mail reaproveita o convite')
  ok((await tryAs(U.dono, `select invite_by_email($1,'ger@t.com','seller')`, [LOJA])).e?.includes('ja_membro'), 'não convida quem já é da loja')
  ok((await tryAs(U.dono, `select invite_by_email($1,'nao-e-email','seller')`, [LOJA])).e?.includes('email_invalido'), 'e-mail inválido recusado')
  ok((await tryAs(U.vend, `select invite_by_email($1,'x@t.com','seller')`, [LOJA])).e, 'vendedor/ex-membro não convida')
  ok((await as(U.dono, `select count(*)::int n from ws_invites($1)`, [LOJA])).rows[0].n === 1, 'gerente vê o convite pendente')
  ok((await as(U.ger, `select count(*)::int n from ws_invites($1)`, [LOJA])).rows[0].n === 1, 'gerente (não dono) também vê')
  await db.query(`insert into auth.users(id,email,raw_user_meta_data) values ($1,'novo@t.com','{"name":"Novo"}')`, [NOVO])
  const pend = (await as(NOVO, `select * from my_pending_invites()`)).rows
  ok(pend.length === 1 && pend[0].workspace_name === 'Construpac SP' && pend[0].invited_by === 'Dono', 'convidado vê: Construpac, convidado por Dono')
  AMR = 'password'
  ok((await tryAs(NOVO, `select * from accept_my_invites()`)).e?.includes('prove_email'), 'entrou só com senha: precisa provar o e-mail (anti-roubo de convite)')
  AMR = 'otp'
  const acc = (await as(NOVO, `select * from accept_my_invites() x`)).rows
  ok(acc.length === 1 && acc[0].x === LOJA, 'com o código do e-mail: entrou na loja')
  ok((await as(NOVO, `select role from workspace_members where user_id=$1`, [NOVO])).rows[0].role === 'seller', 'como vendedor')
  ok((await as(U.dono, `select count(*)::int n from ws_invites($1)`, [LOJA])).rows[0].n === 0, 'convite usado sai da lista')
  ok((await as(NOVO, `select count(*)::int n from my_pending_invites()`)).rows[0].n === 0, 'sem convites pendentes depois')
  AMR = 'password'
  // código de reserva (e-mail não chegou): vale 1 uso
  const ic2 = (await as(U.dono, `select invite_by_email($1,'outro@t.com','seller') c`, [LOJA])).rows[0].c
  ok(!(await tryAs(U.fora, `select accept_invite($1)`, [ic2])).e, 'código de reserva funciona (e-mail não chegou)')
  const OUT2 = '66666666-6666-6666-6666-666666666666'
  await db.query(`insert into auth.users(id,email) values ($1,'outro2@t.com')`, [OUT2])
  ok((await tryAs(OUT2, `select accept_invite($1)`, [ic2])).e?.includes('convite_expirado'), 'código de convite por e-mail é de 1 uso só')
  const ic3 = (await as(U.dono, `select invite_by_email($1,'cancela@t.com','seller') c`, [LOJA])).rows[0].c
  await as(U.dono, `select cancel_invite($1)`, [ic3])
  ok((await tryAs(OUT2, `select accept_invite($1)`, [ic3])).e?.includes('convite_invalido'), 'convite cancelado não vale mais')
  // excluir conta do dono: loja passa pro gerente, pessoal some
  await as(U.dono, `select delete_my_account()`)
  const w = (await db.query(`select id, owner_id from workspaces order by id`)).rows
  ok(w.length === 1 && w[0].owner_id === U.ger, 'excluir conta: loja vai pro gerente, negócio pessoal apagado')
  ok((await db.query(`select count(*)::int n from auth.users where id=$1`, [U.dono])).rows[0].n === 0, 'usuário apagado do login')
  ok((await db.query(`select count(*)::int n from retomas where id='r-pess'`)).rows[0].n === 0, 'retomas do negócio pessoal apagados')
  console.log(fails ? `\n${fails} FALHA(S)` : '\nTUDO OK')
})().catch(e => { console.log('ERRO', e.message); process.exit(1) })
