# Retoma 1.2.0

**Nenhum cliente esquecido.** App de follow-up para Windows, com versão celular, conta, sincronização e equipes.

## Rodar (igual às outras versões)
```powershell
# PowerShell como administrador, nesta pasta
npm install
npm start          # testar
npm run build      # instalador em dist\Retoma-Setup-1.2.0.exe
```
Antes de abrir esta versão, feche a anterior pelo ícone da bandeja → **Sair**.

Seus dados ficam onde sempre ficaram (`%APPDATA%\retoma\`). Na primeira abertura, o app guarda uma cópia de segurança e mostra as novidades.

## Novo na 1.2
- **Janela de computador de verdade:** abre grande, maximiza (botão ou duplo clique na barra de cima), redimensiona e arrasta. Não fica mais por cima de tudo: quem fica por cima é o flutuante.
- **Menu na esquerda** só com ícones; passe o mouse pra ver os nomes: Hoje, Retomas, Calendário, Clientes, Concluídos, Equipe, Ajuda e Configurações. No topo dele, a troca de negócio; embaixo, você e o seu papel.
- **Tela Hoje:** atrasados, hoje e próximos 7 dias, filtros (Tudo/Atrasos/Hoje/Semana e Alta/Média/Baixa), dinheiro esperando resposta, anel de "feitos hoje" e a semana em barrinhas.
- **Painel do cliente** na direita: clique no cliente e edite ali mesmo (nome, telefone, assunto, campos, prioridade, data, responsável). Botão do WhatsApp, mensagem pronta, remarcar e "Feito".
- **Ao passar o mouse** num cliente: WhatsApp, mensagem pronta e adiar.
- **Efeitos:** o ✓ estoura, a linha sai, o anel enche; zerar o dia solta confete.
- **Equipe** virou tela própria (números de cada vendedor, carteira sem dono, convites). **Clientes** lista todo mundo que já passou pelo Retoma.
- **Janela estreita** (do lado do WhatsApp): o menu vai pra baixo e o painel abre por cima.
- Atalhos: **N** novo retoma, **Ctrl+K** buscar, **Esc** volta.
- Domínio: `retomacrm.com.br` já configurado no app e no Supabase.

## Novo na 1.1
- **Entrada obrigatória:** ao abrir, escolha *Criar minha empresa* (dono/gerente) ou *Fui convidado* (vendedor). Depois do 1º login, fica salvo.
- **Convite por e-mail:** Configurações → Minha empresa → Convidar vendedor.
- **Selo no topo** mostra se você é Dono, Gerente ou Vendedor (clique pra ver a equipe).
- **Arrastar** o card flutuante e a janela principal (como a pílula).
- Antes de usar: siga o topo de `supabase/LEIA-ME.md` (rodar o SQL de novo + chave no `retoma.config.json`).

## O que tem nesta pasta
| Pasta | O que é |
|---|---|
| `src/` | O app do Windows |
| `supabase/` | Banco da nuvem (`schema.sql`) e o **guia de configuração** (`LEIA-ME.md`) |
| `web/` | Versão celular (web app que instala na tela inicial) |
| `site/` | Site de download + política de privacidade + termos de uso |
| `scripts/publicar.js` | Sobe uma versão nova pra atualização automática |
| `test/` | Testes automáticos (`npm test`) |

## Sem nuvem × com nuvem
- **Sem configurar nada:** funciona como sempre, só neste PC, com negócios, campos, configurações, tour e tudo mais.
- **Com a nuvem (Supabase, grátis):** login, sincronização, equipes, versão celular e atualização automática. Siga `supabase/LEIA-ME.md`.
