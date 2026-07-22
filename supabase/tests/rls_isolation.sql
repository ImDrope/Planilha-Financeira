-- Roteiro de validação para o projeto de desenvolvimento.
-- 1. Crie duas contas confirmadas e duas autorizações ativas.
-- 2. Com o JWT de A: INSERT próprio funciona; SELECT só retorna A; escrita com user_id B falha.
-- 3. Repita invertendo A e B.
-- 4. Mude A para refunded: consultas financeiras de A devem retornar zero linhas ou erro de política.
-- 5. Sem JWT: nenhuma tabela public deve retornar dados.
-- 6. Reative A: os mesmos registros devem reaparecer, sem terem sido excluídos.
-- A suíte automatizada usará dois clientes autenticados; este arquivo não contém senhas.

