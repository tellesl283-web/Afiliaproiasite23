# AfiliAI Gerente — servidor do gerente de IA (24 horas)

Servidor que roda sozinho, mesmo com o seu celular desligado:

- todo dia, no horário definido, a **IA gerente** analisa seus produtos e **propõe** posts e campanhas;
- tudo entra como **pendente**. Nada é publicado nem gasto sem a sua aprovação;
- você aprova pelo celular em `https://SEU-ENDEREÇO/approve`;
- os posts aprovados ficam numa fila que o **Make** ou o **n8n** lê e publica nas redes.

## Regras de segurança (já no código)
1. A IA só cria itens com status `pendente`. Só você muda para `aprovado`.
2. Campanhas pagas respeitam `DAILY_LIMIT`. Passou do limite, a aprovação é recusada.
3. Todas as rotas de dados exigem o `ADMIN_TOKEN` (cabeçalho `Authorization: Bearer ...`).
4. Links de produto só aceitam `https://` ou `http://`.
5. Este projeto **não** guarda senha, conta bancária nem cartão. Não adicione isso.

**Limite importante:** este projeto não se conecta às APIs de anúncios pagos. Uma campanha aprovada fica registrada como `aprovado`; você (ou uma automação sua) executa o anúncio. Posts orgânicos são publicados via Make/n8n.

## 1. Rodar no computador (teste)
1. Instale o Node.js 20 ou mais novo.
2. Nesta pasta: `npm install`
3. Copie `.env.example` para `.env` e preencha `ANTHROPIC_API_KEY` (crie em console.anthropic.com) e um `ADMIN_TOKEN` longo e aleatório.
4. Rode: `node --env-file=.env server.js`
5. Cadastre um produto:
   `curl -X POST localhost:3000/api/products -H "Authorization: Bearer SEU_TOKEN" -d '{"nome":"Produto X","plataforma":"Hotmart","preco":97,"comissao":40,"link":"https://seu-link-de-afiliado"}'`
6. Rode a rotina na hora: `curl -X POST localhost:3000/api/routine -H "Authorization: Bearer SEU_TOKEN"`
7. Abra `http://localhost:3000/approve`, informe o token e aprove ou rejeite.

## 2. Colocar no ar 24 horas
Use um serviço que rode Node.js continuamente e tenha **disco persistente** (Railway, Render com disco, Fly.io ou uma VPS). Defina as variáveis do `.env.example` no painel do serviço, comando de início `npm start`, e aponte `DATA_FILE` para o disco persistente (sem isso os dados somem a cada reinício). Use sempre HTTPS. Depois ajuste `BASE_URL` para o endereço do serviço.

## 3. Aviso no Telegram (opcional)
Crie um bot com o @BotFather, pegue o token e o seu chat id e preencha `TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID`. Quando a IA propuser algo, você recebe o link `/approve`.

## 4. Publicar os posts aprovados com Make ou n8n
Cenário (Make) ou workflow (n8n), a cada 15 minutos:
1. **Agendador** (Schedule) a cada 15 min.
2. **HTTP GET** em `https://SEU-ENDEREÇO/api/queue/due` com o cabeçalho `Authorization: Bearer SEU_TOKEN`. Devolve os posts aprovados cujo horário já chegou.
3. **Para cada item** (Iterator no Make, Split no n8n): módulo da rede (Instagram/Facebook Pages, ou outra) publicando `titulo`, `texto` e `hashtags`.
4. **HTTP POST** em `https://SEU-ENDEREÇO/api/items/{id}/published` (mesmo cabeçalho) para marcar como publicado e não repetir.

Observação: o Instagram exige conta profissional ligada a uma página do Facebook. Siga as regras de cada plataforma.

## Painel conectado (o AfiliAI Pro dentro do servidor)
Ao abrir o endereço principal do servidor (`https://SEU-ENDEREÇO/`), você vê o painel AfiliAI Pro já ligado a ele. Na primeira vez, ele pede o `ADMIN_TOKEN`.

- Os dados do painel (produtos, campanhas, agenda, cofre criptografado) ficam salvos no servidor.
- Os produtos do painel são enviados ao servidor, e o gerente 24 horas trabalha em cima deles. Depois de conectar, o painel é a fonte dos produtos: cadastre por ele, não pela rota `/api/products`.
- A aba **Servidor** mostra o que o gerente propôs e deixa você aprovar ou rejeitar.
- Os botões de IA do painel (analisar produto, criar campanha, assistente, gerente) passam pelo servidor, usam a sua chave da Anthropic e cobram do seu uso. O limite diário de chamadas é `AI_DAILY_CAP` (padrão 100).
- Os backups e a vitrine são baixados direto pelo navegador.

A versão do painel publicada dentro do Claude **não** consegue falar com o servidor (o ambiente dela bloqueia conexões externas). Use o painel servido pelo seu endereço.

## 5. Usar o Claude Code para continuar
Abra esta pasta no Claude Code e peça:

> Leia o README e o código. Me ajude a instalar, testar, hospedar e depois a publicar os posts aprovados direto pela API oficial do Instagram, sem Make. Mantenha as regras: nada é publicado ou gasto sem status "aprovado", o limite diário continua valendo e nenhum dado bancário é guardado.

## Rotas
| Rota | O que faz |
|---|---|
| GET / | Painel AfiliAI Pro conectado (pede o token) |
| GET /approve | Página simples de aprovação (pede o token) |
| GET, PUT /api/state | Estado do painel |
| POST /api/ai | Chamada de IA usada pelo painel |
| GET /api/items?status=pendente | Lista itens |
| POST /api/items/:id/approve, /reject | Decide um item |
| GET /api/queue/due | Posts aprovados prontos para publicar |
| POST /api/items/:id/published | Marca como publicado |
| GET, POST /api/products | Lista e cadastra produtos |
| POST /api/routine | Roda a rotina da IA agora |
| GET /health | Teste de funcionamento |
