# Graph Report - Retoma  (2026-11-12)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 610 nodes · 1671 edges · 29 communities (24 shown, 5 thin omitted)
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 100 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `1b449715`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Community 0
- Community 1
- Community 2
- Community 3
- Community 4
- Community 5
- Community 6
- Community 7
- Community 8
- Community 9
- Community 10
- Community 11
- Community 12
- Community 13
- Community 14
- Community 15
- Community 16
- Community 17
- Community 18
- Community 19
- Community 20
- Community 21
- Community 22
- Community 23
- Community 24
- Community 25
- Community 26

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
- `boot()` --calls--> `load()`  [EXTRACTED]
  src/main.js → src/config.js
- `getMeta()` --calls--> `load()`  [EXTRACTED]
  src/main.js → src/config.js
- `initCloud()` --calls--> `currentUser()`  [EXTRACTED]
  src/main.js → src/auth.js

## Import Cycles
- None detected.

## Communities (29 total, 5 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.07
Nodes (79): addDays(), allView(), bizFields(), bizList(), bizOf(), bizTag(), byPrio(), calView() (+71 more)

### Community 1 - "Community 1"
Cohesion: 0.07
Nodes (71): effectiveFeatures(), featureOn(), getSettings(), patchSettings(), acquireLock(), activeBusinesses(), afterChange(), {
  app, BrowserWindow, Tray, Menu,
  nativeImage, ipcMain, Notification, shell, screen,
  globalShortcut, clipboard, dialog, powerMonitor
} (+63 more)

### Community 2 - "Community 2"
Cohesion: 0.06
Nodes (42): ACCENTS, applyFieldValues(), cleanColor(), cleanFields(), cleanPhone(), COLORS, createdFromId(), crypto (+34 more)

### Community 3 - "Community 3"
Cohesion: 0.12
Nodes (50): @supabase/supabase-js, afterPrimaryLogin(), changePassword(), clearFails(), confirmPasswordReset(), confirmSignup(), currentUser(), deleteAccount() (+42 more)

### Community 4 - "Community 4"
Cohesion: 0.05
Nodes (42): addTemplate(), allData, cfVals, changeMonth(), collectTemplates(), companyInvites, delTemplate(), distPlan (+34 more)

### Community 5 - "Community 5"
Cohesion: 0.15
Nodes (29): acceptPending(), accountSection(), applyAccent(), authResend(), cancelInvite(), checkUpdate(), copyPhone(), deleteAccountUi() (+21 more)

### Community 6 - "Community 6"
Cohesion: 0.12
Nodes (26): checkNotifications(), closeBizMenu(), closePanel(), handleSearch(), init(), jumpToDay(), nav(), openBizMenu() (+18 more)

### Community 7 - "Community 7"
Cohesion: 0.13
Nodes (18): author, dependencies, electron-updater@6.3.9, @supabase/supabase-js@2.118.0, ws@^8.22.2, description, devDependencies, @electric-sql/pglite@0.2.17 (+10 more)

### Community 8 - "Community 8"
Cohesion: 0.29
Nodes (18): closeGate(), gateCompany(), gateConfirm(), gateDone(), gateFinish(), gateForgot(), gateGoogle(), gateInvCode() (+10 more)

### Community 9 - "Community 9"
Cohesion: 0.17
Nodes (16): addBiz(), addField(), dataSection(), editBiz(), editField(), fieldsEditor(), removeField(), renderSettings() (+8 more)

### Community 10 - "Community 10"
Cohesion: 0.19
Nodes (15): mainCompany(), maybeWelcome(), openCompanySetup(), openWizard(), renderRoleChip(), renderWizard(), sellerWelcome(), showWhatsNew() (+7 more)

### Community 11 - "Community 11"
Cohesion: 0.26
Nodes (10): addBusinessDays(), businessDays(), nextMonday(), parseValue(), planDistribution(), snoozeOptions(), sumValues(), toNum() (+2 more)

### Community 12 - "Community 12"
Cohesion: 0.26
Nodes (10): addBusinessDays(), businessDays(), nextMonday(), parseValue(), planDistribution(), snoozeOptions(), sumValues(), toNum() (+2 more)

### Community 13 - "Community 13"
Cohesion: 0.33
Nodes (13): afterAuth(), authCall(), authChange(), authForgot(), authGoogle(), authLogin(), authMfa(), authReset() (+5 more)

### Community 14 - "Community 14"
Cohesion: 0.19
Nodes (13): closeModal(), closeMsg(), closeSnooze(), fillTemplate(), firstName(), openClientRetoma(), openDetailDrawer(), openMsg() (+5 more)

### Community 16 - "Community 16"
Cohesion: 0.17
Nodes (12): build, appId, artifactName, extraResources, files, productName, publish, win (+4 more)

### Community 17 - "Community 17"
Cohesion: 0.20
Nodes (12): applyDistribute(), applySnooze(), closeDistribute(), done(), flashSaved(), goHome(), moveItem(), persist() (+4 more)

### Community 18 - "Community 18"
Cohesion: 0.18
Nodes (7): { app }, fs, LEGACY_DIRS, path, fs, { PGlite }, U

### Community 20 - "Community 20"
Cohesion: 0.25
Nodes (7): version, dist, files, fs, path, types, url

### Community 21 - "Community 21"
Cohesion: 0.29
Nodes (4): electron, { contextBridge, ipcRenderer }, { contextBridge, ipcRenderer }, { contextBridge, ipcRenderer }

### Community 22 - "Community 22"
Cohesion: 0.29
Nodes (4): dir, fs, os, path

### Community 23 - "Community 23"
Cohesion: 0.33
Nodes (6): nsis, allowToChangeInstallationDirectory, deleteAppDataOnUninstall, oneClick, perMachine, shortcutName

### Community 24 - "Community 24"
Cohesion: 0.40
Nodes (4): fs, load(), path, readJson()

### Community 25 - "Community 25"
Cohesion: 0.40
Nodes (5): scripts, build, publicar, start, test

## Knowledge Gaps
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `electron` connect `Community 21` to `Community 1`, `Community 18`, `Community 3`, `Community 7`?**
  _High betweenness centrality (0.053) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `render()` (e.g. with `restoreDone()` and `setBizFilter()`) actually correct?**
  _`render()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.07172995780590717 - nodes in this community are weakly interconnected._
- **Why does `Sync` connect `Community 2` to `Community 1`?**
  _High betweenness centrality (0.030) - this node is a cross-community bridge._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.0687719298245614 - nodes in this community are weakly interconnected._
- **Why does `build` connect `Community 16` to `Community 23`, `Community 7`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.05745814307458143 - nodes in this community are weakly interconnected._