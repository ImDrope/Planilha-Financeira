# Preparação do Supabase — Despesa Mensal

Esta etapa cria o banco e o isolamento por usuário sem colocar credenciais no GitHub.

## Aplicar o esquema

1. No projeto de desenvolvimento, abra **SQL Editor**.
2. Copie todo o arquivo `supabase/migrations/202607220001_initial_schema.sql`.
3. Execute uma única vez e confirme as tabelas em **Database → Tables**.
4. Em **Database → Policies**, confirme RLS habilitado em todas as tabelas.

Mantenha Data API e RLS automático ligados, exposição automática de novas tabelas desligada e somente autenticação por e-mail ativa. Nunca coloque `service_role`, `sb_secret_...` ou a senha do banco no site.

## Liberar uma conta de teste

Antes do cadastro, adicione em `access_entitlements`: e-mail em minúsculas, `provider=manual`, `status=active`, início atual e fim vazio. Ao cadastrar, o gatilho associa automaticamente o comprador ao `user_id`. Mais tarde, o webhook da plataforma de vendas fará essa mesma operação.

## Segurança implementada

- Visitantes não autenticados não acessam tabelas.
- Cada usuário só acessa registros com seu próprio `user_id`.
- Dados financeiros exigem autorização `active` ou `trial` vigente.
- Reembolso, chargeback, cancelamento ou expiração bloqueiam sem apagar dados.
- Autorizações são somente leitura para compradores.

## Migração local planejada

Os IDs atuais serão preservados. A importação calculará uma impressão digital, fará upsert, registrará o resultado em `local_imports` e só marcará a migração como concluída após conferir as contagens. O `localStorage` permanecerá intacto até a confirmação do usuário.

