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
    return json({ ok: false, error: "product_not_allowed" }, 403);
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

  return json({ ok: true, result: data });
});

