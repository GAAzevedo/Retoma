# Graph Report - retoma  (2026-11-12)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 654 nodes · 1765 edges · 34 communities (29 shown, 5 thin omitted)
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 100 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `a7ac2889`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Telas e listas
- Processo principal e janelas
- Regras de dados e sincronização
- Login e conta (nuvem)
- Estado da tela e utilidades
- Avisos, equipe e conta
- Navegação e notificações
- Dados do pacote
- Tela de entrada (login obrigatório)
- Configurações e negócios
- Boas-vindas, assistente e tour
- Valores e datas (PC)
- Valores e datas (celular)
- Janela de login
- Editar retoma, adiar e mensagens
- Arquivo de dados (Store)
- Instalador (build)
- Concluir, distribuir e desfazer
- Arquivos e testes do banco
- Banco falso do celular (testes)
- Publicar atualização
- Pontes seguras (preload)
- Electron falso (testes)
- Banco Supabase (SQL)
- Leitura do config
- Comandos npm
- Cache offline do celular
- Painel do cliente e filtros
- Ferramentas de desenvolvimento
- Calendário
- Mensagens prontas
- Tour guiado

## God Nodes (most connected - your core abstractions)
1. `esc()` - 65 edges
2. `getClient()` - 29 edges
3. `render()` - 27 edges
4. `renderSettings()` - 27 edges
5. `showHint()` - 25 edges
6. `Sync` - 24 edges
7. `renderPane()` - 24 edges
8. `loadMeta()` - 22 edges
9. `withTimeout()` - 21 edges
10. `boot()` - 20 edges

## Surprising Connections (you probably didn't know these)
- `device()` --calls--> `Sync`  [EXTRACTED]
  test/sync.test.js → src/sync.js
- `device()` --calls--> `normalize()`  [EXTRACTED]
  test/sync.test.js → src/core.js
- `on_auth_user_created` --triggers--> `auth.users`  [EXTRACTED]
  supabase/schema.sql → test/prelude.sql
- `public.create_invite()` --reads_from--> `auth.users`  [EXTRACTED]
  supabase/schema.sql → test/prelude.sql
- `public.invite_by_email()` --reads_from--> `auth.users`  [EXTRACTED]
  supabase/schema.sql → test/prelude.sql

## Import Cycles
- None detected.

## Communities (34 total, 5 thin omitted)

### Community 0 - "Telas e listas"
Cohesion: 0.07
Nodes (81): addDays(), allView(), bizFields(), bizList(), bizOf(), bizTag(), byPrio(), calView() (+73 more)

### Community 1 - "Processo principal e janelas"
Cohesion: 0.07
Nodes (71): effectiveFeatures(), featureOn(), getSettings(), patchSettings(), acquireLock(), activeBusinesses(), afterChange(), {
  app, BrowserWindow, Tray, Menu,
  nativeImage, ipcMain, Notification, shell, screen,
  globalShortcut, clipboard, dialog, powerMonitor
} (+63 more)

### Community 2 - "Regras de dados e sincronização"
Cohesion: 0.06
Nodes (42): ACCENTS, applyFieldValues(), cleanColor(), cleanFields(), cleanPhone(), COLORS, createdFromId(), crypto (+34 more)

### Community 3 - "Login e conta (nuvem)"
Cohesion: 0.12
Nodes (50): @supabase/supabase-js, afterPrimaryLogin(), changePassword(), clearFails(), confirmPasswordReset(), confirmSignup(), currentUser(), deleteAccount() (+42 more)

### Community 4 - "Estado da tela e utilidades"
Cohesion: 0.06
Nodes (24): allData, cfVals, companyInvites, distPlan, doneAll, doneCache, donePer, DOW (+16 more)

### Community 5 - "Avisos, equipe e conta"
Cohesion: 0.17
Nodes (23): acceptPending(), accountSection(), authResend(), cancelInvite(), checkUpdate(), copyPhone(), deleteForever(), dialogBox() (+15 more)

### Community 6 - "Navegação e notificações"
Cohesion: 0.22
Nodes (13): checkNotifications(), closeBizMenu(), init(), jumpToDay(), nav(), openBizMenu(), refreshDone(), restoreDone() (+5 more)

### Community 7 - "Dados do pacote"
Cohesion: 0.18
Nodes (12): author, dependencies, electron-updater@6.3.9, @supabase/supabase-js@2.118.0, ws@^8.22.2, description, license, main (+4 more)

### Community 8 - "Tela de entrada (login obrigatório)"
Cohesion: 0.35
Nodes (16): gateCompany(), gateConfirm(), gateDone(), gateFinish(), gateForgot(), gateGoogle(), gateInvCode(), gateInvited() (+8 more)

### Community 9 - "Configurações e negócios"
Cohesion: 0.10
Nodes (29): addBiz(), addField(), applyAccent(), closeGate(), dataSection(), deleteAccountUi(), editBiz(), editField() (+21 more)

### Community 10 - "Boas-vindas, assistente e tour"
Cohesion: 0.19
Nodes (15): mainCompany(), maybeWelcome(), openCompanySetup(), openWizard(), renderRoleChip(), renderWizard(), sellerWelcome(), showWhatsNew() (+7 more)

### Community 11 - "Valores e datas (PC)"
Cohesion: 0.26
Nodes (10): addBusinessDays(), businessDays(), nextMonday(), parseValue(), planDistribution(), snoozeOptions(), sumValues(), toNum() (+2 more)

### Community 12 - "Valores e datas (celular)"
Cohesion: 0.26
Nodes (10): addBusinessDays(), businessDays(), nextMonday(), parseValue(), planDistribution(), snoozeOptions(), sumValues(), toNum() (+2 more)

### Community 13 - "Janela de login"
Cohesion: 0.33
Nodes (13): afterAuth(), authCall(), authChange(), authForgot(), authGoogle(), authLogin(), authMfa(), authReset() (+5 more)

### Community 14 - "Editar retoma, adiar e mensagens"
Cohesion: 0.14
Nodes (20): applySnooze(), closeModal(), closeMsg(), closeSnooze(), fillTemplate(), firstName(), flashSaved(), moveItem() (+12 more)

### Community 16 - "Instalador (build)"
Cohesion: 0.11
Nodes (18): build, appId, artifactName, extraResources, files, nsis, productName, publish (+10 more)

### Community 17 - "Concluir, distribuir e desfazer"
Cohesion: 0.29
Nodes (7): applyDistribute(), closeDistribute(), done(), doneFx(), goHome(), showToast(), showUndo()

### Community 18 - "Arquivos e testes do banco"
Cohesion: 0.18
Nodes (7): { app }, fs, LEGACY_DIRS, path, fs, { PGlite }, U

### Community 20 - "Publicar atualização"
Cohesion: 0.25
Nodes (7): version, dist, files, fs, path, types, url

### Community 21 - "Pontes seguras (preload)"
Cohesion: 0.29
Nodes (4): electron, { contextBridge, ipcRenderer }, { contextBridge, ipcRenderer }, { contextBridge, ipcRenderer }

### Community 22 - "Electron falso (testes)"
Cohesion: 0.29
Nodes (4): dir, fs, os, path

### Community 23 - "Banco Supabase (SQL)"
Cohesion: 0.10
Nodes (34): invites_email_idx, members_stamp, on_auth_user_created, public.accept_my_invites(), public.create_invite(), public.delete_my_account(), public.handle_new_user(), public.invite_by_email() (+26 more)

### Community 24 - "Leitura do config"
Cohesion: 0.40
Nodes (4): fs, load(), path, readJson()

### Community 25 - "Comandos npm"
Cohesion: 0.40
Nodes (5): scripts, build, publicar, start, test

### Community 29 - "Painel do cliente e filtros"
Cohesion: 0.22
Nodes (9): closePanel(), handleSearch(), renderPane(), renderScore(), setDonePer(), setOutcomeFromToast(), setPrioFilter(), setTab() (+1 more)

### Community 30 - "Ferramentas de desenvolvimento"
Cohesion: 0.33
Nodes (6): devDependencies, @electric-sql/pglite@0.2.17, electron@^31.0.0, electron-builder@^24.13.3, @electric-sql/pglite, electron-builder

### Community 31 - "Calendário"
Cohesion: 0.40
Nodes (6): changeMonth(), isLate(), renderCalendar(), selectDay(), todayStr(), updateBadge()

### Community 32 - "Mensagens prontas"
Cohesion: 0.50
Nodes (4): addTemplate(), collectTemplates(), delTemplate(), saveTemplates()

### Community 33 - "Tour guiado"
Cohesion: 0.67
Nodes (3): endTour(), nextTour(), showTourStep()

## Knowledge Gaps
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `electron` connect `Pontes seguras (preload)` to `Processo principal e janelas`, `Login e conta (nuvem)`, `Dados do pacote`, `Arquivos e testes do banco`, `Ferramentas de desenvolvimento`?**
  _High betweenness centrality (0.046) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `render()` (e.g. with `restoreDone()` and `setBizFilter()`) actually correct?**
  _`render()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Should `Telas e listas` be split into smaller, more focused modules?**
  _Cohesion score 0.06604938271604938 - nodes in this community are weakly interconnected._
- **Why does `Sync` connect `Regras de dados e sincronização` to `Processo principal e janelas`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._
- **Should `Processo principal e janelas` be split into smaller, more focused modules?**
  _Cohesion score 0.0687719298245614 - nodes in this community are weakly interconnected._
- **Why does `build` connect `Instalador (build)` to `Dados do pacote`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **Should `Regras de dados e sincronização` be split into smaller, more focused modules?**
  _Cohesion score 0.05745814307458143 - nodes in this community are weakly interconnected._