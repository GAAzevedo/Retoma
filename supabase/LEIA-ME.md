# Retoma 1.1 — o que fazer no Supabase (≈10 min)

> O endereço `https://kzelhmuooqaqysmlauit.supabase.co` mostrar `{"error":"requested path is invalid"}` no navegador é **normal**: ele é a porta do app, não uma página.

## 1. Rodar o SQL de novo (tem funções novas de convite)
**SQL Editor → New query →** cole todo o `supabase/schema.sql` desta pasta (1.1.0) → **Run** → *Success*. Não apaga nada.

## 2. Chave pública no app
**Project Settings → API Keys →** copie a chave **anon / public** (começa com `eyJ`).
Cole no arquivo **`retoma.config.json`** desta pasta, em `"supabaseAnonKey": "..."` (ou mande pro Claude que ele coloca).
⚠️ Nunca use a `service_role` / `secret` no app.

## 3. Confirmação de e-mail: desligada por enquanto
**Authentication → Sign In / Providers → Email → Confirm email = OFF → Save.**
(Sem e-mail próprio, o Supabase só manda e-mail pra quem é da equipe do projeto.)

## 4. E-mails com código (convite, confirmação, senha)
**Authentication → Emails → Templates.** Nos três modelos abaixo, troque assunto e texto:

**Magic Link** (é o e-mail de convite) e **Confirm signup**
- Assunto: `Seu código do Retoma`
- Texto:
```html
<h2>Retoma</h2>
<p>Seu código de acesso é:</p>
<p style="font-size:28px;font-weight:bold;letter-spacing:6px">{{ .Token }}</p>
<p>Recebeu um convite da sua equipe? Baixe e abra o Retoma, escolha <b>Fui convidado</b>, digite este e-mail e o código.</p>
<p>Se não foi você, ignore este e-mail.</p>
```
**Reset Password**: igual ao passo 4 do guia antigo (abaixo), com `{{ .Token }}`.

E em **Authentication → Sign In / Providers → Email**: *Email OTP Expiration* = **86400** (o código do convite vale 24 h; depois o vendedor pede outro no próprio app).

## 5. E-mail próprio (quando o domínio da Hostinger estiver ativo)
1. Hostinger → **E-mails** → crie `contato@seudominio.com.br`.
2. Supabase → **Authentication → Emails → SMTP Settings → Enable custom SMTP**:
   - Sender email: `contato@seudominio.com.br` · Sender name: `Retoma`
   - Host: `smtp.hostinger.com` · Port: `465` · Username: o e-mail · Password: a senha do e-mail
3. **Authentication → Rate Limits →** e-mails por hora: `30` (ou mais).
4. Volte o **Confirm email = ON** (passo 3).

Até aqui, os convites por e-mail só chegam pra e-mails da equipe do projeto Supabase. Pros outros, o gerente passa o **código da loja** (aparece junto no convite) e o vendedor escolhe *Fui convidado → Tenho o código da loja*.

## 6. Site e versão celular na Hostinger (quando tiver o domínio)
Painel → **Gerenciador de arquivos → public_html**:
- envie o conteúdo da pasta `site/` direto em `public_html/`
- crie `public_html/app/` e envie o conteúdo de `web/` (preencha `web/config.js` com a mesma URL e chave *anon*)
- no Supabase, em **Authentication → URL Configuration → Redirect URLs**, adicione `https://seudominio.com.br/app/`

---

# Guia completo (1.0)

## Configurar a nuvem do Retoma (referência)

Sem isto o Retoma funciona normal, só neste computador. Com isto você ganha: **conta, sincronização entre PC/notebook/celular, equipes (lojas), atualização automática e a versão celular**.

Tudo é grátis no começo (plano Free do Supabase: 50 mil usuários, 500 MB de banco e 1 GB de arquivos).

---

## 1. Criar o projeto no Supabase
1. Entre em **https://supabase.com** → *Start your project* → entre com o GitHub ou e-mail.
2. *New project*:
   - **Name:** `retoma`
   - **Database password:** gere uma senha forte e **guarde** (não vai no app).
   - **Region:** `South America (São Paulo)`.
3. Espere uns 2 minutos até o projeto ficar pronto.

## 2. Criar as tabelas e as regras de acesso
1. Menu da esquerda → **SQL Editor** → *New query*.
2. Abra o arquivo **`supabase/schema.sql`** desta pasta, copie **tudo** e cole.
3. Clique em **Run**. Tem que aparecer *Success. No rows returned*.

> Pode rodar de novo quando vier uma versão nova do schema: ele não apaga nada.

## 3. Login por e-mail
**Authentication → Sign In / Providers → Email**
- *Enable Email provider*: ligado
- *Confirm email*: **ligado** (recomendado)
- *Secure password change*: ligado

**Authentication → Policies → Password** (ou *Attack Protection*, conforme a tela):
- *Minimum password length*: **8**
- *Password requirements*: letras e números

## 4. E-mail com código (esqueci a senha)
O app pede um **código de 6 números** pra trocar a senha (funciona melhor no Windows que um link).

**Authentication → Emails → Templates → Reset Password**. Troque o conteúdo por:

- **Subject:** `Seu código do Retoma`
- **Body:**
```html
<h2>Trocar a senha do Retoma</h2>
<p>Seu código é:</p>
<p style="font-size:28px;font-weight:bold;letter-spacing:6px">{{ .Token }}</p>
<p>Digite no Retoma pra criar uma senha nova. Se não foi você, ignore este e-mail.</p>
```

(Opcional) **Confirm signup** pode ficar com o link padrão.

> O e-mail grátis do Supabase manda poucas mensagens por hora. Quando tiver mais usuários, configure um SMTP próprio em **Authentication → Emails → SMTP Settings** (ex.: o e-mail da Alvamind ou o Resend).

## 5. Endereços permitidos (login com Google e celular)
**Authentication → URL Configuration**
- **Site URL:** o endereço do site (passo 9) ou, por enquanto, `http://127.0.0.1:53682`
- **Redirect URLs** → *Add URL*, uma por vez:
  - `http://127.0.0.1:53682/callback`
  - `http://127.0.0.1:53683/callback`
  - `http://127.0.0.1:53684/callback`
  - `http://127.0.0.1:53685/callback`
  - o endereço da versão celular (passo 8), ex.: `https://retoma.alvamind.com.br/app/`

## 6. Login com Google (opcional, mas recomendado)
1. **https://console.cloud.google.com** → crie um projeto `Retoma`.
2. *APIs e serviços → Tela de consentimento OAuth*: tipo **Externo**, nome `Retoma`, seu e-mail. Publique.
3. *Credenciais → Criar credenciais → ID do cliente OAuth* → tipo **Aplicativo da Web**.
   - *URIs de redirecionamento autorizados*: `https://SEU-PROJETO.supabase.co/auth/v1/callback`
     (copie o endereço exato em Supabase → Authentication → Providers → Google → *Callback URL*)
4. Copie o **ID do cliente** e a **chave secreta**.
5. Supabase → **Authentication → Providers → Google** → ligue, cole os dois → *Save*.

## 7. Atualização automática (pasta pública de versões)
1. Supabase → **Storage** → *New bucket* → nome **`releases`** → marque **Public bucket** → *Save*.
2. Pra publicar uma versão nova (você, no seu PC, na pasta da versão):
   ```powershell
   npm run build
   $env:SUPABASE_URL="https://SEU-PROJETO.supabase.co"
   $env:SUPABASE_SERVICE_KEY="(Project Settings → API → service_role)"
   npm run publicar
   ```
   - A **service_role** é secreta: **nunca** coloque no `retoma.config.json`, no site nem no celular. Só nesse comando.
   - O comando mostra o **link de download** do instalador, pra colocar no site.
3. Quem tem o Retoma instalado recebe a versão nova sozinho (em até 6 horas ou ao abrir) e vê "Reiniciar e atualizar" no ícone da bandeja.

## 8. Ligar o app à nuvem
1. Supabase → **Project Settings → API**: copie **Project URL** e a chave **anon public**.
2. Na pasta da versão (ex.: `App RETOMA\1.0.0\`), copie `retoma.config.example.json` com o nome **`retoma.config.json`** e preencha:
   ```json
   {
     "supabaseUrl": "https://SEU-PROJETO.supabase.co",
     "supabaseAnonKey": "eyJ...",
     "updateUrl": "https://SEU-PROJETO.supabase.co/storage/v1/object/public/releases",
     "siteUrl": "https://retoma.alvamind.com.br",
     "webAppUrl": "https://retoma.alvamind.com.br/app/"
   }
   ```
   - No `npm start` ele é lido dessa pasta. No `npm run build` ele vai junto pro instalador.
   - A chave *anon* é pública por natureza: quem protege os dados são as regras do passo 2.
3. Abra o Retoma → Configurações → **Entrar** / **Criar conta**. Seus retomas sobem pra sua conta.

## 9. Versão celular e site
- **Celular:** a pasta **`web/`**. Preencha `web/config.js` com a mesma URL e chave *anon*, e publique a pasta num endereço **https** (hospedagem da Alvamind, Netlify Drop, Vercel…). No celular, abra o endereço → menu do navegador → **Adicionar à tela inicial**.
- **Site de download:** a pasta **`site/`** (página inicial, política de privacidade e termos). Preencha `site/config.js` com o link do instalador (passo 7) e o da versão celular. Em `privacidade.html` e `termos.html`, troque os campos em amarelo (razão social, CNPJ, e-mail, foro).

## 10. Conferir
- Configurações → Conta mostra "✓ Sincronizado às hh:mm" e a bolinha verde no topo.
- Crie um retoma no PC → abra a versão celular → ele aparece.
- Loja: Configurações → seu negócio → Tipo **Loja** → **Convidar vendedor** → a outra pessoa entra com o código em Configurações → Conta → **Entrar numa loja**.

---

### Testes automáticos (pra quem for mexer no código)
```powershell
npm install
npm test        # regras do banco (42), sincronização entre aparelhos (30), login (34)
```
Eles rodam num Postgres local (PGlite) com este mesmo `schema.sql`, sem precisar do Supabase.
