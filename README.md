# Portal Fiscal

Sistema web em Node.js com Next.js para rodar na Vercel usando PostgreSQL. O projeto inclui:

- Login administrativo
- Cadastro de clientes
- Cadastro de empresas
- Cadastro de produtos
- Tela de envio de notas fiscais com anexo
- Tela de manutenção para consultar, editar, excluir e baixar notas emitidas

## Tecnologias

- Node.js
- Next.js App Router
- PostgreSQL com `pg`
- Deploy recomendado na Vercel

## Como executar localmente

1. Instale o Node.js 20 ou superior.
2. Instale as dependências:

```bash
npm install
```

3. Crie um arquivo `.env.local` com:

```env
DATABASE_URL=postgres://usuario:senha@host:5432/banco
SESSION_SECRET=troque-por-uma-chave-grande-e-segura
ADMIN_EMAIL=admin@empresa.com
ADMIN_PASSWORD=troque-por-uma-senha-forte
```

4. Rode o projeto:

```bash
npm run dev
```

5. Acesse `http://localhost:3000`.

## Banco de dados

As tabelas são criadas automaticamente no primeiro acesso, então não é necessário rodar migration manual para iniciar.

Tabelas criadas:

- `companies`
- `customers`
- `products`
- `invoices`

## Login

- A aplicação usa um login administrativo simples com cookie de sessão.
- Configure `ADMIN_EMAIL`, `ADMIN_PASSWORD` e `SESSION_SECRET`.
- Todas as páginas internas exigem autenticação.

## Deploy na Vercel

1. Suba este projeto para um repositório Git.
2. Importe o repositório na Vercel.
3. Crie um banco PostgreSQL na Vercel ou conecte um PostgreSQL externo.
4. Configure a variável de ambiente `DATABASE_URL`.
5. Faça o deploy.

## Observações

- O arquivo da nota fiscal é salvo diretamente no PostgreSQL.
- A rota `/api/notas/[id]` permite baixar o arquivo anexado.
- Clientes, empresas e produtos podem ser editados e excluídos.
- As notas emitidas podem ser editadas, excluídas e baixadas.
