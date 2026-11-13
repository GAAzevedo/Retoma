# Retoma — instruções para o Claude

Leia isto antes de mexer no código. Depois leia o `LEIA-ME.md` (o que o usuário vê) e, se for mexer na nuvem, o `supabase/LEIA-ME.md`.
Responda sempre em português, simples e direto (o Guilherme não é programador).

## O que é
App de follow-up de clientes para Windows (Electron + HTML/CSS/JS puro, sem framework), usado junto com o **WhatsApp Desktop**.
Slogan: "Nenhum cliente esquecido". Tem versão celular (`web/`, PWA), site (`site/`) e nuvem Supabase (login, sincronização, equipes).
Histórico completo e próximos passos: doc `ESTADO-RETOMA.md` no Projeto "App Retoma" do claude.ai.

## Regras de ouro (nunca quebrar)
- O app **não toca no WhatsApp**: não lê a tela, não injeta nada, não automatiza envio. Só abre `whatsapp://send?phone=55...` (ou com `&text=`).
- **Nada em cima de nada**: nenhum elemento pode sobrepor outro, em nenhum tamanho de janela. Testar 1600, 1180, 960, 760 e 420 px antes de entregar.
- Toda interação tem animação perceptível; quanto mais importante a ação, mais evidente o efeito. Visual escuro, moderno e minimalista.
- Cliente duplicado é identificado **só pelo telefone** (últimos 8 dígitos, sem +55/DDD), nunca pelo nome.
- A madeira da Construpac não usa m³ (os campos são configuráveis e podem ser desligados).
- Concluir (✓) move para Concluídos; nunca apagar dados do usuário sem confirmação.
- Nunca colocar a chave `service_role` / `secret` do Supabase no código. A `sb_publishable_...` pode (é pública; quem protege é o RLS).

## Como trabalhamos
- **Uma pasta só, uma versão só.** Nunca criar pasta nova por versão. Editar no lugar e subir o número em `package.json` (`version`).
- O código fica no GitHub (`GAAzevedo/Retoma`) e no PC dele em `C:\Users\guilh\Desktop\App RETOMA\Retoma`.
- Não procurar em chats antigos, a não ser que ele peça. A fonte da verdade é este arquivo + o ESTADO-RETOMA.md.
- Ao entregar: dizer em poucas linhas o que mudou e se ele precisa rodar `npm install` (só quando mudar dependência no `package.json`). Senão é só bandeja → Sair e `npm start`.
- Ao fechar uma entrega grande, atualizar o ESTADO-RETOMA.md do Projeto.

## Mapa do código (Graphify)
- Antes de abrir arquivos de código, leia `graphify-out/GRAPH_REPORT.md` para saber onde está cada coisa, e só depois abra os arquivos necessários.
- Antes de cada commit que mude código, atualize o mapa (`pip install "graphifyy[sql]"` se não tiver — com `[sql]`, senão o banco some do mapa —, depois `graphify update .`) e inclua `graphify-out/` no commit. Se ele recusar por ter menos itens que antes (código apagado), use `graphify update . --force`.
- Os nomes dos grupos ficam em `graphify-out/.graphify_labels.json` (em português, 2 a 5 palavras). Se aparecer grupo novo como "Community N", dê um nome, apague o `.graphify_labels.json.sig` e rode `graphify cluster-only .`.
- Só o mapa vai pro GitHub (`GRAPH_REPORT.md`, `graph.json`, `graph.html`, nomes e análise). Cache, manifest e caminhos locais estão no `.gitignore`.
- Não usar `graphify hook install` nem `graphify claude install`: o mapa é atualizado só por quem faz o commit.

## Mapa rápido (`src/`)
| Arquivo | Função |
|---|---|
| `main.js` | Processo principal: janelas, bandeja, IPC, notificações, atalhos, arrasto, PDF do relatório |
| `index.html` + `app.js` | App principal (Hoje, Retomas, Calendário, Clientes, Concluídos, Equipe, Configurações) |
| `compact.html` / `pill.html` | Card flutuante e pílula mini |
| `preload*.js` | Pontes seguras entre as telas e o main |
| `store.js` | Lê/grava `%APPDATA%\retoma\followup-data.json`, migrações e backups |
| `core.js` | Regras de dados sem Electron (negócios, configurações, planos, `normalize`) |
| `money.js` | Lê valores ("7,1 K", "R$ 2.500") e calcula datas de Adiar/Distribuir (cópia em `web/money.js`) |
| `cloud.js` / `auth.js` / `sync.js` | Supabase, login (6 pilares) e sincronização offline primeiro |
| `config.js` | Lê `retoma.config.json` |
| `updater.js` | Atualização automática |

Os dados do usuário ficam em `%APPDATA%\retoma\`, fora do código: atualizar o código não apaga agendamentos.

## Rodar e testar
```powershell
npm install        # só na 1ª vez ou quando mudar dependência
npm start          # abrir o app
npm test           # testes de banco, sincronização e login (PGlite, sem internet)
npm run build      # instalador em dist\ (PowerShell como administrador)
```
No ambiente do Claude: Electron real com Xvfb + Playwright (`_electron`), `XDG_CONFIG_HOME` apontando para dados de teste; nuvem de teste com `RETOMA_FAKE_CLOUD=1` (`test/fake-supabase.js`).
