# IntegraÃ§Ã£o Kiwify â€” Despesa Mensal

O webhook da Kiwify libera ou bloqueia o acesso sem expor chaves no navegador.

## Eventos tratados

- `compra_aprovada` e `subscription_renewed`: acesso ativo.
- `compra_reembolsada`: acesso reembolsado.
- `chargeback`: acesso bloqueado por chargeback.
- `subscription_canceled`: acesso cancelado.
- `subscription_late`: acesso expirado atÃ© a regularizaÃ§Ã£o.

Eventos repetidos sÃ£o reconhecidos pelo conteÃºdo integral da requisiÃ§Ã£o e nÃ£o
geram processamento duplicado. O log guarda apenas os campos operacionais
necessÃ¡rios; CPF, telefone e demais dados do pagamento nÃ£o sÃ£o persistidos.

## 1. Aplicar a migraÃ§Ã£o

No SQL Editor do Supabase, execute uma vez:

`supabase/migrations/202607290001_kiwify_webhook.sql`

Ela cria o log privado de eventos e a operaÃ§Ã£o transacional que atualiza
`access_entitlements`.

## 2. Configurar os Secrets

Em **Supabase â†’ Edge Functions â†’ Secrets**, crie:

- `KIWIFY_WEBHOOK_TOKEN`: uma senha aleatÃ³ria longa, exclusiva para o webhook.
- `KIWIFY_ALLOWED_PRODUCT_IDS`: ID do produto vendido. Para mais de um produto,
  separe os IDs por vÃ­rgula.
- `RESEND_API_KEY`: chave do Resend com permissÃ£o somente de envio e restrita ao
  domÃ­nio `auth.despesamensal.com.br`.

NÃ£o coloque esses valores no GitHub, no JavaScript do site ou em mensagens.
`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` sÃ£o disponibilizados
automaticamente Ã  Edge Function pelo Supabase.

Quando uma compra Ã© aprovada, a funÃ§Ã£o envia ao comprador um e-mail transacional
com o botÃ£o **Acessar meu dashboard**. O comprador deve criar a conta usando
exatamente o mesmo e-mail informado no pagamento. O envio usa o ID do pedido
como chave de idempotÃªncia para impedir mensagens duplicadas durante as
tentativas automÃ¡ticas da Kiwify.

## 3. Implantar a funÃ§Ã£o

Implante `supabase/functions/kiwify-webhook`. A funÃ§Ã£o precisa aceitar chamadas
externas sem JWT do Supabase (`verify_jwt = false`), pois a autenticaÃ§Ã£o Ã© feita
pelo token secreto da Kiwify dentro do prÃ³prio cÃ³digo.

URL esperada:

`https://uumczltusdkpjtujphki.supabase.co/functions/v1/kiwify-webhook`

## 4. Criar o webhook na Kiwify

Em **Apps â†’ Webhooks â†’ Criar webhook**:

1. Selecione somente o produto da Despesa Mensal.
2. Cole a URL da funÃ§Ã£o.
3. Selecione os eventos listados acima.
4. No campo **Token**, informe exatamente o mesmo valor salvo em
   `KIWIFY_WEBHOOK_TOKEN`.
5. Salve.

## 5. Testar

Use **Testar webhook** na Kiwify e depois confira:

1. O log da Kiwify deve mostrar resposta HTTP `200`.
2. `commerce_webhook_events` deve receber uma linha `processed`.
3. `access_entitlements` deve conter o e-mail de teste com `provider=kiwify`.
4. Um segundo envio idÃªntico deve retornar `duplicate=true`, sem duplicar acesso.
5. Teste tambÃ©m reembolso ou chargeback e confirme que o acesso deixa de estar
   ativo sem apagar os dados financeiros.
6. Em uma compra aprovada, confirme em **Resend â†’ Emails** que a mensagem
   â€œSeu acesso ao Despesa Mensal estÃ¡ liberadoâ€ foi entregue. Reenvie o mesmo
   webhook e confirme que o Resend nÃ£o criou uma segunda mensagem.

Se houver erro, use **Ver logs** na Kiwify e os logs da Edge Function no
Supabase. Nunca copie tokens ou chaves secretas para tickets, prints ou chats.
