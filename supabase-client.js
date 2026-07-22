(() => {
  "use strict";

  const config = window.DESPESA_MENSAL_CONFIG || {};
  const configured = Boolean(
    window.supabase?.createClient
    && /^https:\/\/[a-z0-9]+\.supabase\.co$/.test(config.supabaseUrl || "")
    && String(config.supabasePublishableKey || "").startsWith("sb_publishable_")
  );

  const client = configured
    ? window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storageKey: "despesa-mensal-auth"
        }
      })
    : null;

  function requireClient() {
    if (!client) throw new Error("A conexão segura ainda não foi configurada.");
    return client;
  }

  function friendlyError(error) {
    const message = String(error?.message || error || "Não foi possível concluir a operação.");
    const translations = [
      [/invalid login credentials/i, "E-mail ou senha incorretos."],
      [/email not confirmed/i, "Confirme seu e-mail antes de entrar."],
      [/user already registered/i, "Já existe uma conta com este e-mail."],
      [/password should be at least/i, "A senha não atende aos requisitos mínimos."],
      [/email rate limit|over_email_send_rate_limit/i, "O limite de envio de e-mails foi atingido. Aguarde até 1 hora antes de tentar novamente."],
      [/over_request_rate_limit|too many requests|rate limit/i, "Muitas tentativas. Aguarde alguns minutos e tente novamente."],
      [/token has expired|otp.*expired/i, "Este link expirou. Solicite um novo e-mail."],
      [/token.*invalid|invalid.*otp/i, "Este link de confirmação não é válido. Solicite um novo."],
      [/same password|new password should be different/i, "A nova senha precisa ser diferente da senha atual."],
      [/failed to fetch|network/i, "Não foi possível conectar. Verifique sua internet."]
    ];
    return translations.find(([pattern]) => pattern.test(message))?.[1] || message;
  }

  async function getSession() {
    const { data, error } = await requireClient().auth.getSession();
    if (error) throw error;
    return data.session;
  }

  async function signUp({ name, email, password }) {
    const { data, error } = await requireClient().auth.signUp({
      email,
      password,
      options: {
        data: { full_name: name },
        emailRedirectTo: config.authRedirectUrl || window.location.href
      }
    });
    if (error) throw error;
    return data;
  }

  async function verifySignup({ email, token }) {
    const { data, error } = await requireClient().auth.verifyOtp({ email, token, type: "signup" });
    if (error) throw error;
    return data;
  }

  async function resendSignup(email) {
    const { data, error } = await requireClient().auth.resend({ type: "signup", email });
    if (error) throw error;
    return data;
  }

  async function signIn({ email, password }) {
    const { data, error } = await requireClient().auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  async function signOut(scope = "local") {
    const { error } = await requireClient().auth.signOut({ scope });
    if (error) throw error;
  }

  async function requestPasswordReset(email) {
    const { data, error } = await requireClient().auth.resetPasswordForEmail(email, {
      redirectTo: config.authRedirectUrl || window.location.href
    });
    if (error) throw error;
    return data;
  }

  async function completePasswordReset(password) {
    const { data, error } = await requireClient().auth.updateUser({ password });
    if (error) throw error;
    return data.user;
  }

  async function updateProfile(name) {
    const api = requireClient();
    const { data: authData, error: authError } = await api.auth.updateUser({ data: { full_name: name } });
    if (authError) throw authError;
    const { error } = await api.from("profiles").update({ full_name: name }).eq("id", authData.user.id);
    if (error) throw error;
    return authData.user;
  }

  async function acceptTerms() {
    const api = requireClient();
    const { data: userData, error: userError } = await api.auth.getUser();
    if (userError) throw userError;
    const { error } = await api.from("profiles")
      .update({ accepted_terms_at: new Date().toISOString() })
      .eq("id", userData.user.id)
      .is("accepted_terms_at", null);
    if (error) throw error;
  }

  async function changePassword({ email, currentPassword, newPassword }) {
    const api = requireClient();
    const { error: loginError } = await api.auth.signInWithPassword({ email, password: currentPassword });
    if (loginError) throw loginError;
    const { data, error } = await api.auth.updateUser({ password: newPassword });
    if (error) throw error;
    return data.user;
  }

  async function getEntitlement() {
    const { data, error } = await requireClient().from("access_entitlements")
      .select("status,starts_at,ends_at,provider,product_id")
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async function getAuthenticatedUser() {
    const { data, error } = await requireClient().auth.getUser();
    if (error) throw error;
    if (!data.user) throw new Error("Sua sessão expirou. Entre novamente.");
    return data.user;
  }

  async function loadFinancialState() {
    const user = await getAuthenticatedUser();
    const { data, error } = await requireClient().from("financial_states")
      .select("data_version,state_data,updated_at")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async function saveFinancialState(state) {
    const user = await getAuthenticatedUser();
    const { data, error } = await requireClient().from("financial_states")
      .upsert({ user_id: user.id, data_version: Number(state?.version || 1), state_data: state }, { onConflict: "user_id" })
      .select("updated_at")
      .single();
    if (error) throw error;
    return data;
  }

  function hasActiveEntitlement(entitlement) {
    if (!entitlement || !["active", "trial"].includes(entitlement.status)) return false;
    const now = Date.now();
    return new Date(entitlement.starts_at).getTime() <= now
      && (!entitlement.ends_at || new Date(entitlement.ends_at).getTime() > now);
  }

  function onAuthStateChange(callback) {
    return requireClient().auth.onAuthStateChange((event, session) => callback(event, session));
  }

  window.DespesaMensalCloud = Object.freeze({
    configured,
    friendlyError,
    getSession,
    signUp,
    verifySignup,
    resendSignup,
    signIn,
    signOut,
    requestPasswordReset,
    completePasswordReset,
    updateProfile,
    acceptTerms,
    changePassword,
    getEntitlement,
    loadFinancialState,
    saveFinancialState,
    hasActiveEntitlement,
    onAuthStateChange,
    client
  });
})();

