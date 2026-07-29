import { createClient } from "npm:@supabase/supabase-js@2";

const EVENT_ALIASES = {
  compra_aprovada: "compra_aprovada",
  order_approved: "compra_aprovada",
  purchase_approved: "compra_aprovada",
  compra_reembolsada: "compra_reembolsada",
  order_refunded: "compra_reembolsada",
  purchase_refunded: "compra_reembolsada",
  chargeback: "chargeback",
  subscription_canceled: "subscription_canceled",
  subscription_cancelled: "subscription_canceled",
  subscription_late: "subscription_late",
  subscription_renewed: "subscription_renewed",
  paid: "compra_aprovada",
  approved: "compra_aprovada",
  refunded: "compra_reembolsada",
  chargedback: "chargeback",
  canceled: "subscription_canceled",
  cancelled: "subscription_canceled",
  late: "subscription_late",
  renewed: "subscription_renewed",
};

const encoder = new TextEncoder();
const APP_URL = "https://app.despesamensal.com.br/";
const ACCESS_EMAIL_FROM =
  "Despesa Mensal <no-reply@auth.despesamensal.com.br>";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function pick(...values) {
  for (const value of values) {
    const candidate = text(value);
    if (candidate) return candidate;
  }
  return "";
}

async function digest(value) {
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return new Uint8Array(hash);
}

async function constantTimeEqual(left, right) {
  const [a, b] = await Promise.all([digest(left), digest(right)]);
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a[index] ^ b[index];
  }
  return difference === 0;
}

async function hmacSha1Hex(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function configuredToken(req, payload) {
  const authorization = req.headers.get("authorization") || "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  const url = new URL(req.url);
  return pick(
    req.headers.get("x-kiwify-token"),
    req.headers.get("x-webhook-token"),
    bearer,
    url.searchParams.get("token"),
    payload.token,
  );
}

async function isAuthorized(req, payload, rawBody, expectedToken) {
  const url = new URL(req.url);
  const suppliedSignature = pick(url.searchParams.get("signature")).toLowerCase();

  if (suppliedSignature) {
    const expectedSignature = await hmacSha1Hex(expectedToken, rawBody);
    return constantTimeEqual(suppliedSignature, expectedSignature);
  }

  const suppliedToken = configuredToken(req, payload);
  return Boolean(suppliedToken) &&
    await constantTimeEqual(suppliedToken, expectedToken);
}

function normalizeEvent(payload) {
  const raw = pick(
    payload.webhook_event_type,
    payload.webhook_event,
    payload.event_type,
    payload.event,
    payload.trigger,
    payload.type,
    payload.order_status,
    nested(payload, "Subscription").status,
    nested(payload, "subscription").status,
  ).toLowerCase();
  return EVENT_ALIASES[raw] || raw;
}

function nested(payload, key) {
  const value = payload[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function firstName(value) {
  return text(value).split(/\s+/)[0] || "";
}

async function accessEmailIdempotencyKey(orderId) {
  const orderHash = Array.from(await digest(orderId))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 40);
  return `kiwify-access-${orderHash}`;
}

async function sendAccessEmail({ apiKey, email, name, orderId }) {
  const safeName = escapeHtml(firstName(name));
  const greeting = safeName ? `Olá, ${safeName}!` : "Olá!";
  const idempotencyKey = await accessEmailIdempotencyKey(orderId);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    body: JSON.stringify({
      from: ACCESS_EMAIL_FROM,
      to: [email],
      subject: "Seu acesso ao Despesa Mensal está liberado",
      html: `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;background:#f2f6f3;font-family:Arial,sans-serif;color:#17221c">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f2f6f3;padding:32px 16px">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #dce7e0;border-radius:20px;overflow:hidden">
            <tr>
              <td style="background:#123b2d;padding:28px 32px;color:#ffffff">
                <div style="font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#6dd0a7;font-weight:700">Despesa Mensal</div>
                <h1 style="margin:8px 0 0;font-size:28px;line-height:1.2">Seu acesso está liberado</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:32px">
                <p style="margin:0 0 16px;font-size:17px;font-weight:700">${greeting}</p>
                <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#526158">
                  Sua compra foi aprovada e o acesso ao dashboard Despesa Mensal já está disponível.
                </p>
                <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#526158">
                  Clique no botão abaixo, escolha <strong>Criar conta</strong> e use exatamente o mesmo e-mail informado na compra.
                </p>
                <table role="presentation" cellspacing="0" cellpadding="0">
                  <tr>
                    <td style="border-radius:12px;background:#2f9b76">
                      <a href="${APP_URL}" style="display:inline-block;padding:14px 24px;color:#ffffff;text-decoration:none;font-size:16px;font-weight:700">Acessar meu dashboard</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#75827a">
                  Por segurança, não encaminhe este e-mail. Seu acesso está vinculado ao e-mail utilizado no pagamento.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`,
      text: `${greeting}

Sua compra foi aprovada e o acesso ao dashboard Despesa Mensal já está disponível.

Acesse ${APP_URL}, escolha "Criar conta" e use exatamente o mesmo e-mail informado na compra.

Por segurança, não encaminhe este e-mail. Seu acesso está vinculado ao e-mail utilizado no pagamento.`,
      tags: [
        { name: "email_type", value: "kiwify_access" },
        { name: "provider", value: "kiwify" },
      ],
    }),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason = text(result?.message) || `http_${response.status}`;
    throw new Error(`resend_${reason.slice(0, 160)}`);
  }

  return text(result?.id);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }

  const expectedToken = Deno.env.get("KIWIFY_WEBHOOK_TOKEN") || "";
  const allowedProducts = new Set(
    (Deno.env.get("KIWIFY_ALLOWED_PRODUCT_IDS") || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );

  if (!expectedToken || allowedProducts.size === 0) {
    console.error("Kiwify webhook secrets are not configured.");
    return json({ ok: false, error: "server_not_configured" }, 503);
  }

  const rawBody = await req.text();
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  if (!(await isAuthorized(req, payload, rawBody, expectedToken))) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  const customer = {
    ...nested(payload, "Customer"),
    ...nested(payload, "customer"),
    ...nested(payload, "buyer"),
  };
  const product = {
    ...nested(payload, "Product"),
    ...nested(payload, "product"),
  };
  const subscription = {
    ...nested(payload, "Subscription"),
    ...nested(payload, "subscription"),
  };

  const eventType = normalizeEvent(payload);
  const orderId = pick(
    payload.order_id,
    payload.order_ref,
    payload.sale_id,
    subscription.id,
    subscription.subscription_id,
  );
  const email = pick(customer.email, payload.customer_email, payload.email).toLowerCase();
  const customerName = pick(
    customer.full_name,
    customer.name,
    payload.customer_name,
  );
  const productId = pick(product.product_id, product.id, payload.product_id);

  if (!eventType || !orderId || !email || !productId) {
    return json({
      ok: false,
      error: "missing_required_fields",
      missing: {
        event_type: !eventType,
        order_id: !orderId,
        email: !email,
        product_id: !productId,
      },
    }, 422);
  }

  if (!allowedProducts.has(productId)) {
    return json({ ok: true, ignored: true, reason: "product_not_allowed" });
  }

  const eventKey = Array.from(await digest(rawBody))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Supabase service credentials are unavailable.");
    return json({ ok: false, error: "server_not_configured" }, 503);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.rpc("process_kiwify_webhook", {
    p_event_key: eventKey,
    p_event_type: eventType,
    p_order_id: orderId,
    p_email: email,
    p_product_id: productId,
    p_details: {
      order_ref: pick(payload.order_ref),
      order_status: pick(payload.order_status),
      sale_type: pick(payload.sale_type),
    },
  });

  if (error) {
    console.error("Kiwify webhook processing failed:", error.message);
    return json({ ok: false, error: "processing_failed" }, 500);
  }

  let emailDelivery = null;
  if (eventType === "compra_aprovada") {
    const resendApiKey = Deno.env.get("RESEND_API_KEY") || "";
    if (!resendApiKey) {
      console.error("Resend API key is not configured.");
      return json({
        ok: false,
        error: "access_email_not_configured",
        result: data,
      }, 503);
    }

    try {
      emailDelivery = await sendAccessEmail({
        apiKey: resendApiKey,
        email,
        name: customerName,
        orderId,
      });
    } catch (emailError) {
      console.error(
        "Access email delivery failed:",
        emailError instanceof Error ? emailError.message : "unknown_error",
      );
      return json({
        ok: false,
        error: "access_email_delivery_failed",
        result: data,
      }, 502);
    }
  }

  return json({
    ok: true,
    result: data,
    email_delivery: emailDelivery
      ? { sent: true, provider_id: emailDelivery }
      : { sent: false, reason: "event_does_not_require_access_email" },
  });
});
