# Preparação do Supabase — Despesa Mensal

Esta etapa cria o banco e o isolamento por usuário sem colocar credenciais no GitHub.

## Aplicar o esquema

1. No projeto de desenvolvimento, abra **SQL Editor**.
2. Copie todo o arquivo `supabase/migrations/202607220001_initial_schema.sql`.
3. Execute uma única vez e confirme as tabelas em **Database → Tables**.
4. Em **Database → Policies**, confirme RLS habilitado em todas as tabelas.

Depois, execute também `supabase/migrations/202607220002_financial_state_sync.sql`. Essa migração cria o estado financeiro sincronizado usado pela versão atual do front-end. O `localStorage` passa a funcionar como cache local e, na primeira sessão de uma conta ainda vazia, seus dados existentes são importados automaticamente para a nuvem.

Mantenha Data API e RLS automático ligados, exposição automática de novas tabelas desligada e somente autenticação por e-mail ativa. Nunca coloque `service_role`, `sb_secret_...` ou a senha do banco no site.

## Liberar uma conta de teste

Antes do cadastro, adicione em `access_entitlements`: e-mail em minúsculas, `provider=manual`, `status=active`, início atual e fim vazio. Ao cadastrar, o gatilho associa automaticamente o comprador ao `user_id`. Mais tarde, o webhook da plataforma de vendas fará essa mesma operação.

## Segurança implementada

- Visitantes não autenticados não acessam tabelas.
- Cada usuário só acessa registros com seu próprio `user_id`.
- Dados financeiros exigem autorização `active` ou `trial` vigente.
- Reembolso, chargeback, cancelamento ou expiração bloqueiam sem apagar dados.
- Autorizações são somente leitura para compradores.

## Migração local

O estado local existente é preservado e enviado somente após autenticação e validação do acesso comercial. Se já existir um estado remoto, ele prevalece e atualiza o cache do dispositivo. O `localStorage` não é apagado, permitindo recuperação offline em caso de falha temporária de rede.

