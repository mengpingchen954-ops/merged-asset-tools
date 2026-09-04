(function () {
  "use strict";

  const DEMO_STORAGE_KEY = "cutframe-demo-credits-v1";
  const config = window.CUTFRAME_SUPABASE || {};
  const productionMode = Boolean(config.url && config.anonKey && window.supabase?.createClient);
  const client = productionMode ? window.supabase.createClient(config.url, config.anonKey) : null;
  const state = {
    balance: 10,
    user: null,
    ledger: [],
    pendingConfirmation: null,
    toastTimer: 0,
  };

  const actionCopy = {
    asset_export: { title: "下载单项透明 PNG", reason: "单项素材下载", icon: "download" },
    image_export: { title: "导出透明 PNG", reason: "高清 PNG 导出", icon: "file-image" },
    video_export: { title: "导出透明 WEBM", reason: "绿幕视频导出", icon: "file-video" },
    welcome: { reason: "新用户赠送", icon: "gift" },
    redeem: { reason: "兑换码充值", icon: "ticket-check" },
  };

  function $(selector) {
    return document.querySelector(selector);
  }

  function refreshIcons() {
    if (window.lucide) window.lucide.createIcons({ attrs: { "aria-hidden": "true" } });
  }

  function notify(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("is-visible");
    window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 2400);
  }

  function formatDate(value) {
    return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
  }

  function getCost(action, durationSeconds = 0) {
    if (action === "asset_export") return 1;
    if (action === "image_export") return 2;
    if (action === "video_export") return 5 + Math.max(0, Math.ceil((Math.max(0, durationSeconds) - 30) / 30)) * 3;
    throw new Error("未知积分项目");
  }

  function loadDemoState() {
    try {
      const stored = JSON.parse(localStorage.getItem(DEMO_STORAGE_KEY));
      if (Number.isInteger(stored?.balance) && Array.isArray(stored?.ledger)) return stored;
    } catch (_) {
      // Invalid local preview data is replaced with a clean demo account.
    }
    return {
      balance: 10,
      ledger: [{ id: "welcome", amount: 10, reason: "welcome", created_at: new Date().toISOString() }],
    };
  }

  function saveDemoState() {
    localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify({ balance: state.balance, ledger: state.ledger }));
  }

  function renderLedger() {
    const list = $("#ledger-list");
    if (!state.ledger.length) {
      list.innerHTML = '<span class="ledger-empty">暂无积分记录</span>';
      return;
    }
    list.innerHTML = state.ledger
      .slice(0, 20)
      .map((entry) => {
        const copy = actionCopy[entry.reason] || { reason: entry.label || "积分变动", icon: "circle-dollar-sign" };
        const positive = Number(entry.amount) > 0;
        return `<div class="ledger-row">
          <span><i data-lucide="${copy.icon}"></i></span>
          <span><strong>${copy.reason}</strong><small>${formatDate(entry.created_at)}</small></span>
          <b class="ledger-amount${positive ? " is-positive" : ""}">${positive ? "+" : ""}${entry.amount}</b>
        </div>`;
      })
      .join("");
    refreshIcons();
  }

  function render() {
    $("#credit-balance").textContent = state.balance;
    $("#dialog-credit-balance").textContent = state.balance;
    $("#credit-mode").textContent = productionMode ? (state.user ? "账户积分" : "登录领取") : "体验积分";
    $("#account-mode-badge").textContent = productionMode ? "云端账户" : "体验模式";
    $("#account-note").textContent = productionMode
      ? "新用户登录即赠 10 积分。预览免费，仅在确认导出后扣除积分。"
      : "当前积分保存在本机，仅用于体验流程。连接 Supabase 后将自动切换为真实账户。";
    $("#auth-state").textContent = productionMode ? (state.user ? "已登录" : "未登录") : "等待接入";
    $("#login-form").hidden = Boolean(state.user);
    $("#signed-in-row").hidden = !state.user;
    $("#password-form").hidden = !state.user;
    $("#signed-in-email").textContent = state.user?.email || "";
    $("#login-form button[type='submit']").disabled = !productionMode;
    $("#signup-button").disabled = !productionMode;
    $("#reset-password-button").disabled = !productionMode;
    $("#login-email").disabled = !productionMode;
    $("#login-password").disabled = !productionMode;
    $("#password-form button").disabled = !productionMode || !state.user;
    $("#account-password").disabled = !productionMode || !state.user;
    $("#redeem-form button").disabled = !productionMode || !state.user;
    $("#redeem-code").disabled = !productionMode || !state.user;
    renderLedger();
  }

  async function refreshAccount() {
    if (!productionMode || !state.user) {
      render();
      return;
    }
    const [accountResult, ledgerResult] = await Promise.all([
      client.from("credit_accounts").select("balance").eq("user_id", state.user.id).single(),
      client.from("credit_transactions").select("id, amount, reason, created_at").order("created_at", { ascending: false }).limit(20),
    ]);
    if (accountResult.error) throw accountResult.error;
    if (ledgerResult.error) throw ledgerResult.error;
    state.balance = accountResult.data.balance;
    state.ledger = ledgerResult.data || [];
    render();
  }

  function openAccount() {
    if (!$("#account-dialog").open) $("#account-dialog").showModal();
  }

  function closeAccount() {
    if ($("#account-dialog").open) $("#account-dialog").close();
  }

  function finishConfirmation(approved) {
    if (!state.pendingConfirmation) return;
    const resolve = state.pendingConfirmation;
    state.pendingConfirmation = null;
    if ($("#charge-dialog").open) $("#charge-dialog").close();
    resolve(approved);
  }

  async function confirmExport(action, durationSeconds = 0) {
    await ready;
    if (productionMode && !state.user) {
      openAccount();
      notify("请先登录积分账户");
      return false;
    }
    const cost = getCost(action, durationSeconds);
    if (state.balance < cost) {
      openAccount();
      notify(`积分不足，本次导出需要 ${cost} 积分`);
      return false;
    }
    const copy = actionCopy[action];
    $("#charge-title").textContent = "确认导出";
    $("#charge-description").textContent = copy.title;
    $("#charge-cost").textContent = cost;
    $("#charge-after").textContent = state.balance - cost;
    $("#charge-dialog").showModal();
    return new Promise((resolve) => {
      state.pendingConfirmation = resolve;
    });
  }

  async function charge(action, durationSeconds = 0) {
    const cost = getCost(action, durationSeconds);
    if (!productionMode) {
      if (state.balance < cost) return { ok: false, error: "insufficient_credits" };
      state.balance -= cost;
      state.ledger.unshift({ id: crypto.randomUUID(), amount: -cost, reason: action, created_at: new Date().toISOString() });
      saveDemoState();
      render();
      return { ok: true, balance: state.balance, cost };
    }
    if (!state.user) return { ok: false, error: "authentication_required" };
    const { data, error } = await client.rpc("charge_credits", {
      p_action: action,
      p_duration_seconds: durationSeconds,
      p_idempotency_key: crypto.randomUUID(),
    });
    if (error) {
      if (error.message?.includes("insufficient_credits")) notify("积分不足，请先充值");
      else notify("扣除积分失败，请稍后重试");
      return { ok: false, error: error.message };
    }
    state.balance = data.balance;
    await refreshAccount();
    return { ok: true, balance: data.balance, cost: data.cost };
  }

  function updateExportCost(action, durationSeconds = 0) {
    $("#export-cost").textContent = `${getCost(action, durationSeconds)} 积分`;
  }

  async function handleLogin(event) {
    event.preventDefault();
    if (!productionMode) return notify("请先配置 Supabase 积分服务");
    const email = $("#login-email").value.trim();
    const password = $("#login-password").value;
    const button = $("#login-form button[type='submit']");
    const signupButton = $("#signup-button");
    button.disabled = true;
    signupButton.disabled = true;
    const { error } = await client.auth.signInWithPassword({ email, password });
    button.disabled = false;
    signupButton.disabled = false;
    if (error) return notify("邮箱或密码错误");
    notify("登录成功");
  }

  async function handleSignup() {
    if (!productionMode) return notify("请先配置 Supabase 积分服务");
    const form = $("#login-form");
    if (!form.reportValidity()) return;
    const email = $("#login-email").value.trim();
    const password = $("#login-password").value;
    const loginButton = $("#login-form button[type='submit']");
    const signupButton = $("#signup-button");
    loginButton.disabled = true;
    signupButton.disabled = true;
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${location.origin}${location.pathname}` },
    });
    loginButton.disabled = false;
    signupButton.disabled = false;
    if (error) return notify(error.message?.toLowerCase().includes("registered") ? "账号已存在，请登录或在手机端设置密码" : "注册失败，请稍后重试");
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) return notify("账号已存在，请登录或发送设置密码邮件");
    if (data.session) return notify("注册并登录成功");
    notify("确认邮件已发送；确认后回到电脑登录");
  }

  async function handlePasswordReset() {
    if (!productionMode) return notify("请先配置 Supabase 积分服务");
    const emailInput = $("#login-email");
    if (!emailInput.checkValidity()) return emailInput.reportValidity();
    const button = $("#reset-password-button");
    button.disabled = true;
    const { error } = await client.auth.resetPasswordForEmail(emailInput.value.trim(), {
      redirectTo: `${location.origin}${location.pathname}`,
    });
    button.disabled = false;
    if (error) return notify("设置密码邮件发送失败，请稍后重试");
    notify("设置密码邮件已发送，请在手机打开");
  }

  async function handlePasswordUpdate(event) {
    event.preventDefault();
    if (!productionMode || !state.user) return notify("请先登录");
    const password = $("#account-password").value;
    const button = $("#password-form button");
    button.disabled = true;
    const { error } = await client.auth.updateUser({ password });
    button.disabled = false;
    if (error) return notify("密码保存失败，请稍后重试");
    $("#account-password").value = "";
    notify("密码已保存，可在电脑登录");
  }

  async function handleRedeem(event) {
    event.preventDefault();
    if (!productionMode || !state.user) return notify("请先登录积分账户");
    const code = $("#redeem-code").value.trim();
    const button = $("#redeem-form button");
    button.disabled = true;
    const { data, error } = await client.rpc("redeem_credit_code", { p_code: code });
    button.disabled = false;
    if (error) return notify(error.message?.includes("invalid_or_expired_code") ? "兑换码无效或已过期" : "兑换失败，请稍后重试");
    $("#redeem-code").value = "";
    state.balance = data.balance;
    await refreshAccount();
    notify(`兑换成功，已增加 ${data.points} 积分`);
  }

  async function initialize() {
    $("#credit-button").addEventListener("click", openAccount);
    $("#close-account").addEventListener("click", closeAccount);
    $("#login-form").addEventListener("submit", handleLogin);
    $("#signup-button").addEventListener("click", handleSignup);
    $("#reset-password-button").addEventListener("click", handlePasswordReset);
    $("#password-form").addEventListener("submit", handlePasswordUpdate);
    $("#redeem-form").addEventListener("submit", handleRedeem);
    $("#logout-button").addEventListener("click", async () => {
      await client?.auth.signOut();
      closeAccount();
      notify("已退出登录");
    });
    $("#close-charge").addEventListener("click", () => finishConfirmation(false));
    $("#cancel-charge").addEventListener("click", () => finishConfirmation(false));
    $("#confirm-charge").addEventListener("click", () => finishConfirmation(true));
    $("#charge-dialog").addEventListener("cancel", (event) => {
      event.preventDefault();
      finishConfirmation(false);
    });

    if (!productionMode) {
      const demo = loadDemoState();
      state.balance = demo.balance;
      state.ledger = demo.ledger;
      render();
      return;
    }

    const { data } = await client.auth.getSession();
    state.user = data.session?.user || null;
    if (state.user) await refreshAccount();
    else render();
    client.auth.onAuthStateChange((event, session) => {
      state.user = session?.user || null;
      window.setTimeout(() => refreshAccount().catch(() => notify("账户信息加载失败")), 0);
      if (event === "PASSWORD_RECOVERY") {
        window.setTimeout(() => {
          openAccount();
          $("#account-password").focus();
          notify("请输入新密码并保存");
        }, 0);
      }
    });
  }

  const ready = initialize().catch((error) => {
    console.error("Credit service initialization failed", error);
    notify("积分服务初始化失败");
  });

  window.CutframeCredits = Object.freeze({
    charge,
    confirmExport,
    getCost,
    openAccount,
    ready,
    updateExportCost,
  });
})();
