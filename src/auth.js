// ═══════════════════════════════════════════════════════════════════════
//  RETOMA — Login (processo principal, Supabase Auth)
//
//  1. FLUXO PRINCIPAL ........ signUp / signIn (e-mail + senha) / signInWithGoogle (navegador + PKCE)
//  2. ERROS E VALIDAÇÃO ...... validate*, friendly(): senha errada, conta inexistente, campos
//                              vazios, e-mail não confirmado, bloqueio após 5 erros (local) e 429 (servidor)
//  3. ESQUECI A SENHA ........ requestPasswordReset → código de 6 dígitos por e-mail → confirmPasswordReset
//  4. CARREGAMENTO/LATÊNCIA .. withTimeout (15s); a tela desabilita botões e mostra "carregando"
//                              enquanto a promessa não volta (ver app.js → authCall)
//  5. SEGURANÇA AVANÇADA ..... verificação em 2 etapas (TOTP: Google Authenticator etc.):
//                              mfaEnroll / mfaActivate / mfaDisable / mfaVerifyLogin
//                              Sessão (JWT + refresh) criptografada no disco (cloud.js → safeStorage)
//  6. DADOS SEGUROS .......... nenhuma credencial no código: URL/chave vêm de config.js
//                              (variável de ambiente ou retoma.config.json). Senha nunca é guardada.
//
//  Toda função devolve { ok: true, ... } ou { ok: false, error: 'mensagem em português', code }
// ═══════════════════════════════════════════════════════════════════════
const http = require('http')
const { shell } = require('electron')
const cloud = require('./cloud.js')

const TIMEOUT_MS = 15000
const OAUTH_TIMEOUT_MS = 3 * 60 * 1000
const OAUTH_PORTS = [53682, 53683, 53684, 53685]      // cadastre http://127.0.0.1:53682/callback no Supabase
const MAX_FAILS = 5, FAIL_WINDOW_MS = 10 * 60 * 1000, LOCK_MS = 2 * 60 * 1000

// ─── 4. Tempo limite ────────────────────────────────────────────────────
function withTimeout(promise, ms = TIMEOUT_MS) {
  let t
  return Promise.race([
    promise,
    new Promise((_, rej) => { t = setTimeout(() => rej(Object.assign(new Error('timeout'), { code: 'timeout' })), ms) }),
  ]).finally(() => clearTimeout(t))
}

// ─── 2. Mensagens de erro ───────────────────────────────────────────────
function friendly(err) {
  if (!err) return { ok: false, error: 'Algo deu errado. Tente de novo.', code: 'unknown' }
  const code = err.code || err.error_code || ''
  const msg = String(err.message || err.msg || '').toLowerCase()
  const status = err.status || 0
  const map = [
    [code === 'timeout', 'O servidor demorou pra responder. Confira a internet e tente de novo.', 'timeout'],
    [code === 'invalid_credentials' || msg.includes('invalid login credentials'), 'E-mail ou senha incorretos.', 'invalid_credentials'],
    [code === 'email_not_confirmed' || msg.includes('email not confirmed'), 'Confirme seu e-mail antes de entrar (veja a caixa de entrada e o spam).', 'email_not_confirmed'],
    [code === 'user_already_exists' || msg.includes('already registered'), 'Já existe uma conta com esse e-mail. Tente entrar.', 'user_already_exists'],
    [code === 'weak_password' || msg.includes('password should be'), 'Senha fraca: use pelo menos 8 caracteres, com letras e números.', 'weak_password'],
    [status === 429 || code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit' || msg.includes('rate limit'), 'Muitas tentativas. Aguarde alguns minutos e tente de novo.', 'rate_limited'],
    [code === 'otp_expired' || msg.includes('expired') || msg.includes('invalid otp') || msg.includes('token has expired'), 'Código inválido ou vencido. Peça um novo.', 'otp_invalid'],
    [code === 'mfa_verification_failed' || msg.includes('invalid totp'), 'Código de verificação incorreto.', 'mfa_invalid'],
    [code === 'user_not_found', 'Não encontramos uma conta com esse e-mail.', 'user_not_found'],
    [code === 'otp_disabled' || msg.includes('signups not allowed for otp'), 'Não encontramos convite pra esse e-mail. Confira com o gerente ou use o código da loja.', 'no_invite'],
    [code === 'email_address_not_authorized' || msg.includes('not authorized'), 'O servidor de e-mail ainda não está liberado pra esse endereço. Use o código da loja.', 'email_blocked'],
    [code === 'same_password', 'A nova senha precisa ser diferente da atual.', 'same_password'],
    [msg.includes('fetch failed') || msg.includes('network') || msg.includes('enotfound') || msg.includes('econnrefused'), 'Sem conexão com a internet.', 'offline'],
  ]
  for (const [cond, text, c] of map) if (cond) return { ok: false, error: text, code: c }
  return { ok: false, error: err.message || 'Algo deu errado. Tente de novo.', code: code || 'unknown' }
}

// ─── 2. Validação dos campos ────────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
function validateEmail(email) {
  if (!email || !String(email).trim()) return 'Digite seu e-mail.'
  if (!EMAIL_RE.test(String(email).trim())) return 'E-mail inválido.'
  return null
}
function validatePassword(pw, { strong = false } = {}) {
  if (!pw) return 'Digite sua senha.'
  if (strong) {
    if (pw.length < 8) return 'A senha precisa ter pelo menos 8 caracteres.'
    if (!/[a-zA-Z]/.test(pw) || !/\d/.test(pw)) return 'Use letras e números na senha.'
  }
  return null
}

// ─── 2. Bloqueio local após muitos erros (além do limite do servidor) ───
const fails = new Map()   // email → [timestamps]
let lockedUntil = new Map()
function lockInfo(email) {
  const until = lockedUntil.get(email) || 0
  return until > Date.now() ? Math.ceil((until - Date.now()) / 1000) : 0
}
function registerFail(email) {
  const now = Date.now()
  const list = (fails.get(email) || []).filter(t => now - t < FAIL_WINDOW_MS)
  list.push(now); fails.set(email, list)
  if (list.length >= MAX_FAILS) { lockedUntil.set(email, now + LOCK_MS); fails.set(email, []) }
}
function clearFails(email) { fails.delete(email); lockedUntil.delete(email) }

function noCloud() { return { ok: false, error: 'A sincronização ainda não foi configurada neste computador.', code: 'not_configured' } }
const norm = e => String(e || '').trim().toLowerCase()

// ─── 1. Cadastro ────────────────────────────────────────────────────────
async function signUp({ email, password, name } = {}) {
  const sb = cloud.getClient(); if (!sb) return noCloud()
  email = norm(email)
  const v = validateEmail(email) || validatePassword(password, { strong: true })
  if (v) return { ok: false, error: v, code: 'validation' }
  if (!String(name || '').trim()) return { ok: false, error: 'Digite seu nome.', code: 'validation' }
  try {
    const { data, error } = await withTimeout(sb.auth.signUp({ email, password, options: { data: { name: String(name).trim().slice(0, 60), pw_set: true } } }))
    if (error) return friendly(error)
    // Supabase devolve usuário sem sessão quando exige confirmar o e-mail
    if (!data.session) return { ok: true, needsConfirmation: true }
    return { ok: true, user: publicUser(data.user) }
  } catch (e) { return friendly(e) }
}

async function resendConfirmation(email) {
  const sb = cloud.getClient(); if (!sb) return noCloud()
  email = norm(email)
  const v = validateEmail(email); if (v) return { ok: false, error: v, code: 'validation' }
  try {
    const { error } = await withTimeout(sb.auth.resend({ type: 'signup', email }))
    return error ? friendly(error) : { ok: true }
  } catch (e) { return friendly(e) }
}

// ─── 1. Entrar ──────────────────────────────────────────────────────────
async function signIn({ email, password } = {}) {
  const sb = cloud.getClient(); if (!sb) return noCloud()
  email = norm(email)
  const v = validateEmail(email) || validatePassword(password)
  if (v) return { ok: false, error: v, code: 'validation' }
  const wait = lockInfo(email)
  if (wait) return { ok: false, error: `Muitas tentativas erradas. Tente de novo em ${wait < 60 ? wait + ' s' : Math.ceil(wait / 60) + ' min'}.`, code: 'locked', retryIn: wait }
  try {
    const { data, error } = await withTimeout(sb.auth.signInWithPassword({ email, password }))
    if (error) {
      const f = friendly(error)
      if (f.code === 'invalid_credentials') {
        registerFail(email)
        const left = MAX_FAILS - (fails.get(email) || []).length
        if (lockInfo(email)) return { ok: false, error: 'Muitas tentativas erradas. Aguarde 2 minutos.', code: 'locked', retryIn: lockInfo(email) }
        if (left <= 2) f.error += ` (${left} tentativa${left > 1 ? 's' : ''} antes de bloquear)`
      }
      return f
    }
    clearFails(email)
    return await afterPrimaryLogin(data.user)
  } catch (e) { return friendly(e) }
}

// ─── 5. Depois da senha: precisa do código de 2 etapas? ─────────────────
async function afterPrimaryLogin(user) {
  const sb = cloud.getClient()
  try {
    const { data: aal } = await withTimeout(sb.auth.mfa.getAuthenticatorAssuranceLevel())
    if (aal && aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') {
      const { data: f } = await withTimeout(sb.auth.mfa.listFactors())
      const factor = (f && f.totp || []).find(x => x.status === 'verified')
      if (factor) return { ok: true, mfaRequired: true, factorId: factor.id }
    }
  } catch (e) { /* sem MFA configurado: segue */ }
  return { ok: true, user: publicUser(user) }
}

async function mfaVerifyLogin({ factorId, code } = {}) {
  const sb = cloud.getClient(); if (!sb) return noCloud()
  if (!/^\d{6}$/.test(String(code || '').trim())) return { ok: false, error: 'Digite os 6 números do aplicativo autenticador.', code: 'validation' }
  try {
    const { error } = await withTimeout(sb.auth.mfa.challengeAndVerify({ factorId, code: String(code).trim() }))
    if (error) return friendly(error)
    const { data } = await sb.auth.getUser()
    return { ok: true, user: publicUser(data && data.user) }
  } catch (e) { return friendly(e) }
}

// ─── 1.1 Confirmar cadastro com código (quando "Confirm email" estiver ligado) ───
async function confirmSignup({ email, code } = {}) {
  const sb = cloud.getClient(); if (!sb) return noCloud()
  email = norm(email)
  if (!/^\d{6}$/.test(String(code || '').trim())) return { ok: false, error: 'Digite o código de 6 números do e-mail.', code: 'validation' }
  try {
    let r = await withTimeout(sb.auth.verifyOtp({ email, token: String(code).trim(), type: 'signup' }))
    if (r.error) r = await withTimeout(sb.auth.verifyOtp({ email, token: String(code).trim(), type: 'email' }))
    if (r.error) return friendly(r.error)
    return await afterPrimaryLogin(r.data.user)
  } catch (e) { return friendly(e) }
}

// ─── 1.1 Convidado (vendedor): entra com o código que chegou no e-mail ───
// O gerente convida → o Supabase manda um código de 6 números → o vendedor digita
// no Retoma, cria a senha e já cai na loja. Entrar pelo código prova que o e-mail é dele.
async function requestEmailCode(email) {
  const sb = cloud.getClient(); if (!sb) return noCloud()
  email = norm(email)
  const v = validateEmail(email); if (v) return { ok: false, error: v, code: 'validation' }
  try {
    const { error } = await withTimeout(sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false } }))
    return error ? friendly(error) : { ok: true }
  } catch (e) { return friendly(e) }
}
async function verifyEmailCode({ email, code } = {}) {
  const sb = cloud.getClient(); if (!sb) return noCloud()
  email = norm(email)
  if (!/^\d{6}$/.test(String(code || '').trim())) return { ok: false, error: 'Digite o código de 6 números do e-mail.', code: 'validation' }
  try {
    const { data, error } = await withTimeout(sb.auth.verifyOtp({ email, token: String(code).trim(), type: 'email' }))
    if (error) return friendly(error)
    const r = await afterPrimaryLogin(data.user)
    const meta = (data.user && data.user.user_metadata) || {}
    return r.ok ? { ...r, needsPassword: !meta.pw_set } : r
  } catch (e) { return friendly(e) }
}
async function finishProfile({ name, password } = {}) {
  const sb = cloud.getClient(); if (!sb) return noCloud()
  if (!String(name || '').trim()) return { ok: false, error: 'Digite seu nome.', code: 'validation' }
  const v = validatePassword(password, { strong: true }); if (v) return { ok: false, error: v, code: 'validation' }
  try {
    const nm = String(name).trim().slice(0, 60)
    const { data, error } = await withTimeout(sb.auth.updateUser({ password, data: { name: nm, pw_set: true } }))
    if (error) return friendly(error)
    const { data: u } = await sb.auth.getUser()
    const uid = u && u.user && u.user.id
    if (uid) await sb.from('profiles').update({ display_name: nm }).eq('id', uid)
    return { ok: true, user: publicUser({ ...(u && u.user), user_metadata: { ...((u && u.user && u.user.user_metadata) || {}), name: nm } }) }
  } catch (e) { return friendly(e) }
}
// Gerente: dispara o e-mail com o código de acesso pro convidado
async function sendInviteEmail(email) {
  const m = await cloud.getMailer(); if (!m) return noCloud()
  try {
    const { error } = await withTimeout(m.auth.signInWithOtp({ email: norm(email), options: { shouldCreateUser: true, data: { invited: true } } }))
    return error ? friendly(error) : { ok: true }
  } catch (e) { return friendly(e) }
}

// ─── 1. Entrar com Google (navegador do sistema + retorno em 127.0.0.1) ─
function listenOnce(ports) {
  return new Promise((resolve, reject) => {
    const tryPort = i => {
      if (i >= ports.length) return reject(Object.assign(new Error('Sem porta livre para o retorno do login.'), { code: 'no_port' }))
      const srv = http.createServer()
      srv.once('error', () => tryPort(i + 1))
      srv.listen(ports[i], '127.0.0.1', () => resolve({ srv, port: ports[i] }))
    }
    tryPort(0)
  })
}
const DONE_HTML = ok => `<!doctype html><meta charset="utf-8"><title>Retoma</title><body style="font-family:system-ui;background:#0f0f0f;color:#fff;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><div style="font-size:42px">${ok ? '✓' : '✗'}</div><h2 style="font-weight:600">${ok ? 'Pronto! Pode voltar pro Retoma.' : 'Não deu certo. Volte pro Retoma e tente de novo.'}</h2><p style="color:#888">Esta aba pode ser fechada.</p></div>`

async function signInWithGoogle() {
  const sb = cloud.getClient(); if (!sb) return noCloud()
  let srv
  try {
    const l = await listenOnce(OAUTH_PORTS); srv = l.srv
    const redirectTo = `http://127.0.0.1:${l.port}/callback`
    const { data, error } = await withTimeout(sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo, skipBrowserRedirect: true } }))
    if (error) return friendly(error)
    const code = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'timeout' })), OAUTH_TIMEOUT_MS)
      srv.on('request', (req, res) => {
        const u = new URL(req.url, redirectTo)
        if (u.pathname !== '/callback') { res.writeHead(404); res.end(); return }
        const c = u.searchParams.get('code'), err = u.searchParams.get('error_description') || u.searchParams.get('error')
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(DONE_HTML(!!c))
        clearTimeout(t)
        c ? resolve(c) : reject(new Error(err || 'Login cancelado.'))
      })
      shell.openExternal(data.url)
    })
    const { data: s, error: e2 } = await withTimeout(sb.auth.exchangeCodeForSession(code))
    if (e2) return friendly(e2)
    return await afterPrimaryLogin(s.user)
  } catch (e) { return friendly(e) }
  finally { try { srv && srv.close() } catch (e) {} }
}

// ─── 3. Esqueci a senha (código de 6 dígitos por e-mail) ────────────────
// No Supabase: Authentication → Email Templates → "Reset Password" com {{ .Token }}
async function requestPasswordReset(email) {
  const sb = cloud.getClient(); if (!sb) return noCloud()
  email = norm(email)
  const v = validateEmail(email); if (v) return { ok: false, error: v, code: 'validation' }
  try {
    const { error } = await withTimeout(sb.auth.resetPasswordForEmail(email))
    if (error) return friendly(error)
    return { ok: true }   // mesma resposta exista ou não a conta (não revela quem tem cadastro)
  } catch (e) { return friendly(e) }
}

async function confirmPasswordReset({ email, code, password } = {}) {
  const sb = cloud.getClient(); if (!sb) return noCloud()
  email = norm(email)
  const v = validateEmail(email) || validatePassword(password, { strong: true })
  if (v) return { ok: false, error: v, code: 'validation' }
  if (!/^\d{6}$/.test(String(code || '').trim())) return { ok: false, error: 'Digite o código de 6 números que chegou no e-mail.', code: 'validation' }
  try {
    const { data, error } = await withTimeout(sb.auth.verifyOtp({ email, token: String(code).trim(), type: 'recovery' }))
    if (error) return friendly(error)
    const { error: e2 } = await withTimeout(sb.auth.updateUser({ password }))
    if (e2) return friendly(e2)
    clearFails(email)
    return await afterPrimaryLogin(data.user)
  } catch (e) { return friendly(e) }
}

async function changePassword({ password } = {}) {
  const sb = cloud.getClient(); if (!sb) return noCloud()
  const v = validatePassword(password, { strong: true }); if (v) return { ok: false, error: v, code: 'validation' }
  try {
    const { error } = await withTimeout(sb.auth.updateUser({ password }))
    return error ? friendly(error) : { ok: true }
  } catch (e) { return friendly(e) }
}

// ─── 5. Verificação em 2 etapas (TOTP) ──────────────────────────────────
async function mfaStatus() {
  const sb = cloud.getClient(); if (!sb) return noCloud()
  try {
    const { data, error } = await withTimeout(sb.auth.mfa.listFactors())
    if (error) return friendly(error)
    const f = (data.totp || []).find(x => x.status === 'verified')
    return { ok: true, enabled: !!f, factorId: f ? f.id : null }
  } catch (e) { return friendly(e) }
}
async function mfaEnroll() {
  const sb = cloud.getClient(); if (!sb) return noCloud()
  try {
    // limpa tentativas antigas não confirmadas
    const { data: list } = await sb.auth.mfa.listFactors()
    for (const f of ((list && list.all) || []).filter(f => f.status !== 'verified')) { try { await sb.auth.mfa.unenroll({ factorId: f.id }) } catch (e) {} }
    const { data, error } = await withTimeout(sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Retoma ' + Date.now().toString(36) }))
    if (error) return friendly(error)
    let qr = data.totp.qr_code || ''
    if (qr && !qr.startsWith('data:')) qr = 'data:image/svg+xml;utf8,' + encodeURIComponent(qr)
    return { ok: true, factorId: data.id, qr, secret: data.totp.secret }
  } catch (e) { return friendly(e) }
}
async function mfaActivate({ factorId, code } = {}) {
  const r = await mfaVerifyLogin({ factorId, code })
  return r.ok ? { ok: true } : r
}
async function mfaDisable({ factorId } = {}) {
  const sb = cloud.getClient(); if (!sb) return noCloud()
  try {
    const { error } = await withTimeout(sb.auth.mfa.unenroll({ factorId }))
    return error ? friendly(error) : { ok: true }
  } catch (e) { return friendly(e) }
}

// ─── Sessão ─────────────────────────────────────────────────────────────
function publicUser(u) {
  if (!u) return null
  const m = u.user_metadata || {}
  return { id: u.id, email: u.email, name: m.name || m.full_name || (u.email || '').split('@')[0] }
}
async function currentUser() {
  const sb = cloud.getClient(); if (!sb) return null
  try {
    const { data } = await withTimeout(sb.auth.getSession(), 8000)
    if (!data || !data.session) return null
    // sessão com 2 etapas pendente não conta como logada
    try {
      const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel()
      if (aal && aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') return null
    } catch (e) {}
    return publicUser(data.session.user)
  } catch (e) {
    // sem internet: confia na sessão salva (o app funciona offline)
    try { const { data } = await sb.auth.getSession(); return data && data.session ? publicUser(data.session.user) : null } catch (e2) { return null }
  }
}
async function signOut() {
  const sb = cloud.getClient()
  try { if (sb) await withTimeout(sb.auth.signOut({ scope: 'local' }), 5000) } catch (e) {}
  try { cloud.getStorage().clearAll() } catch (e) {}
  return { ok: true }
}

// LGPD: excluir conta e dados na nuvem
async function deleteAccount() {
  const sb = cloud.getClient(); if (!sb) return noCloud()
  try {
    const { error } = await withTimeout(sb.rpc('delete_my_account'), 30000)
    if (error) return friendly(error)
    await signOut()
    return { ok: true }
  } catch (e) { return friendly(e) }
}

module.exports = {
  signUp, resendConfirmation, confirmSignup, requestEmailCode, verifyEmailCode, finishProfile, sendInviteEmail, signIn, signInWithGoogle, mfaVerifyLogin,
  requestPasswordReset, confirmPasswordReset, changePassword,
  mfaStatus, mfaEnroll, mfaActivate, mfaDisable,
  currentUser, signOut, deleteAccount,
  _test: { friendly, validateEmail, validatePassword, withTimeout, registerFail, lockInfo, clearFails },
}
