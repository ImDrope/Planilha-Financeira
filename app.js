(() => {
  "use strict";

  const STORAGE_KEY = "financeQuestData_v1";
  const DATA_VERSION = 5;
  const THEME_KEY = "financeQuestTheme";
  const PRIVACY_KEY = "financeQuestValuesHidden";
  const RESEND_DELAY_SECONDS = 45;
  const cloud = window.DespesaMensalCloud;
  const cloudRequired = Boolean(window.DESPESA_MENSAL_CONFIG?.supabaseUrl);

  const expenseCategories = [
    "Moradia", "Alimentação", "Transporte", "Assinaturas", "Lazer",
    "Saúde", "Compras", "Trabalho", "Educação", "Outros"
  ];
  const incomeCategories = ["Freelance", "Reembolso", "Venda", "Presente", "Outras receitas"];

  const categoryColors = ["#5f47ff", "#168c5b", "#d13c55", "#c27a0a", "#2675d8", "#8d57c8", "#33a6a6", "#d0652a", "#718096", "#d34fb8"];

  const defaultState = {
    version: DATA_VERSION,
    plans: {},
    transactions: [],
    investments: [],
    investmentEvents: [],
    recurrences: [],
    cards: [],
    closures: {},
    onboardingCompleted: false
  };

  let state = loadState();
  let selectedMonth = currentMonthKey();
  let toastTimer = null;
  let dashboardView = "table";
  let dashboardFilter = "all";
  let valuesHidden = false;
  let demoUser = null;
  let pendingRegistration = null;
  let resendTimer = null;
  let verificationAttempts = 0;
  let authInitialized = false;

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  const elements = {
    monthSelector: $("#monthSelector"),
    pageTitle: $("#pageTitle"),
    transactionModal: $("#transactionModal"),
    investmentModal: $("#investmentModal"),
    planModal: $("#planModal"),
    transactionForm: $("#transactionForm"),
    investmentForm: $("#investmentForm"),
    planForm: $("#planForm"),
    toast: $("#toast")
  };

  function loadState() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return structuredClone(defaultState);
      const parsed = JSON.parse(saved);
      const migratedInvestments = (Array.isArray(parsed.investments) ? parsed.investments : []).map((item) => ({
        ...item,
        objective: item.objective || "",
        quantity: Number(item.quantity || 0),
        migratedLegacy: !item.migratedLegacy
      }));
      const investmentEvents = Array.isArray(parsed.investmentEvents) ? parsed.investmentEvents : [];
      migratedInvestments.forEach((item) => {
        if (!investmentEvents.some((event) => event.assetId === item.id) && Number(item.amount || 0) > 0) {
          investmentEvents.push({ id: `evt_migrated_${item.id}`, assetId: item.id, type: "contribution", date: item.date, amount: Number(item.amount || 0), notes: "Aporte migrado da versão anterior" });
        }
        if (!investmentEvents.some((event) => event.assetId === item.id && event.type === "valuation")) {
          investmentEvents.push({ id: `evt_value_${item.id}`, assetId: item.id, type: "valuation", date: item.date, amount: Number(item.currentValue ?? item.amount ?? 0), notes: "Valor atual migrado" });
        }
      });
      return {
        ...structuredClone(defaultState),
        ...parsed,
        version: DATA_VERSION,
        plans: parsed.plans || {},
        transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
        investments: migratedInvestments,
        investmentEvents,
        recurrences: Array.isArray(parsed.recurrences) ? parsed.recurrences : [],
        cards: Array.isArray(parsed.cards) ? parsed.cards : [],
        closures: parsed.closures || {},
        onboardingCompleted: Boolean(parsed.onboardingCompleted || Object.keys(parsed.plans || {}).length || (parsed.transactions || []).length)
      };
    } catch (error) {
      console.error("Falha ao carregar dados:", error);
      return structuredClone(defaultState);
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function currentMonthKey() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }

  function todayISO() {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  }

  function monthFromDate(date) {
    return String(date).slice(0, 7);
  }

  function formatCurrency(value, compact = false) {
    const amount = Number(value || 0);
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
      maximumFractionDigits: compact ? 0 : 2
    }).format(amount);
  }

  function formatQuantity(value) {
    return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 8 }).format(Number(value || 0));
  }

  function formatUnitCurrency(value) {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
      minimumFractionDigits: 2,
      maximumFractionDigits: 8
    }).format(Number(value || 0));
  }

  function formatDate(dateString) {
    if (!dateString) return "—";
    const [year, month, day] = dateString.split("-").map(Number);
    return new Intl.DateTimeFormat("pt-BR").format(new Date(year, month - 1, day));
  }

  function monthLabel(monthKey, style = "long") {
    const [year, month] = monthKey.split("-").map(Number);
    return new Intl.DateTimeFormat("pt-BR", {
      month: style,
      year: style === "long" ? "numeric" : undefined
    }).format(new Date(year, month - 1, 1));
  }

  function addMonths(date, amount) {
    const result = new Date(date.getFullYear(), date.getMonth() + amount, 1);
    return result;
  }

  function safeDate(year, monthIndex, day) {
    const lastDay = new Date(year, monthIndex + 1, 0).getDate();
    return new Date(year, monthIndex, Math.min(Math.max(1, Number(day || 1)), lastDay));
  }

  function toISO(date) {
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  }

  function generateRecurringTransactions() {
    const horizon = addMonths(new Date(), 18);
    state.recurrences.filter((item) => item.active !== false).forEach((item) => {
      const start = new Date(`${item.start}T12:00:00`);
      const end = item.end ? new Date(`${item.end}T12:00:00`) : horizon;
      let cursor = new Date(start);
      let guard = 0;
      while (cursor <= end && cursor <= horizon && guard < 800) {
        let occurrenceDate;
        if (item.frequency === "monthly") occurrenceDate = safeDate(cursor.getFullYear(), cursor.getMonth(), item.dueDay);
        else if (item.frequency === "annual") occurrenceDate = safeDate(cursor.getFullYear(), start.getMonth(), item.dueDay || start.getDate());
        else occurrenceDate = new Date(cursor);
        const monthKey = monthFromDate(toISO(occurrenceDate));
        const occurrenceKey = `${item.id}_${toISO(occurrenceDate)}`;
        const skipped = (item.skippedMonths || []).includes(monthKey);
        if (!skipped && occurrenceDate >= start && occurrenceDate <= end && !state.transactions.some((tx) => tx.occurrenceKey === occurrenceKey)) {
          state.transactions.push({
            id: generateId("tx"),
            occurrenceKey,
            recurrenceId: item.id,
            type: item.type,
            date: toISO(occurrenceDate),
            description: item.description,
            amount: Number(item.amount || 0),
            category: item.category,
            expenseClass: item.type === "expense" ? "recurring" : null,
            status: item.status || "pending",
            paymentMethod: "other",
            notes: "Gerado automaticamente"
          });
        }
        if (item.frequency === "weekly") cursor.setDate(cursor.getDate() + 7);
        else if (item.frequency === "annual") cursor.setFullYear(cursor.getFullYear() + 1);
        else cursor = addMonths(cursor, 1);
        guard += 1;
      }
    });
  }

  function categoryBudgetFor(plan, category) {
    return Number((plan.categoryBudgets || {})[category] || 0);
  }

  function invoiceRows() {
    const totals = {};
    state.transactions.filter((item) => item.paymentMethod === "credit" && item.installmentGroup).forEach((item) => {
      const month = item.invoiceMonth || monthFromDate(item.date);
      totals[month] ||= { total: 0, count: 0 };
      totals[month].total += Number(item.amount || 0);
      totals[month].count += 1;
    });
    return Object.entries(totals)
      .map(([month, values]) => ({ month, ...values }))
      .sort((a, b) => a.month.localeCompare(b.month));
  }

  function futureCreditCommitment(monthKey = selectedMonth) {
    return invoiceRows().filter((row) => row.month > monthKey).reduce((sum, row) => sum + row.total, 0);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function generateId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function getPlan(monthKey = selectedMonth) {
    return {
      salary: 0,
      budget: 0,
      investmentGoal: 0,
      categoryBudgets: {},
      ...(state.plans[monthKey] || {})
    };
  }

  function monthTransactions(monthKey = selectedMonth) {
    return state.transactions.filter((item) => monthFromDate(item.date) === monthKey);
  }

  function monthInvestments(monthKey = selectedMonth) {
    return state.investmentEvents.filter((item) => item.type === "contribution" && monthFromDate(item.date) === monthKey);
  }

  function getMonthStats(monthKey = selectedMonth) {
    const plan = getPlan(monthKey);
    const transactions = monthTransactions(monthKey);
    const investments = monthInvestments(monthKey);
    const paid = transactions.filter((item) => item.status === "paid");
    const pending = transactions.filter((item) => item.status === "pending");
    const extraIncome = paid
      .filter((item) => item.type === "income")
      .reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const expenses = paid.filter((item) => item.type === "expense");
    const fixed = expenses
      .filter((item) => item.expenseClass === "fixed")
      .reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const recurring = expenses
      .filter((item) => item.expenseClass === "recurring")
      .reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const variable = expenses
      .filter((item) => item.expenseClass === "variable")
      .reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const totalExpenses = fixed + recurring + variable;
    const invested = investments.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const income = Number(plan.salary || 0) + extraIncome;
    const balance = income - totalExpenses - invested;
    const pendingCount = transactions.filter((item) => item.status === "pending").length;
    const pendingExpenses = pending.filter((item) => item.type === "expense").reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const expectedIncome = pending.filter((item) => item.type === "income").reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const overdue = pending.filter((item) => item.type === "expense" && item.date < todayISO());
    const overdueTotal = overdue.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const forecastBalance = income + expectedIncome - totalExpenses - pendingExpenses - invested;
    const categoryTotals = {};
    expenses.forEach((item) => {
      categoryTotals[item.category] = (categoryTotals[item.category] || 0) + Number(item.amount || 0);
    });

    const scoreData = calculateScore({
      plan,
      income,
      totalExpenses,
      invested,
      balance,
      pendingCount,
      pendingExpenses,
      expectedIncome,
      overdueCount: overdue.length,
      overdueTotal,
      forecastBalance,
      transactionCount: transactions.length
    });

    return {
      plan,
      transactions,
      investments,
      income,
      extraIncome,
      fixed,
      recurring,
      variable,
      totalExpenses,
      invested,
      balance,
      pendingCount,
      pendingExpenses,
      expectedIncome,
      overdueCount: overdue.length,
      overdueTotal,
      forecastBalance,
      categoryTotals,
      ...scoreData
    };
  }

  function calculateScore({ plan, income, totalExpenses, invested, balance, pendingCount, transactionCount }) {
    const items = [
      {
        label: "Fechar o mês com saldo positivo",
        points: 30,
        completed: income > 0 && balance >= 0
      },
      {
        label: "Atingir a meta de investimento",
        points: 25,
        completed: Number(plan.investmentGoal) > 0 && invested >= Number(plan.investmentGoal)
      },
      {
        label: "Permanecer dentro do limite de gastos",
        points: 20,
        completed: Number(plan.budget) > 0 && totalExpenses <= Number(plan.budget)
      },
      {
        label: "Não deixar contas pendentes",
        points: 15,
        completed: transactionCount > 0 && pendingCount === 0
      },
      {
        label: "Registrar pelo menos cinco movimentações",
        points: 10,
        completed: transactionCount >= 5
      }
    ];

    const score = items.reduce((sum, item) => sum + (item.completed ? item.points : 0), 0);
    let level = "Reorganizando";
    let description = "Dê os primeiros passos configurando sua renda, metas e registros.";
    if (score >= 90) {
      level = "Mestre das finanças";
      description = "Excelente consistência: suas metas, gastos e investimentos estão muito bem alinhados.";
    } else if (score >= 75) {
      level = "Estrategista";
      description = "Você está tomando decisões consistentes e mantendo o mês sob controle.";
    } else if (score >= 60) {
      level = "Organizado";
      description = "Sua rotina financeira está ganhando estrutura. Continue acompanhando as metas.";
    } else if (score >= 40) {
      level = "Aprendiz financeiro";
      description = "A base está montada. Ajustes em orçamento e investimentos podem elevar sua pontuação.";
    }

    return { score, scoreItems: items, level, levelDescription: description };
  }

  function getPreviousMonthKey(monthKey) {
    const [year, month] = monthKey.split("-").map(Number);
    const date = new Date(year, month - 2, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }

  function getLastMonths(count, endMonth = selectedMonth) {
    const [year, month] = endMonth.split("-").map(Number);
    return Array.from({ length: count }, (_, index) => {
      const date = new Date(year, month - count + index, 1);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    });
  }

  function getInvestmentTotals() {
    const contributed = state.investmentEvents.filter((item) => item.type === "contribution").reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const withdrawn = state.investmentEvents.filter((item) => item.type === "withdrawal").reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const income = state.investmentEvents.filter((item) => item.type === "income").reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const current = state.investments.reduce((sum, asset) => sum + getAssetTotals(asset.id).current, 0);
    return { contributed, withdrawn, income, current, result: current + withdrawn + income - contributed };
  }

  function getAssetTotals(assetId, throughDate = null) {
    const events = state.investmentEvents
      .map((item, stateIndex) => ({ ...item, stateIndex }))
      .filter((item) => item.assetId === assetId && (!throughDate || item.date <= throughDate))
      .sort((a, b) => a.date.localeCompare(b.date) || a.stateIndex - b.stateIndex);
    const contributions = events.filter((item) => item.type === "contribution").reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const withdrawals = events.filter((item) => item.type === "withdrawal").reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const income = events.filter((item) => item.type === "income").reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const valuations = events.filter((item) => item.type === "valuation");
    const latestValuation = valuations[valuations.length - 1] || null;
    const movementsAfterValuation = latestValuation
      ? events.filter((item) => item.date > latestValuation.date || (item.date === latestValuation.date && item.stateIndex > latestValuation.stateIndex))
      : events;
    const estimatedChange = movementsAfterValuation.reduce((sum, item) => {
      if (item.type === "contribution") return sum + Number(item.amount || 0);
      if (item.type === "withdrawal") return sum - Number(item.amount || 0);
      return sum;
    }, 0);
    const current = Math.max(0, latestValuation ? Number(latestValuation.amount || 0) + estimatedChange : estimatedChange);
    const result = current + withdrawals + income - contributions;
    const profitability = contributions > 0 ? (result / contributions) * 100 : 0;
    const referenceDate = throughDate || todayISO();
    const ageInDays = latestValuation ? Math.floor((new Date(`${referenceDate}T12:00:00`) - new Date(`${latestValuation.date}T12:00:00`)) / 86400000) : Infinity;
    const isEstimated = Boolean(latestValuation && movementsAfterValuation.some((item) => item.type === "contribution" || item.type === "withdrawal"));
    const isStale = !latestValuation || ageInDays > 30;
    return { contributions, withdrawals, income, current, result, profitability, valuationDate: latestValuation?.date || null, isEstimated, isStale };
  }

  function renderMonthNavigation() {
    elements.monthSelector.value = selectedMonth;
    const label = monthLabel(selectedMonth);
    $("#monthDisplay").textContent = label.charAt(0).toUpperCase() + label.slice(1);
  }

  function shiftMonth(offset) {
    const [year, month] = selectedMonth.split("-").map(Number);
    const date = new Date(year, month - 1 + offset, 1);
    selectedMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    renderAll();
  }

  function setDashboardView(view) {
    dashboardView = view;
    $$('[data-dashboard-view-button]').forEach((button) => {
      button.classList.toggle("active", button.dataset.dashboardViewButton === view);
    });
    $$('[data-dashboard-view]').forEach((panel) => {
      panel.classList.toggle("active", panel.dataset.dashboardView === view);
    });
    if (view === "charts") {
      requestAnimationFrame(() => {
        renderHistoryChart();
        renderCategoryChart(getMonthStats());
      });
    }
  }

  function setDashboardFilter(filter) {
    dashboardFilter = filter;
    $$('[data-dashboard-filter]').forEach((button) => {
      button.classList.toggle("active", button.dataset.dashboardFilter === filter);
    });
    renderDashboardQuickTable(getMonthStats());
  }

  function renderDashboardQuickTable(stats) {
    const titleMap = {
      all: "Todos os registros",
      income: "Receitas extras",
      fixed: "Despesas fixas",
      variable: "Variáveis e recorrentes"
    };
    const rows = stats.transactions
      .filter((item) => {
        if (dashboardFilter === "all") return true;
        if (dashboardFilter === "income") return item.type === "income";
        if (dashboardFilter === "fixed") return item.type === "expense" && item.expenseClass === "fixed";
        return item.type === "expense" && ["variable", "recurring"].includes(item.expenseClass);
      })
      .sort((a, b) => b.date.localeCompare(a.date));

    $("#dashboardTableTitle").textContent = titleMap[dashboardFilter];
    $("#dashboardTransactionsEmpty").classList.toggle("hidden", rows.length > 0);
    $("#dashboardTransactionRows").innerHTML = rows.slice(0, 8).map((item) => `
      <tr>
        <td>${formatDate(item.date)}</td>
        <td><strong>${escapeHtml(item.description)}</strong><small>${escapeHtml(item.category)}</small></td>
        <td class="align-right money-value ${item.type === "income" ? "amount-positive" : "amount-negative"}">
          ${item.type === "income" ? "+" : "−"}${formatCurrency(item.amount)}
        </td>
        <td><button class="row-action icon-only" data-edit-transaction="${item.id}" type="button" aria-label="Editar movimentação">✎</button></td>
      </tr>
    `).join("");
  }

  function applyPrivacyValues(hidden) {
    valuesHidden = hidden;
    document.body.classList.toggle("hide-values", valuesHidden);
    const button = $("#privacyToggle");
    button.classList.toggle("values-hidden", valuesHidden);
    button.setAttribute("aria-label", valuesHidden ? "Exibir valores" : "Ocultar valores");
    button.title = valuesHidden ? "Exibir valores" : "Ocultar valores";
  }

  function togglePrivacyValues() {
    applyPrivacyValues(!valuesHidden);
    localStorage.setItem(PRIVACY_KEY, String(valuesHidden));
  }

  function renderAll() {
    generateRecurringTransactions();
    renderMonthNavigation();
    renderDashboard();
    renderTransactions();
    renderCategoryBudgets();
    renderCards();
    renderInvestments();
    renderInvestmentEvents();
    renderClosures();
    renderGoals();
    saveState();
  }

  function renderDashboard() {
    const stats = getMonthStats();
    const investments = getInvestmentTotals();
    const liquidity = stats.balance;
    const trackedPatrimony = investments.current + liquidity;
    const expenseRatio = stats.income > 0 ? (stats.totalExpenses / stats.income) * 100 : 0;
    const monthClosed = Boolean(state.closures[selectedMonth]);
    const closeButton = $("#closeMonthButton");
    $("#closeMonthButtonLabel").textContent = monthClosed ? "Mês fechado · atualizar" : "Fechar mês";
    closeButton.classList.toggle("completed", monthClosed);

    $("#patrimonyMetric").textContent = formatCurrency(trackedPatrimony);
    $("#patrimonyInvestmentMetric").textContent = formatCurrency(investments.current);
    $("#patrimonyLiquidityMetric").textContent = formatCurrency(liquidity);
    $("#patrimonyMetric").closest(".wealth-card")?.classList.toggle("negative", trackedPatrimony < 0);

    $("#incomeMetric").textContent = formatCurrency(stats.income);
    $("#incomeDetail").textContent = stats.extraIncome > 0
      ? `${formatCurrency(stats.plan.salary)} principal + ${formatCurrency(stats.extraIncome)} extras`
      : "Renda principal + entradas extras";

    $("#investmentMetric").textContent = formatCurrency(stats.invested);
    $("#investmentDetail").textContent = stats.plan.investmentGoal > 0
      ? `${Math.min(100, (stats.invested / stats.plan.investmentGoal) * 100).toFixed(0)}% da meta mensal`
      : "Meta ainda não definida";

    $("#expensesMetric").textContent = formatCurrency(stats.totalExpenses);
    $("#expenseDetail").textContent = stats.income > 0
      ? `${expenseRatio.toFixed(1).replace(".", ",")}% das receitas do mês`
      : "Fixas, variáveis e recorrentes";

    $("#balanceMetric").textContent = formatCurrency(stats.balance);
    $("#balanceMetric").className = `money-value ${stats.balance >= 0 ? "amount-positive" : "amount-negative"}`;
    $("#scoreMetric").textContent = stats.score;
    $("#scoreDetail").textContent = stats.level;
    $("#dashboardScoreRing").style.setProperty("--score", stats.score);
    $("#actualBalanceMetric").textContent = formatCurrency(stats.balance);
    $("#forecastBalanceMetric").textContent = formatCurrency(stats.forecastBalance);
    $("#forecastBalanceMetric").className = `money-value ${stats.forecastBalance >= 0 ? "amount-positive" : "amount-negative"}`;
    $("#pendingMetric").textContent = formatCurrency(stats.pendingExpenses);
    $("#overdueMetric").textContent = stats.overdueCount
      ? `${stats.overdueCount} conta(s) vencida(s) · ${formatCurrency(stats.overdueTotal)}`
      : "Nenhuma conta vencida";
    $("#expectedIncomeMetric").textContent = formatCurrency(stats.expectedIncome);
    const futureCommitment = futureCreditCommitment();
    $("#futureCommitmentMetric").textContent = futureCommitment > 0
      ? `${formatCurrency(futureCommitment)} em faturas futuras`
      : "Sem compromissos futuros";

    const subtitle = $("#heroSubmessage");
    if (stats.income === 0 && stats.totalExpenses === 0 && stats.invested === 0) {
      subtitle.textContent = `Configure ${monthLabel(selectedMonth)} para começar a pontuar.`;
    } else if (stats.balance >= 0) {
      subtitle.textContent = `O mês está positivo em ${formatCurrency(stats.balance)}.`;
    } else {
      subtitle.textContent = `Revise o orçamento: faltam ${formatCurrency(Math.abs(stats.balance))} para equilibrar o mês.`;
    }

    renderProgress(stats);
    renderRecentTransactions(stats.transactions);
    renderAnalysis(stats);
    renderDashboardQuickTable(stats);
    renderAchievementPreview();

    if (dashboardView === "charts") {
      renderHistoryChart();
      renderCategoryChart(stats);
    }
  }

  function renderProgress(stats) {
    const budget = Number(stats.plan.budget || 0);
    const investmentGoal = Number(stats.plan.investmentGoal || 0);
    const budgetPct = budget > 0 ? Math.min(100, (stats.totalExpenses / budget) * 100) : 0;
    const investmentPct = investmentGoal > 0 ? Math.min(100, (stats.invested / investmentGoal) * 100) : 0;

    $("#budgetProgressText").textContent = `${formatCurrency(stats.totalExpenses, true)} de ${formatCurrency(budget, true)}`;
    $("#investmentProgressText").textContent = `${formatCurrency(stats.invested, true)} de ${formatCurrency(investmentGoal, true)}`;
    $("#budgetProgressBar").style.width = `${budgetPct}%`;
    $("#investmentProgressBar").style.width = `${investmentPct}%`;
  }

  function renderRecentTransactions(transactions) {
    const container = $("#recentTransactions");
    const items = [...transactions]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 4);

    if (!items.length) {
      container.innerHTML = '<p class="empty-state">Nenhum registro neste mês.</p>';
      return;
    }

    container.innerHTML = items.map((item) => `
      <div class="compact-item">
        <div>
          <strong>${escapeHtml(item.description)}</strong>
          <small>${formatDate(item.date)} · ${escapeHtml(item.category)}</small>
        </div>
        <strong class="${item.type === "income" ? "amount-positive" : "amount-negative"}">
          ${item.type === "income" ? "+" : "−"}${formatCurrency(item.amount)}
        </strong>
      </div>
    `).join("");
  }

  function renderAnalysis(stats) {
    const previous = getMonthStats(getPreviousMonthKey(selectedMonth));
    const items = [];

    if (stats.income === 0 && stats.totalExpenses === 0 && stats.invested === 0) {
      items.push("Ainda não há dados suficientes para analisar este mês.");
      items.push("Comece definindo sua renda principal, limite de gastos e meta de investimento.");
    } else {
      items.push(stats.balance >= 0
        ? `O resultado do mês está positivo em ${formatCurrency(stats.balance)} após gastos e investimentos.`
        : `O resultado do mês está negativo em ${formatCurrency(Math.abs(stats.balance))}.`);

      if (previous.totalExpenses > 0) {
        const diff = stats.totalExpenses - previous.totalExpenses;
        const pct = Math.abs(diff / previous.totalExpenses) * 100;
        items.push(diff > 0
          ? `Seus gastos aumentaram ${pct.toFixed(1).replace(".", ",")}% em relação ao mês anterior.`
          : `Seus gastos diminuíram ${pct.toFixed(1).replace(".", ",")}% em relação ao mês anterior.`);
      }

      const topCategory = Object.entries(stats.categoryTotals).sort((a, b) => b[1] - a[1])[0];
      if (topCategory) {
        items.push(`${topCategory[0]} foi a maior categoria de despesa, com ${formatCurrency(topCategory[1])}.`);
      }

      if (stats.plan.investmentGoal > 0) {
        const remaining = Math.max(0, stats.plan.investmentGoal - stats.invested);
        items.push(remaining === 0
          ? `A meta de investimento foi atingida neste mês.`
          : `Faltam ${formatCurrency(remaining)} para alcançar sua meta de investimento.`);
      }
    }

    $("#monthlyAnalysis").innerHTML = items.map((text, index) => `
      <div class="analysis-item">
        <span class="analysis-icon">${index + 1}</span>
        <p>${escapeHtml(text)}</p>
      </div>
    `).join("");
  }

  function setupCanvas(canvas, height) {
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(280, rect.width || canvas.parentElement.clientWidth || 600);
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { ctx, width, height };
  }

  function cssVar(name) {
    return getComputedStyle(document.body).getPropertyValue(name).trim();
  }

  function renderHistoryChart() {
    const canvas = $("#historyChart");
    const empty = $("#historyChartEmpty");
    const months = getLastMonths(6);
    const data = months.map((month) => getMonthStats(month));
    const hasData = data.some((item) => item.income || item.totalExpenses || item.invested);

    empty.classList.toggle("hidden", hasData);
    canvas.classList.toggle("hidden", !hasData);
    if (!hasData) return;

    const { ctx, width, height } = setupCanvas(canvas, 300);
    ctx.clearRect(0, 0, width, height);

    const values = data.flatMap((item) => [item.income, item.totalExpenses, item.invested]);
    const maxValue = Math.max(...values, 1);
    const padding = { top: 26, right: 20, bottom: 44, left: 52 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;
    const gridColor = cssVar("--border");
    const textColor = cssVar("--muted");
    const series = [
      { key: "income", label: "Receitas", color: cssVar("--green") },
      { key: "totalExpenses", label: "Gastos", color: cssVar("--red") },
      { key: "invested", label: "Investimentos", color: cssVar("--primary") }
    ];

    ctx.font = "11px system-ui";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i += 1) {
      const y = padding.top + (chartH / 4) * i;
      const value = maxValue - (maxValue / 4) * i;
      ctx.strokeStyle = gridColor;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(width - padding.right, y);
      ctx.stroke();
      ctx.fillStyle = textColor;
      ctx.textAlign = "right";
      ctx.fillText(formatCurrency(value, true), padding.left - 9, y + 4);
    }

    months.forEach((month, index) => {
      const x = padding.left + (chartW / Math.max(1, months.length - 1)) * index;
      ctx.fillStyle = textColor;
      ctx.textAlign = "center";
      ctx.fillText(monthLabel(month, "short").replace(".", ""), x, height - 14);
    });

    series.forEach((serie) => {
      ctx.strokeStyle = serie.color;
      ctx.lineWidth = 3;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      data.forEach((item, index) => {
        const x = padding.left + (chartW / Math.max(1, data.length - 1)) * index;
        const y = padding.top + chartH - (Number(item[serie.key] || 0) / maxValue) * chartH;
        index === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();

      data.forEach((item, index) => {
        const x = padding.left + (chartW / Math.max(1, data.length - 1)) * index;
        const y = padding.top + chartH - (Number(item[serie.key] || 0) / maxValue) * chartH;
        ctx.fillStyle = cssVar("--surface");
        ctx.strokeStyle = serie.color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      });
    });

    let legendX = padding.left;
    series.forEach((serie) => {
      ctx.fillStyle = serie.color;
      ctx.fillRect(legendX, 5, 10, 10);
      ctx.fillStyle = textColor;
      ctx.textAlign = "left";
      ctx.fillText(serie.label, legendX + 15, 14);
      legendX += ctx.measureText(serie.label).width + 50;
    });
  }

  function renderCategoryChart(stats) {
    const canvas = $("#categoryChart");
    const empty = $("#categoryChartEmpty");
    const center = $("#donutCenter");
    const legend = $("#categoryLegend");
    const entries = Object.entries(stats.categoryTotals).sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((sum, [, value]) => sum + value, 0);

    empty.classList.toggle("hidden", entries.length > 0);
    canvas.classList.toggle("hidden", entries.length === 0);
    center.classList.toggle("hidden", entries.length === 0);
    legend.innerHTML = "";
    if (!entries.length) return;

    const { ctx, width, height } = setupCanvas(canvas, 220);
    ctx.clearRect(0, 0, width, height);
    const radius = Math.min(width, height) * 0.36;
    const inner = radius * 0.62;
    const cx = width / 2;
    const cy = height / 2;
    let start = -Math.PI / 2;

    entries.forEach(([category, value], index) => {
      const portion = value / total;
      const end = start + portion * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, start, end);
      ctx.arc(cx, cy, inner, end, start, true);
      ctx.closePath();
      ctx.fillStyle = categoryColors[index % categoryColors.length];
      ctx.fill();
      start = end;
    });

    center.querySelector("strong").textContent = formatCurrency(total, true);
    legend.innerHTML = entries.slice(0, 6).map(([category, value], index) => `
      <div class="category-legend-item">
        <span><i class="legend-dot" style="background:${categoryColors[index % categoryColors.length]}"></i>${escapeHtml(category)}</span>
        <strong>${formatCurrency(value)}</strong>
      </div>
    `).join("");
  }

  function renderTransactions() {
    const stats = getMonthStats();
    $("#movementIncomeMetric").textContent = formatCurrency(stats.income);
    $("#movementExpenseMetric").textContent = formatCurrency(stats.totalExpenses);
    $("#movementPendingMetric").textContent = formatCurrency(stats.pendingExpenses);
    $("#movementOverdueDetail").textContent = stats.overdueCount
      ? `${stats.overdueCount} conta(s) vencida(s) · ${formatCurrency(stats.overdueTotal)}`
      : "Nenhuma conta vencida";
    $("#movementBalanceMetric").textContent = formatCurrency(stats.balance);
    $("#movementBalanceMetric").className = `money-value ${stats.balance >= 0 ? "amount-positive" : "amount-negative"}`;
    $("#movementForecastMetric").textContent = formatCurrency(stats.forecastBalance);
    $("#movementForecastMetric").className = `money-value ${stats.forecastBalance >= 0 ? "amount-positive" : "amount-negative"}`;

    const search = $("#transactionSearch").value.trim().toLowerCase();
    const typeFilter = $("#transactionTypeFilter").value;
    const statusFilter = $("#transactionStatusFilter").value;
    const rows = monthTransactions()
      .filter((item) => typeFilter === "all" || item.type === typeFilter)
      .filter((item) => statusFilter === "all" || item.status === statusFilter)
      .filter((item) => !search || `${item.description} ${item.category}`.toLowerCase().includes(search))
      .sort((a, b) => b.date.localeCompare(a.date));

    const body = $("#transactionsTableBody");
    const empty = $("#transactionsEmpty");
    empty.classList.toggle("hidden", rows.length > 0);

    body.innerHTML = rows.map((item) => `
      <tr>
        <td>${formatDate(item.date)}</td>
        <td><strong>${escapeHtml(item.description)}</strong></td>
        <td>${escapeHtml(item.category)}</td>
        <td>${item.type === "expense" ? `<span class="class-badge">${classLabel(item.expenseClass)}</span>` : "Receita extra"}</td>
        <td><span class="status-badge ${item.status}">${item.status === "paid" ? "Pago/recebido" : "Pendente"}</span></td>
        <td class="align-right money-value ${item.type === "income" ? "amount-positive" : "amount-negative"}">
          ${item.type === "income" ? "+" : "−"}${formatCurrency(item.amount)}
        </td>
        <td>
          <div class="row-actions">
            <button class="row-action" data-edit-transaction="${item.id}" type="button">Editar</button>
            <button class="row-action" data-delete-transaction="${item.id}" type="button">Excluir</button>
          </div>
        </td>
      </tr>
    `).join("");

    $("#transactionsMobileList").innerHTML = rows.map((item) => `
      <article class="transaction-mobile-card">
        <div class="transaction-mobile-head">
          <div><strong>${escapeHtml(item.description)}</strong><small>${formatDate(item.date)} · ${escapeHtml(item.category)}</small></div>
          <strong class="money-value ${item.type === "income" ? "amount-positive" : "amount-negative"}">${item.type === "income" ? "+" : "−"}${formatCurrency(item.amount)}</strong>
        </div>
        <div class="transaction-mobile-meta">
          <span class="${item.type === "expense" ? "class-badge" : "class-badge income-class"}">${item.type === "expense" ? classLabel(item.expenseClass) : "Receita extra"}</span>
          <span class="status-badge ${item.status}">${item.status === "paid" ? "Pago/recebido" : "Pendente"}</span>
        </div>
        <div class="row-actions">
          <button class="row-action" data-edit-transaction="${item.id}" type="button">Editar</button>
          <button class="row-action" data-delete-transaction="${item.id}" type="button">Excluir</button>
        </div>
      </article>
    `).join("");
  }

  function renderCategoryBudgets() {
    const stats = getMonthStats();
    const plan = stats.plan;
    $("#categoryBudgetFields").innerHTML = expenseCategories.map((category) => `<label><span>${escapeHtml(category)}</span><input data-category-budget="${escapeHtml(category)}" type="number" min="0" step="0.01" value="${categoryBudgetFor(plan, category) || ""}" placeholder="0,00" /></label>`).join("");
    $("#categoryBudgetList").innerHTML = expenseCategories.map((category) => {
      const limit = categoryBudgetFor(plan, category);
      const spent = Number(stats.categoryTotals[category] || 0);
      const pct = limit > 0 ? spent / limit * 100 : 0;
      const status = pct >= 100 ? "danger" : pct >= 90 ? "warning" : pct >= 70 ? "attention" : "";
      return `<div class="category-budget-row ${status}"><div><strong>${escapeHtml(category)}</strong><small>${limit > 0 ? `${formatCurrency(spent)} de ${formatCurrency(limit)}` : "Sem limite definido"}</small></div><div class="progress-track"><div class="progress-fill" style="width:${Math.min(100, pct)}%"></div></div><span>${limit > 0 ? `${pct.toFixed(0)}%` : "—"}</span></div>`;
    }).join("");
  }

  function renderCards() {
    const rows = invoiceRows().filter((row) => row.month >= selectedMonth).slice(0, 24);
    $("#invoiceEmpty").classList.toggle("hidden", rows.length > 0);
    $("#invoiceTableBody").innerHTML = rows.map((row) => `<tr><td>${monthLabel(row.month)}</td><td class="align-right money-value">${formatCurrency(row.total)}</td><td class="align-right">${row.count}</td></tr>`).join("");
    const future = futureCreditCommitment();
    $("#invoiceCommitment").textContent = future > 0 ? `${formatCurrency(future)} em parcelas futuras` : "Sem parcelas futuras";
  }

  function renderRecurringList() {
    const freq = { monthly: "Mensal", weekly: "Semanal", annual: "Anual" };
    $("#recurringList").innerHTML = state.recurrences.length ? state.recurrences.map((item) => {
      const skipped = (item.skippedMonths || []).includes(selectedMonth);
      return `<div class="management-item"><div><strong>${escapeHtml(item.description)}</strong><small>${freq[item.frequency]} · vence dia ${item.dueDay} · ${formatCurrency(item.amount)}</small></div><div class="row-actions"><button class="row-action" data-skip-recurrence="${item.id}" type="button">${skipped ? "Reativar mês" : "Ignorar este mês"}</button><button class="row-action" data-delete-recurrence="${item.id}" type="button">Excluir</button></div></div>`;
    }).join("") : '<p class="empty-state">Nenhuma recorrência cadastrada.</p>';
  }

  function renderClosures() {
    const closures = Object.values(state.closures).sort((a, b) => b.month.localeCompare(a.month));
    $("#closureList").innerHTML = closures.length ? closures.map((item) => `<div class="closure-item"><div><strong>${monthLabel(item.month)}</strong><small>Saldo ${formatCurrency(item.balance)} · pontuação ${item.score}/100</small></div><button class="row-action" data-download-closure="${item.month}" type="button">Baixar PDF</button></div>`).join("") : '<p class="empty-state">Nenhum mês fechado.</p>';
  }

  function openCloseMonthReview() {
    const stats = getMonthStats();
    const alreadyClosed = Boolean(state.closures[selectedMonth]);
    const pendingCount = state.transactions.filter((item) => monthFromDate(item.date) === selectedMonth && item.status === "pending").length;
    $("#closeMonthModalTitle").textContent = `${alreadyClosed ? "Atualizar" : "Fechar"} ${monthLabel(selectedMonth)}`;
    $("#closeMonthModalDescription").textContent = "Confira os valores antes de concluir o fechamento deste período.";
    $("#closeMonthIncome").textContent = formatCurrency(stats.income);
    $("#closeMonthExpenses").textContent = formatCurrency(stats.totalExpenses);
    $("#closeMonthInvested").textContent = formatCurrency(stats.invested);
    $("#closeMonthBalance").textContent = formatCurrency(stats.balance);
    $("#closeMonthBalance").closest(".close-month-balance").classList.toggle("negative", stats.balance < 0);
    $("#closeMonthPending").textContent = `${pendingCount} · ${formatCurrency(stats.pendingExpenses)}`;
    $("#closeMonthScore").textContent = `${stats.score}/100 · ${stats.level}`;
    $("#closeMonthNote").textContent = alreadyClosed ? "O resumo anterior será substituído e um novo PDF será gerado." : "Um resumo permanente e o relatório PDF serão gerados.";
    $("#confirmCloseMonth").textContent = alreadyClosed ? "Atualizar fechamento" : "Confirmar fechamento";
    $("#closeMonthModal").showModal();
  }

  function closeSelectedMonth(event) {
    event?.preventDefault();
    const stats = getMonthStats();
    const previous = getMonthStats(getPreviousMonthKey(selectedMonth));
    const categoryChanges = expenseCategories.map((category) => ({ category, change: Number(stats.categoryTotals[category] || 0) - Number(previous.categoryTotals[category] || 0) })).sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
    state.closures[selectedMonth] = { month: selectedMonth, closedAt: todayISO(), income: stats.income, expenses: stats.totalExpenses, invested: stats.invested, balance: stats.balance, forecastBalance: stats.forecastBalance, pending: stats.pendingExpenses, score: stats.score, level: stats.level, savingsRate: stats.income > 0 ? ((stats.balance + stats.invested) / stats.income) * 100 : 0, categoryChanges: categoryChanges.slice(0, 3) };
    state.transactions.filter((item) => monthFromDate(item.date) === selectedMonth && item.status === "pending").forEach((item) => {
      const next = addMonths(new Date(`${item.date}T12:00:00`), 1);
      const nextDate = safeDate(next.getFullYear(), next.getMonth(), new Date(`${item.date}T12:00:00`).getDate());
      const transferKey = `carry_${item.id}_${monthFromDate(toISO(nextDate))}`;
      if (!state.transactions.some((tx) => tx.transferKey === transferKey)) state.transactions.push({ ...item, id: generateId("tx"), date: toISO(nextDate), transferKey, notes: `${item.notes ? `${item.notes} · ` : ""}Transferido de ${monthLabel(selectedMonth)}` });
    });
    saveState(); $("#closeMonthModal").close(); renderAll(); downloadClosurePdf(selectedMonth); showToast("Mês fechado e relatório gerado.");
  }

  function pdfEscape(value) { return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7E]/g, " ").replace(/[()\\]/g, "\\$&"); }
  function pdfHex(value) {
    return Array.from(String(value)).map((character) => {
      const code = character.charCodeAt(0);
      return (code <= 255 ? code : 63).toString(16).padStart(2, "0");
    }).join("");
  }
  function pdfCurrency(value) { return formatCurrency(value).replace(/\u00a0/g, " "); }
  function pdfText(value, x, y, size = 11, font = "F1", color = "0.12 0.16 0.14") {
    return `BT ${color} rg /${font} ${size} Tf ${x} ${y} Td <${pdfHex(value)}> Tj ET`;
  }
  function pdfRect(x, y, width, height, color) { return `${color} rg ${x} ${y} ${width} ${height} re f`; }
  function buildClosurePdf(item, month) {
    const commands = [];
    const positive = Number(item.balance || 0) >= 0;
    const savingsRate = Number.isFinite(Number(item.savingsRate))
      ? Number(item.savingsRate)
      : (Number(item.income || 0) > 0 ? ((Number(item.balance || 0) + Number(item.invested || 0)) / Number(item.income)) * 100 : 0);
    const accent = positive ? "0.18 0.54 0.41" : "0.72 0.24 0.28";
    const card = (x, y, label, value, valueColor = "0.10 0.14 0.12") => {
      commands.push(pdfRect(x, y, 247, 72, "0.96 0.98 0.97"));
      commands.push(pdfText(label.toUpperCase(), x + 18, y + 48, 8, "F2", "0.42 0.47 0.44"));
      commands.push(pdfText(value, x + 18, y + 20, 18, "F2", valueColor));
    };

    commands.push(pdfRect(0, 642, 595, 200, "0.12 0.39 0.29"));
    commands.push(pdfText("DESPESA MENSAL", 42, 795, 10, "F2", "0.78 0.91 0.85"));
    commands.push(pdfText("Relatório mensal", 42, 750, 28, "F2", "1 1 1"));
    commands.push(pdfText(monthLabel(month), 42, 720, 14, "F1", "0.88 0.96 0.92"));
    commands.push(pdfRect(431, 706, 122, 72, "0.24 0.52 0.41"));
    commands.push(pdfText("SAÚDE FINANCEIRA", 446, 756, 7, "F2", "0.82 0.93 0.88"));
    commands.push(pdfText(`${item.score}/100`, 446, 730, 20, "F2", "1 1 1"));
    commands.push(pdfText(item.level || "", 446, 714, 8, "F1", "0.90 0.96 0.93"));

    commands.push(pdfText("Resumo do período", 42, 610, 16, "F2"));
    card(42, 515, "Receitas", pdfCurrency(item.income), "0.12 0.48 0.34");
    card(306, 515, "Despesas", pdfCurrency(item.expenses), "0.66 0.22 0.27");
    card(42, 427, "Investimentos", pdfCurrency(item.invested), "0.25 0.38 0.68");
    card(306, 427, "Saldo do mes", pdfCurrency(item.balance), accent);

    commands.push(pdfText("Planejamento e fechamento", 42, 385, 16, "F2"));
    commands.push(pdfRect(42, 315, 511, 52, "0.94 0.96 0.95"));
    commands.push(pdfText("SALDO PREVISTO", 58, 346, 8, "F2", "0.42 0.47 0.44"));
    commands.push(pdfText(pdfCurrency(item.forecastBalance), 58, 326, 14, "F2"));
    commands.push(pdfText("PENDÊNCIAS TRANSFERIDAS", 305, 346, 8, "F2", "0.42 0.47 0.44"));
    commands.push(pdfText(pdfCurrency(item.pending), 305, 326, 14, "F2"));

    commands.push(pdfText("Maiores variações por categoria", 42, 276, 16, "F2"));
    const changes = (item.categoryChanges || []).slice(0, 3);
    if (!changes.length) commands.push(pdfText("Não houve variações relevantes neste período.", 42, 242, 11, "F1", "0.42 0.47 0.44"));
    changes.forEach((change, index) => {
      const y = 236 - index * 38;
      const changePositive = Number(change.change || 0) <= 0;
      commands.push(pdfRect(42, y - 12, 511, 30, index % 2 ? "0.98 0.99 0.98" : "0.95 0.97 0.96"));
      commands.push(pdfText(change.category, 56, y, 10, "F1"));
      commands.push(pdfText(`${change.change >= 0 ? "+" : ""}${pdfCurrency(change.change)}`, 430, y, 10, "F2", changePositive ? "0.12 0.48 0.34" : "0.66 0.22 0.27"));
    });

    commands.push(pdfRect(42, 78, 511, 54, positive ? "0.91 0.97 0.94" : "0.99 0.92 0.92"));
    commands.push(pdfText("LEITURA DO MÊS", 58, 111, 8, "F2", positive ? "0.12 0.48 0.34" : "0.66 0.22 0.27"));
    commands.push(pdfText(positive ? "O período terminou com saldo positivo." : "O período terminou com saldo negativo.", 58, 91, 11, "F2", accent));
    commands.push(pdfText(`Taxa de economia: ${savingsRate.toFixed(1).replace(".", ",")}%`, 388, 91, 9, "F2", "0.32 0.38 0.35"));

    commands.push(pdfText(`Fechado em ${formatDate(item.closedAt)}`, 42, 48, 8, "F1", "0.48 0.52 0.50"));
    commands.push(pdfText("Gerado pela plataforma Despesa Mensal", 355, 48, 8, "F1", "0.48 0.52 0.50"));
    const stream = commands.join("\n");
    const objects = [
      "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
      "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
      "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >> endobj",
      "4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >> endobj",
      "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >> endobj",
      `6 0 obj << /Length ${stream.length} >> stream\n${stream}\nendstream endobj`
    ];
    let pdf = "%PDF-1.4\n", offsets = [0];
    objects.forEach((object) => { offsets.push(pdf.length); pdf += `${object}\n`; });
    const xref = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => String(offset).padStart(10, "0") + " 00000 n ").join("\n")}\ntrailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return pdf;
  }
  function downloadClosurePdf(month) {
    const item = state.closures[month]; if (!item) return;
    const pdf = buildClosurePdf(item, month);
    const blob = new Blob([pdf], { type: "application/pdf" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `despesa-mensal-${month}.pdf`; link.click(); URL.revokeObjectURL(url);
  }

  function classLabel(value) {
    return ({ fixed: "Fixa", variable: "Variável", recurring: "Recorrente" })[value] || "—";
  }

  function renderInvestments() {
    const rows = [...state.investments].sort((a, b) => a.name.localeCompare(b.name));
    const monthTotal = monthInvestments().reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const totals = getInvestmentTotals();
    const liquidity = Math.max(0, getMonthStats().balance);

    $("#investmentMonthTotal").textContent = formatCurrency(monthTotal);
    $("#investmentContributedTotal").textContent = formatCurrency(totals.contributed);
    $("#investmentCurrentTotal").textContent = formatCurrency(totals.current);
    $("#portfolioHeroMetric").textContent = formatCurrency(totals.current);
    $("#portfolioLiquidityMetric").textContent = formatCurrency(liquidity);
    $("#investmentResultTotal").textContent = formatCurrency(totals.result);
    $("#investmentResultTotal").className = `money-value ${totals.result >= 0 ? "amount-positive" : "amount-negative"}`;

    const movementButton = $("#openInvestmentEventModal");
    movementButton.disabled = rows.length === 0;
    $("#investmentEventHint").textContent = rows.length
      ? "Registre aportes, resgates, rendimentos ou atualizações de valor."
      : "Cadastre um investimento antes de registrar movimentações.";

    const valuationIssues = rows.map((item) => ({ item, totals: getAssetTotals(item.id) })).filter(({ totals: asset }) => asset.isStale || asset.isEstimated);
    const valuationAlert = $("#investmentValuationAlert");
    valuationAlert.classList.toggle("hidden", valuationIssues.length === 0);
    valuationAlert.innerHTML = valuationIssues.length ? `<strong>Valores que merecem revisão</strong><span>${valuationIssues.map(({ item, totals: asset }) => `${escapeHtml(item.name)}: ${asset.isStale ? "valor atual desatualizado" : "valor estimado após movimentações"}`).join(" · ")}</span>` : "";

    $("#investmentsEmpty").classList.toggle("hidden", rows.length > 0);
    $("#investmentsTableBody").innerHTML = rows.map((item) => {
      const asset = getAssetTotals(item.id);
      const quantity = Number(item.quantity || 0);
      const unitValue = quantity > 0 ? asset.current / quantity : 0;
      return `
        <tr>
          <td><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.institution || "—")}</small></td>
          <td>${escapeHtml(item.type)}</td>
          <td>${escapeHtml(item.objective || "—")}</td>
          <td class="align-right">${quantity > 0 ? formatQuantity(quantity) : "—"}</td>
          <td class="align-right money-value">${formatCurrency(asset.contributions)}</td>
          <td class="align-right money-value">${formatCurrency(asset.withdrawals)}</td>
          <td class="align-right money-value amount-positive">${formatCurrency(asset.income)}</td>
          <td class="align-right"><strong class="money-value">${formatCurrency(asset.current)}</strong>${quantity > 0 ? `<small class="valuation-status">${formatUnitCurrency(unitValue)} por unidade</small>` : ""}<small class="valuation-status ${asset.isStale ? "stale" : asset.isEstimated ? "estimated" : ""}">${asset.isStale ? "Atualize o valor atual" : asset.isEstimated ? "Valor estimado" : `Atualizado em ${formatDate(asset.valuationDate)}`}</small></td>
          <td class="align-right ${asset.profitability >= 0 ? "amount-positive" : "amount-negative"}">${asset.profitability.toFixed(2).replace(".", ",")}%</td>
          <td><div class="row-actions"><button class="row-action" data-edit-investment="${item.id}" type="button">Editar</button><button class="row-action" data-delete-investment="${item.id}" type="button">Excluir</button></div></td>
        </tr>`;
    }).join("");
    populateInvestmentEventAssets();
    renderPatrimonyChart();
  }

  function renderInvestmentEvents() {
    const label = { contribution: "Aporte", withdrawal: "Resgate", income: "Rendimento", valuation: "Valor atual" };
    const rows = state.investmentEvents.map((item, stateIndex) => ({ ...item, stateIndex })).sort((a, b) => b.date.localeCompare(a.date) || b.stateIndex - a.stateIndex);
    $("#investmentEventsEmpty").classList.toggle("hidden", rows.length > 0);
    $("#investmentEventsBody").innerHTML = rows.map((event) => {
      const asset = state.investments.find((item) => item.id === event.assetId);
      return `<tr><td>${formatDate(event.date)}</td><td>${escapeHtml(asset?.name || "Investimento removido")}</td><td>${label[event.type] || event.type}</td><td class="align-right money-value">${formatCurrency(event.amount)}</td><td>${escapeHtml(event.notes || "—")}</td><td><button class="row-action" data-delete-investment-event="${event.id}" type="button">Excluir</button></td></tr>`;
    }).join("");
  }

  function renderPatrimonyChart() {
    const canvas = $("#patrimonyChart");
    const empty = $("#patrimonyChartEmpty");
    const months = getLastMonths(12);
    const values = months.map((month) => {
      const end = `${month}-31`;
      return state.investments.reduce((sum, asset) => sum + getAssetTotals(asset.id, end).current, 0);
    });
    const hasData = values.some((value) => value > 0);
    empty.classList.toggle("hidden", hasData);
    canvas.classList.toggle("hidden", !hasData);
    if (!hasData || !canvas.getBoundingClientRect().width) return;
    const { ctx, width, height } = setupCanvas(canvas, 260);
    const pad = 42;
    const max = Math.max(...values, 1);
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = cssVar("--green"); ctx.lineWidth = 3; ctx.beginPath();
    values.forEach((value, index) => {
      const x = pad + index * ((width - pad * 2) / Math.max(1, values.length - 1));
      const y = height - pad - (value / max) * (height - pad * 2);
      if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.fillStyle = cssVar("--muted"); ctx.font = "11px sans-serif"; ctx.textAlign = "center";
    months.forEach((month, index) => { if (index % 2 === 0 || index === months.length - 1) ctx.fillText(monthLabel(month, "short"), pad + index * ((width - pad * 2) / 11), height - 12); });
  }

  function getAchievements() {
    const monthStats = getMonthStats();
    const allMonths = [...new Set([
      ...Object.keys(state.plans),
      ...state.transactions.map((item) => monthFromDate(item.date)),
      ...state.investments.map((item) => monthFromDate(item.date))
    ])].sort();
    const monthStatsList = allMonths.map((month) => getMonthStats(month));
    const positiveMonths = monthStatsList.filter((item) => item.income > 0 && item.balance >= 0).length;
    const totalInvested = state.investments.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const monthsWithRecords = allMonths.filter((month) => monthTransactions(month).length > 0).length;

    return [
      { icon: "✓", title: "Primeiro mês positivo", description: "Feche um mês com saldo igual ou superior a zero.", unlocked: positiveMonths >= 1 },
      { icon: "⚡", title: "Trinca positiva", description: "Complete três meses positivos.", unlocked: positiveMonths >= 3 },
      { icon: "◆", title: "Primeiro aporte", description: "Registre seu primeiro investimento.", unlocked: totalInvested > 0 },
      { icon: "◎", title: "Meta alcançada", description: "Atinja a meta de investimento do mês.", unlocked: monthStats.plan.investmentGoal > 0 && monthStats.invested >= monthStats.plan.investmentGoal },
      { icon: "▣", title: "Orçamento respeitado", description: "Fique dentro do limite total de gastos.", unlocked: monthStats.plan.budget > 0 && monthStats.totalExpenses <= monthStats.plan.budget },
      { icon: "★", title: "Mês impecável", description: "Alcance 90 pontos ou mais.", unlocked: monthStats.score >= 90 },
      { icon: "↗", title: "Consistência", description: "Registre movimentações em três meses diferentes.", unlocked: monthsWithRecords >= 3 },
      { icon: "∞", title: "Investidor constante", description: "Some R$ 5.000 em aportes registrados.", unlocked: totalInvested >= 5000 }
    ];
  }

  function renderAchievementPreview() {
    const achievements = getAchievements();
    const unlocked = achievements.filter((item) => item.unlocked);
    const display = [...unlocked, ...achievements.filter((item) => !item.unlocked)].slice(0, 3);
    $("#achievementPreview").innerHTML = display.map((item) => achievementCard(item)).join("");
  }

  function achievementCard(item) {
    return `
      <div class="achievement-card ${item.unlocked ? "" : "locked"}">
        <span class="achievement-icon">${item.icon}</span>
        <strong>${escapeHtml(item.title)}</strong>
        <small>${escapeHtml(item.unlocked ? "Conquista desbloqueada" : "Ainda bloqueada")}</small>
      </div>
    `;
  }

  function renderGoals() {
    const stats = getMonthStats();
    $("#scoreRing").style.setProperty("--score", stats.score);
    $("#scoreRingValue").textContent = stats.score;
    $("#levelTitle").textContent = stats.level;
    $("#levelDescription").textContent = stats.levelDescription;
    $("#scoreBreakdown").innerHTML = stats.scoreItems.map((item) => `
      <div class="challenge-item ${item.completed ? "completed" : ""}">
        <div>
          <span class="challenge-check">${item.completed ? "✓" : "○"}</span>
          <span>${escapeHtml(item.label)}</span>
        </div>
        <span class="challenge-points">+${item.points}</span>
      </div>
    `).join("");
    $("#achievementGallery").innerHTML = getAchievements().map((item) => achievementCardDetailed(item)).join("");
  }

  function achievementCardDetailed(item) {
    return `
      <div class="achievement-card ${item.unlocked ? "" : "locked"}">
        <span class="achievement-icon">${item.icon}</span>
        <strong>${escapeHtml(item.title)}</strong>
        <small>${escapeHtml(item.description)}</small>
      </div>
    `;
  }

  function openTransactionModal(id = null) {
    elements.transactionForm.reset();
    $("#transactionId").value = "";
    $("#transactionDate").value = `${selectedMonth}-${selectedMonth === currentMonthKey() ? todayISO().slice(8, 10) : "01"}`;
    $("#transactionType").value = "expense";
    $("#transactionStatus").value = "paid";
    $("#transactionInstallmentCount").value = "1";
    $("#transactionInstallmentCount").disabled = false;
    $("#transactionModalTitle").textContent = id ? "Editar movimentação" : "Adicionar movimentação";
    populateCategories("expense");
    toggleExpenseFields();

    if (id) {
      const item = state.transactions.find((entry) => entry.id === id);
      if (!item) return;
      $("#transactionId").value = item.id;
      $("#transactionType").value = item.type;
      populateCategories(item.type);
      $("#transactionDate").value = item.date;
      $("#transactionDescription").value = item.description;
      $("#transactionAmount").value = item.amount;
      $("#transactionCategory").value = item.category;
      $("#transactionExpenseClass").value = item.expenseClass || "variable";
      $("#transactionStatus").value = item.status;
      $("#transactionPaymentMethod").value = item.paymentMethod || "other";
      $("#transactionInstallmentCount").value = item.installmentCount || 1;
      $("#transactionInstallmentCount").disabled = Boolean(item.installmentGroup);
      $("#transactionNotes").value = item.notes || "";
      toggleExpenseFields();
    }

    elements.transactionModal.showModal();
  }

  function openInvestmentModal(id = null) {
    elements.investmentForm.reset();
    $("#investmentId").value = "";
    $("#investmentDate").value = `${selectedMonth}-${selectedMonth === currentMonthKey() ? todayISO().slice(8, 10) : "01"}`;
    $("#investmentModalTitle").textContent = id ? "Editar investimento" : "Adicionar investimento";

    if (id) {
      const item = state.investments.find((entry) => entry.id === id);
      if (!item) return;
      $("#investmentId").value = item.id;
      $("#investmentDate").value = item.date;
      $("#investmentType").value = item.type;
      $("#investmentName").value = item.name;
      $("#investmentInstitution").value = item.institution || "";
      $("#investmentObjective").value = item.objective || "";
      $("#investmentAmount").value = item.amount;
      $("#investmentQuantity").value = item.quantity || "";
      $("#investmentCurrentValue").value = item.currentValue ?? item.amount;
      $("#investmentNotes").value = item.notes || "";
    }

    elements.investmentModal.showModal();
  }

  function openPlanModal() {
    const plan = getPlan();
    $("#planSalary").value = plan.salary || "";
    $("#planBudget").value = plan.budget || "";
    $("#planInvestmentGoal").value = plan.investmentGoal || "";
    elements.planModal.showModal();
  }

  function populateCategories(type) {
    const categories = type === "income" ? incomeCategories : expenseCategories;
    $("#transactionCategory").innerHTML = categories.map((category) => `<option value="${category}">${category}</option>`).join("");
  }

  function toggleExpenseFields() {
    const isExpense = $("#transactionType").value === "expense";
    const isCredit = isExpense && $("#transactionPaymentMethod").value === "credit";
    const currentCategory = $("#transactionCategory").value;
    $("#expenseClassField").classList.toggle("hidden", !isExpense);
    $("#creditPurchaseFields").classList.toggle("hidden", !isCredit);
    populateCategories(isExpense ? "expense" : "income");
    if ([...$("#transactionCategory").options].some((option) => option.value === currentCategory)) $("#transactionCategory").value = currentCategory;
  }

  function populateRecurringCategories() {
    const categories = $("#recurringType").value === "income" ? incomeCategories : expenseCategories;
    $("#recurringCategory").innerHTML = categories.map((category) => `<option value="${category}">${category}</option>`).join("");
  }

  function openRecurringModal() {
    $("#recurringForm").reset(); $("#recurringId").value = ""; $("#recurringStart").value = todayISO(); populateRecurringCategories(); renderRecurringList(); $("#recurringModal").showModal();
  }

  function handleRecurringSubmit(event) {
    event.preventDefault();
    const item = { id: generateId("rec"), type: $("#recurringType").value, frequency: $("#recurringFrequency").value, description: $("#recurringDescription").value.trim(), amount: Number($("#recurringAmount").value), category: $("#recurringCategory").value, start: $("#recurringStart").value, end: $("#recurringEnd").value || null, dueDay: Number($("#recurringDueDay").value || 1), status: $("#recurringStatus").value, skippedMonths: [], active: true };
    state.recurrences.push(item); generateRecurringTransactions(); saveState(); renderAll(); renderRecurringList(); $("#recurringForm").reset(); $("#recurringStart").value = todayISO(); showToast("Recorrência criada e lançamentos gerados.");
  }

  function createInstallmentPurchase({ purchaseDate, count, total, description, category, expenseClass, notes }) {
    const date = new Date(`${purchaseDate}T12:00:00`);
    const base = new Date(date.getFullYear(), date.getMonth(), 1);
    const group = generateId("parcel");
    let allocated = 0;
    for (let index = 0; index < count; index += 1) {
      const month = addMonths(base, index);
      const amount = index === count - 1 ? Number((total - allocated).toFixed(2)) : Number((total / count).toFixed(2));
      allocated += amount;
      const installmentDate = safeDate(month.getFullYear(), month.getMonth(), date.getDate());
      state.transactions.push({
        id: generateId("tx"), type: "expense", date: toISO(installmentDate), invoiceMonth: monthFromDate(toISO(installmentDate)),
        description: count > 1 ? `${description} (${index + 1}/${count})` : description,
        amount, category, expenseClass, status: "pending", paymentMethod: "credit",
        installmentGroup: group, installmentNumber: index + 1, installmentCount: count,
        notes: notes || (count > 1 ? "Compra parcelada" : "Compra no crédito")
      });
    }
  }

  function populateInvestmentEventAssets() {
    $("#investmentEventAsset").innerHTML = state.investments.map((asset) => `<option value="${asset.id}">${escapeHtml(asset.name)}</option>`).join("") || '<option value="">Cadastre um investimento primeiro</option>';
  }

  function updateInvestmentEventHelp() {
    const messages = {
      contribution: "Aporte adiciona capital ao investimento e aumenta provisoriamente o valor atual.",
      withdrawal: "Resgate retira capital e reduz provisoriamente o valor atual do investimento.",
      income: "Rendimento registra juros, dividendos ou outros valores recebidos sem alterar o valor atual informado.",
      valuation: "Valor atual substitui a estimativa anterior pelo saldo total informado nesta data."
    };
    $("#investmentEventHelp").textContent = messages[$("#investmentEventType").value];
  }

  function handleInvestmentEventSubmit(event) {
    event.preventDefault(); const assetId = $("#investmentEventAsset").value; if (!state.investments.some((asset) => asset.id === assetId)) return alert("Cadastre um investimento primeiro."); state.investmentEvents.push({ id: generateId("evt"), assetId, type: $("#investmentEventType").value, date: $("#investmentEventDate").value, amount: Number($("#investmentEventAmount").value), notes: $("#investmentEventNotes").value.trim(), createdAt: new Date().toISOString() }); saveState(); $("#investmentEventModal").close(); renderAll(); showToast("Movimentação do investimento registrada.");
  }

  function handleOnboardingSubmit(event) {
    event.preventDefault();
    state.plans[selectedMonth] = {
      ...getPlan(),
      salary: Number($("#onboardingSalary").value || 0),
      budget: Number($("#onboardingBudget").value || 0),
      investmentGoal: Number($("#onboardingInvestment").value || 0)
    };
    state.onboardingCompleted = true;
    saveState();
    $("#onboardingModal").close();
    renderAll();
    showToast("Configuração inicial concluída.");
  }

  function handleTransactionSubmit(event) {
    event.preventDefault();
    const existingId = $("#transactionId").value;
    const id = existingId || generateId("tx");
    const type = $("#transactionType").value;
    const paymentMethod = $("#transactionPaymentMethod").value;
    if (!existingId && type === "expense" && paymentMethod === "credit") {
      const count = Math.max(1, Number($("#transactionInstallmentCount").value || 1));
      createInstallmentPurchase({
        purchaseDate: $("#transactionDate").value,
        count,
        total: Number($("#transactionAmount").value),
        description: $("#transactionDescription").value.trim(),
        category: $("#transactionCategory").value,
        expenseClass: $("#transactionExpenseClass").value,
        notes: $("#transactionNotes").value.trim()
      });
      saveState();
      elements.transactionModal.close();
      renderAll();
      showToast(count > 1 ? `${count} parcelas distribuídas nas faturas.` : "Compra adicionada à fatura.");
      return;
    }

    const existingItem = state.transactions.find((entry) => entry.id === id);
    const item = {
      id,
      type,
      date: $("#transactionDate").value,
      description: $("#transactionDescription").value.trim(),
      amount: Number($("#transactionAmount").value),
      category: $("#transactionCategory").value,
      expenseClass: type === "expense" ? $("#transactionExpenseClass").value : null,
      status: $("#transactionStatus").value,
      paymentMethod,
      notes: $("#transactionNotes").value.trim()
    };

    if (existingItem?.installmentGroup && paymentMethod === "credit") {
      Object.assign(item, {
        invoiceMonth: existingItem.invoiceMonth,
        installmentGroup: existingItem.installmentGroup,
        installmentNumber: existingItem.installmentNumber,
        installmentCount: existingItem.installmentCount
      });
    }

    const existingIndex = state.transactions.findIndex((entry) => entry.id === id);
    if (existingIndex >= 0) state.transactions[existingIndex] = item;
    else state.transactions.push(item);

    saveState();
    elements.transactionModal.close();
    selectedMonth = monthFromDate(item.date);
    elements.monthSelector.value = selectedMonth;
    renderAll();
    showToast(existingIndex >= 0 ? "Movimentação atualizada." : "Movimentação adicionada.");
  }

  function handleInvestmentSubmit(event) {
    event.preventDefault();
    const id = $("#investmentId").value || generateId("inv");
    const amount = Number($("#investmentAmount").value);
    const currentInput = $("#investmentCurrentValue").value;
    const item = {
      id,
      date: $("#investmentDate").value,
      type: $("#investmentType").value,
      name: $("#investmentName").value.trim(),
      institution: $("#investmentInstitution").value.trim(),
      objective: $("#investmentObjective").value.trim(),
      amount,
      quantity: Number($("#investmentQuantity").value || 0),
      currentValue: currentInput === "" ? amount : Number(currentInput),
      notes: $("#investmentNotes").value.trim()
    };

    const existingIndex = state.investments.findIndex((entry) => entry.id === id);
    if (existingIndex >= 0) {
      state.investments[existingIndex] = item;

      const assetEvents = state.investmentEvents
        .map((entry, stateIndex) => ({ entry, stateIndex }))
        .filter(({ entry }) => entry.assetId === id);
      const initialContribution = assetEvents.find(({ entry }) => entry.type === "contribution" && entry.notes === "Aporte inicial")
        || assetEvents.find(({ entry }) => entry.type === "contribution");
      const latestValuation = assetEvents
        .filter(({ entry }) => entry.type === "valuation")
        .sort((a, b) => a.entry.date.localeCompare(b.entry.date) || a.stateIndex - b.stateIndex)
        .at(-1);

      if (initialContribution) {
        initialContribution.entry.amount = amount;
        initialContribution.entry.date = item.date;
      } else if (amount > 0) {
        state.investmentEvents.push({ id: generateId("evt"), assetId: id, type: "contribution", date: item.date, amount, notes: "Aporte inicial" });
      }

      if (latestValuation) {
        latestValuation.entry.amount = item.currentValue;
      } else {
        state.investmentEvents.push({ id: generateId("evt"), assetId: id, type: "valuation", date: item.date, amount: item.currentValue, notes: "Valor atual informado" });
      }
    }
    else {
      state.investments.push(item);
      if (amount > 0) state.investmentEvents.push({ id: generateId("evt"), assetId: id, type: "contribution", date: item.date, amount, notes: "Aporte inicial" });
      state.investmentEvents.push({ id: generateId("evt"), assetId: id, type: "valuation", date: item.date, amount: Number(item.currentValue || amount), notes: "Valor atual inicial" });
    }

    saveState();
    elements.investmentModal.close();
    selectedMonth = monthFromDate(item.date);
    elements.monthSelector.value = selectedMonth;
    renderAll();
    showToast(existingIndex >= 0 ? "Investimento atualizado." : "Investimento adicionado.");
  }

  function handlePlanSubmit(event) {
    event.preventDefault();
    const categoryBudgets = {};
    $$('[data-category-budget]').forEach((input) => { categoryBudgets[input.dataset.categoryBudget] = Number(input.value || 0); });
    state.plans[selectedMonth] = {
      salary: Number($("#planSalary").value || 0),
      budget: Number($("#planBudget").value || 0),
      investmentGoal: Number($("#planInvestmentGoal").value || 0),
      categoryBudgets
    };
    saveState();
    elements.planModal.close();
    renderAll();
    showToast("Planejamento do mês salvo.");
  }

  function deleteTransaction(id) {
    const item = state.transactions.find((entry) => entry.id === id);
    if (!item) return;
    if (!confirm(`Excluir "${item.description}" no valor de ${formatCurrency(item.amount)}? Esta ação não pode ser desfeita.`)) return;
    state.transactions = state.transactions.filter((item) => item.id !== id);
    saveState();
    renderAll();
    showToast("Movimentação excluída.");
  }

  function deleteInvestment(id) {
    if (!confirm("Excluir este investimento?")) return;
    state.investments = state.investments.filter((item) => item.id !== id);
    state.investmentEvents = state.investmentEvents.filter((item) => item.assetId !== id);
    saveState();
    renderAll();
    showToast("Investimento excluído.");
  }

  function navigate(section) {
    const titles = {
      dashboard: "Visão geral",
      movements: "Despesas",
      investments: "Investimentos",
      goals: "Metas e conquistas",
      settings: "Configurações"
    };
    $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.section === section));
    $$(".app-section").forEach((item) => item.classList.remove("active"));
    $(`#${section}Section`).classList.add("active");
    elements.pageTitle.textContent = titles[section];
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (section === "dashboard") requestAnimationFrame(() => {
      renderHistoryChart();
      renderCategoryChart(getMonthStats());
    });
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `despesa-mensal-backup-${todayISO()}.json`;
    link.click();
    URL.revokeObjectURL(url);
    showToast("Backup exportado.");
  }

  function importData(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed || !Array.isArray(parsed.transactions) || !Array.isArray(parsed.investments)) {
          throw new Error("Formato inválido");
        }
        const summary = [
          "Importar este backup e substituir os dados atuais?",
          "",
          `Movimentações: ${parsed.transactions.length}`,
          `Investimentos: ${parsed.investments.length}`,
          `Recorrências: ${Array.isArray(parsed.recurrences) ? parsed.recurrences.length : 0}`,
          `Fechamentos: ${Object.keys(parsed.closures || {}).length}`,
          "",
          "Recomendação: exporte um backup dos dados atuais antes de continuar."
        ].join("\n");
        if (!confirm(summary)) {
          showToast("Importação cancelada. Seus dados foram mantidos.");
          return;
        }
        state = {
          ...structuredClone(defaultState),
          ...parsed,
          plans: parsed.plans || {},
          transactions: parsed.transactions,
          investments: parsed.investments,
          investmentEvents: Array.isArray(parsed.investmentEvents) ? parsed.investmentEvents : [],
          recurrences: Array.isArray(parsed.recurrences) ? parsed.recurrences : [],
          cards: Array.isArray(parsed.cards) ? parsed.cards : [],
          closures: parsed.closures || {},
          onboardingCompleted: true
        };
        saveState();
        renderAll();
        showToast("Backup importado com sucesso.");
      } catch (error) {
        console.error(error);
        alert("Não foi possível importar este arquivo. Verifique se ele é um backup válido do Despesa Mensal.");
      }
    };
    reader.readAsText(file);
  }

  function clearData() {
    const confirmed = confirm("Esta ação apagará todos os dados financeiros salvos neste navegador. Continuar?");
    if (!confirmed) return;
    state = structuredClone(defaultState);
    saveState();
    renderAll();
    showToast("Todos os dados foram apagados.");
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.add("show");
    toastTimer = setTimeout(() => elements.toast.classList.remove("show"), 2600);
  }

  function applyTheme(theme) {
    document.body.classList.toggle("dark", theme === "dark");
    localStorage.setItem(THEME_KEY, theme);
    [$("#themeToggle"), $("#themeToggleSettings")].filter(Boolean).forEach((button) => {
      button.textContent = theme === "dark" ? "Usar tema claro" : "Usar tema escuro";
      button.setAttribute("aria-pressed", String(theme === "dark"));
    });
    requestAnimationFrame(() => {
      renderHistoryChart();
      renderCategoryChart(getMonthStats());
    });
  }

  function maskEmail(email) {
    const [name = "", domain = ""] = String(email || "").split("@");
    if (!domain) return email;
    const visible = name.slice(0, Math.min(2, name.length));
    return `${visible}${"*".repeat(Math.max(3, name.length - visible.length))}@${domain}`;
  }

  function getInitials(name) {
    return String(name || "DM").trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "DM";
  }

  function profileFromCloudUser(user) {
    const email = String(user?.email || "");
    const fallbackName = email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
    return { id: user?.id, name: user?.user_metadata?.full_name || fallbackName || "Usuário", email };
  }

  function setAuthBusy(form, busy) {
    form.querySelectorAll("input, button").forEach((control) => { control.disabled = busy; });
    form.setAttribute("aria-busy", String(busy));
  }

  function updateAuthNotice(title, message) {
    const notice = $("#authEnvironmentNotice");
    notice.querySelector("strong").textContent = title;
    const paragraph = notice.querySelector("p");
    const detail = [...paragraph.childNodes].find((node) => node.nodeType === Node.TEXT_NODE);
    if (detail) detail.textContent = message;
    else paragraph.append(document.createTextNode(message));
  }

  function requireAuthentication(message = "Entre com a conta vinculada à sua compra para continuar.") {
    demoUser = null;
    document.body.classList.add("cloud-auth-required");
    updateProfileButton();
    updateAuthNotice("Acesso protegido", message);
    setAuthView("login");
    if (!$("#authModal").open) $("#authModal").showModal();
  }

  function releaseAuthenticationGate() {
    document.body.classList.remove("cloud-auth-required");
    updateAuthNotice("Conta protegida", "Seus dados são vinculados somente ao seu usuário.");
  }

  async function acceptCloudSession(session, showError = true) {
    if (!session?.user) {
      requireAuthentication();
      return false;
    }
    try {
      const entitlement = await cloud.getEntitlement();
      if (!cloud.hasActiveEntitlement(entitlement)) {
        await cloud.signOut();
        if (showError) $("#loginError").textContent = "Este e-mail ainda não possui acesso ativo. Use o mesmo e-mail informado na compra.";
        requireAuthentication("Sua conta foi identificada, mas o acesso comercial ainda não está ativo.");
        return false;
      }
      demoUser = profileFromCloudUser(session.user);
      releaseAuthenticationGate();
      updateProfileButton();
      if ($("#authModal").open) $("#authModal").close();
      if (!state.onboardingCompleted) setTimeout(() => $("#onboardingModal").showModal(), 200);
      return true;
    } catch (error) {
      console.error("Falha ao validar acesso:", error);
      if (showError) $("#loginError").textContent = cloud.friendlyError(error);
      requireAuthentication("Não foi possível validar seu acesso agora. Tente novamente.");
      return false;
    }
  }

  async function initializeCloudAuth() {
    if (!cloudRequired || !cloud?.configured) {
      requireAuthentication("A conexão segura não carregou. Atualize a página ou verifique sua internet.");
      $("#loginError").textContent = "Serviço de autenticação indisponível.";
      return;
    }
    try {
      const session = await cloud.getSession();
      await acceptCloudSession(session, false);
      cloud.onAuthStateChange((event, nextSession) => {
        if (event === "SIGNED_OUT") requireAuthentication();
        if (event === "TOKEN_REFRESHED" && nextSession?.user && demoUser) demoUser = profileFromCloudUser(nextSession.user);
      });
    } catch (error) {
      console.error("Falha ao iniciar autenticação:", error);
      requireAuthentication("Não foi possível conectar com segurança. Tente novamente.");
    } finally {
      authInitialized = true;
    }
  }

  function setAuthView(view) {
    $$('[data-auth-view]').forEach((section) => section.classList.toggle("hidden", section.dataset.authView !== view));
    const titles = { login: "Acesse sua conta", register: "Crie sua conta", verify: "Confirme seu e-mail", forgot: "Recupere seu acesso", "reset-sent": "Confira seu e-mail", profile: "Sua conta", account: "Minha conta", security: "Segurança", terms: "Termos e privacidade" };
    $("#authModalTitle").textContent = titles[view] || "Sua conta";
    $$('[data-auth-tab]').forEach((button) => {
      if (!button.closest(".auth-tabs")) return;
      const active = button.dataset.authTab === view;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    if (demoUser && ["profile", "account", "security"].includes(view)) {
      $("#profileName").textContent = demoUser.name;
      $("#profileEmail").textContent = demoUser.email;
      $("#profileInitials").textContent = getInitials(demoUser.name);
      $("#accountName").value = demoUser.name;
      $("#accountEmail").value = demoUser.email;
      $("#securityVerifiedEmail").textContent = demoUser.email;
    }
    if (view !== "verify") clearInterval(resendTimer);
  }

  function updateProfileButton() {
    const button = $("#openAuthModal");
    button.classList.toggle("authenticated", Boolean(demoUser));
    button.setAttribute("aria-label", demoUser ? `Abrir perfil de ${demoUser.name}` : "Acessar conta");
    button.title = demoUser ? `Perfil de ${demoUser.name}` : "Acessar conta";
  }

  function openAuthModal() {
    if (demoUser) {
      setAuthView("profile");
    } else {
      setAuthView("login");
    }
    if (!$("#authModal").open) $("#authModal").showModal();
  }

  function updatePasswordRequirements() {
    const password = $("#registerPassword").value;
    const requirements = [
      ["#passwordRequirementLength", password.length >= 8],
      ["#passwordRequirementLetter", /[A-Za-z]/.test(password)],
      ["#passwordRequirementNumber", /\d/.test(password)]
    ];
    requirements.forEach(([selector, met]) => $(selector).classList.toggle("met", met));
    const confirmation = $("#registerPasswordConfirm").value;
    const ready = requirements.every(([, met]) => met)
      && confirmation === password
      && $("#registerName").value.trim().length > 0
      && $("#registerEmail").checkValidity()
      && $("#registerTerms").checked;
    $("#registerSubmitButton").disabled = !ready;
  }

  function startResendCountdown() {
    clearInterval(resendTimer);
    let remaining = RESEND_DELAY_SECONDS;
    const label = $("#resendCountdown");
    const resend = $("#resendCode");
    label.classList.remove("hidden");
    resend.classList.add("hidden");
    const render = () => { label.textContent = `Reenviar código em 00:${String(remaining).padStart(2, "0")}`; };
    render();
    resendTimer = setInterval(() => {
      remaining -= 1;
      render();
      if (remaining <= 0) {
        clearInterval(resendTimer);
        label.classList.add("hidden");
        resend.classList.remove("hidden");
      }
    }, 1000);
  }

  function clearOtp() {
    $$('[data-otp]').forEach((input) => { input.value = ""; });
    $("#verificationError").textContent = "";
    verificationAttempts = 0;
    $$('[data-otp]')[0]?.focus();
  }

  async function handleRegisterSubmit(event) {
    event.preventDefault();
    const name = $("#registerName").value.trim();
    const email = $("#registerEmail").value.trim().toLowerCase();
    const password = $("#registerPassword").value;
    const confirmation = $("#registerPasswordConfirm").value;
    const error = $("#registerError");
    error.textContent = "";
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) { error.textContent = "A senha deve ter pelo menos 8 caracteres, incluindo uma letra e um número."; return; }
    if (password !== confirmation) { error.textContent = "As senhas informadas não são iguais."; return; }
    if (!$("#registerTerms").checked) { error.textContent = "Aceite os termos para continuar."; return; }
    setAuthBusy(event.currentTarget, true);
    try {
      await cloud.signUp({ name, email, password });
      pendingRegistration = { name, email };
      $("#verificationEmail").textContent = maskEmail(email);
      clearOtp();
      $("#verificationForm button[type='submit']").disabled = false;
      setAuthView("verify");
      startResendCountdown();
    } catch (requestError) {
      error.textContent = cloud.friendlyError(requestError);
    } finally {
      setAuthBusy(event.currentTarget, false);
      updatePasswordRequirements();
    }
  }

  async function handleVerificationSubmit(event) {
    event.preventDefault();
    const code = $$('[data-otp]').map((input) => input.value).join("");
    const error = $("#verificationError");
    if (!pendingRegistration?.email || code.length !== 6) { error.textContent = "Digite os seis dígitos enviados ao seu e-mail."; return; }
    setAuthBusy(event.currentTarget, true);
    try {
      const data = await cloud.verifySignup({ email: pendingRegistration.email, token: code });
      await cloud.acceptTerms();
      const allowed = await acceptCloudSession(data.session);
      if (!allowed) return;
      pendingRegistration = null;
      clearInterval(resendTimer);
      $("#registerForm").reset();
      updatePasswordRequirements();
      showToast("E-mail confirmado. Sua conta está protegida.");
    } catch (requestError) {
      verificationAttempts += 1;
      const remaining = Math.max(0, 5 - verificationAttempts);
      error.textContent = `${cloud.friendlyError(requestError)}${remaining ? ` Restam ${remaining} tentativa${remaining === 1 ? "" : "s"}.` : " Solicite um novo código."}`;
      if (!remaining) $("#verificationForm button[type='submit']").disabled = true;
    } finally {
      setAuthBusy(event.currentTarget, false);
      if (verificationAttempts >= 5) $("#verificationForm button[type='submit']").disabled = true;
    }
  }

  async function handleLoginSubmit(event) {
    event.preventDefault();
    const email = $("#loginEmail").value.trim().toLowerCase();
    const error = $("#loginError");
    error.textContent = "";
    setAuthBusy(event.currentTarget, true);
    try {
      const data = await cloud.signIn({ email, password: $("#loginPassword").value });
      if (await acceptCloudSession(data.session)) {
        $("#loginForm").reset();
        showToast("Login realizado com segurança.");
      }
    } catch (requestError) {
      error.textContent = cloud.friendlyError(requestError);
    } finally {
      setAuthBusy(event.currentTarget, false);
    }
  }

  async function handleForgotSubmit(event) {
    event.preventDefault();
    const email = $("#forgotEmail").value.trim().toLowerCase();
    setAuthBusy(event.currentTarget, true);
    try {
      await cloud.requestPasswordReset(email);
      $("#resetEmail").textContent = maskEmail(email);
      setAuthView("reset-sent");
    } catch (requestError) {
      showToast(cloud.friendlyError(requestError));
    } finally {
      setAuthBusy(event.currentTarget, false);
    }
  }

  async function handleAccountSubmit(event) {
    event.preventDefault();
    if (!demoUser) return setAuthView("login");
    setAuthBusy(event.currentTarget, true);
    try {
      const user = await cloud.updateProfile($("#accountName").value.trim() || demoUser.name);
      demoUser = profileFromCloudUser(user);
      updateProfileButton();
      setAuthView("profile");
      showToast("Nome atualizado.");
    } catch (requestError) {
      showToast(cloud.friendlyError(requestError));
    } finally {
      setAuthBusy(event.currentTarget, false);
    }
  }

  async function handleSecurityPasswordSubmit(event) {
    event.preventDefault();
    const password = $("#newSecurityPassword").value;
    const confirmation = $("#confirmSecurityPassword").value;
    const error = $("#securityPasswordError");
    error.textContent = "";
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      error.textContent = "Use pelo menos 8 caracteres, incluindo uma letra e um número.";
      return;
    }
    if (password !== confirmation) {
      error.textContent = "As novas senhas não são iguais.";
      return;
    }
    setAuthBusy(event.currentTarget, true);
    try {
      await cloud.changePassword({ email: demoUser.email, currentPassword: $("#currentPassword").value, newPassword: password });
      event.currentTarget.reset();
      showToast("Senha atualizada com segurança.");
    } catch (requestError) {
      error.textContent = cloud.friendlyError(requestError);
    } finally {
      setAuthBusy(event.currentTarget, false);
    }
  }

  function handleSecurityEmailSubmit(event) {
    event.preventDefault();
    if (!demoUser) return setAuthView("login");
    const email = $("#newSecurityEmail").value.trim().toLowerCase();
    showToast(`A alteração para ${maskEmail(email)} será ativada após os testes de autenticação.`);
  }

  function handleOtpInput(event) {
    const input = event.target;
    input.value = input.value.replace(/\D/g, "").slice(-1);
    if (input.value) input.nextElementSibling?.focus();
  }

  function handleOtpKeydown(event) {
    if (event.key === "Backspace" && !event.target.value) event.target.previousElementSibling?.focus();
  }

  function handleOtpPaste(event) {
    const digits = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!digits) return;
    event.preventDefault();
    $$('[data-otp]').forEach((input, index) => { input.value = digits[index] || ""; });
    $$('[data-otp]')[Math.min(digits.length, 6) - 1]?.focus();
  }

  function bindEvents() {
    elements.monthSelector.addEventListener("change", () => {
      selectedMonth = elements.monthSelector.value || currentMonthKey();
      renderAll();
    });
    $("#previousMonth").addEventListener("click", () => shiftMonth(-1));
    $("#nextMonth").addEventListener("click", () => shiftMonth(1));
    $("#privacyToggle").addEventListener("click", togglePrivacyValues);
    $("#openAuthModal").addEventListener("click", openAuthModal);

    $$(".nav-item").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.section)));
    $$('[data-section-link]').forEach((button) => button.addEventListener("click", () => navigate(button.dataset.sectionLink)));
    $$('[data-dashboard-view-button]').forEach((button) => button.addEventListener("click", () => setDashboardView(button.dataset.dashboardViewButton)));
    $$('[data-dashboard-filter]').forEach((button) => button.addEventListener("click", () => setDashboardFilter(button.dataset.dashboardFilter)));

    $("#openTransactionModal").addEventListener("click", () => openTransactionModal());
    $("#openTransactionModalSecondary").addEventListener("click", () => openTransactionModal());
    $("#openTransactionModalDashboard").addEventListener("click", () => openTransactionModal());
    $("#emptyAddDashboard").addEventListener("click", () => openTransactionModal());
    $("#openInstallmentPurchase").addEventListener("click", () => {
      openTransactionModal();
      $("#transactionPaymentMethod").value = "credit";
      $("#transactionExpenseClass").value = "variable";
      $("#transactionStatus").value = "pending";
      toggleExpenseFields();
    });
    $("#openInvestmentModal").addEventListener("click", () => openInvestmentModal());
    $("#openRecurringModal").addEventListener("click", openRecurringModal);
    $("#openInvestmentEventModal").addEventListener("click", () => {
      if (!state.investments.length) return;
      populateInvestmentEventAssets();
      $("#investmentEventForm").reset();
      $("#investmentEventDate").value = todayISO();
      populateInvestmentEventAssets();
      updateInvestmentEventHelp();
      $("#investmentEventModal").showModal();
    });
    $("#closeMonthButton").addEventListener("click", openCloseMonthReview);
    $("#closeMonthForm").addEventListener("submit", closeSelectedMonth);
    $("#openPlanModal").addEventListener("click", openPlanModal);
    $("#openPlanModalSecondary").addEventListener("click", openPlanModal);
    $("#openPlanModalMovement").addEventListener("click", openPlanModal);

    $$(".close-modal").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
    $("#transactionType").addEventListener("change", toggleExpenseFields);
    $("#transactionPaymentMethod").addEventListener("change", () => {
      toggleExpenseFields();
      if ($("#transactionType").value === "expense" && $("#transactionPaymentMethod").value === "credit") $("#transactionStatus").value = "pending";
    });
    elements.transactionForm.addEventListener("submit", handleTransactionSubmit);
    elements.investmentForm.addEventListener("submit", handleInvestmentSubmit);
    elements.planForm.addEventListener("submit", handlePlanSubmit);
    $("#recurringForm").addEventListener("submit", handleRecurringSubmit);
    $("#recurringType").addEventListener("change", populateRecurringCategories);
    $("#investmentEventForm").addEventListener("submit", handleInvestmentEventSubmit);
    $("#investmentEventType").addEventListener("change", updateInvestmentEventHelp);
    $("#onboardingForm").addEventListener("submit", handleOnboardingSubmit);
    $("#skipOnboarding").addEventListener("click", () => { state.onboardingCompleted = true; saveState(); $("#onboardingModal").close(); });

    $("#loginForm").addEventListener("submit", handleLoginSubmit);
    $("#registerForm").addEventListener("submit", handleRegisterSubmit);
    $("#verificationForm").addEventListener("submit", handleVerificationSubmit);
    $("#forgotPasswordForm").addEventListener("submit", handleForgotSubmit);
    $("#accountForm").addEventListener("submit", handleAccountSubmit);
    $("#changePasswordForm").addEventListener("submit", handleSecurityPasswordSubmit);
    $("#changeEmailForm").addEventListener("submit", handleSecurityEmailSubmit);
    $("#registerForm").addEventListener("input", updatePasswordRequirements);
    $("#registerForm").addEventListener("change", updatePasswordRequirements);
    $$('[data-auth-tab]').forEach((button) => button.addEventListener("click", () => setAuthView(button.dataset.authTab)));
    $$('[data-auth-action="forgot"]').forEach((button) => button.addEventListener("click", () => { $("#forgotEmail").value = $("#loginEmail").value; setAuthView("forgot"); }));
    $$('[data-toggle-password]').forEach((button) => button.addEventListener("click", () => {
      const input = $(`#${button.dataset.togglePassword}`);
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      button.setAttribute("aria-label", show ? "Ocultar senha" : "Mostrar senha");
    }));
    $$('[data-otp]').forEach((input) => { input.addEventListener("input", handleOtpInput); input.addEventListener("keydown", handleOtpKeydown); input.addEventListener("paste", handleOtpPaste); });
    $("#resendCode").addEventListener("click", async () => {
      if (!pendingRegistration?.email) return setAuthView("register");
      try {
        await cloud.resendSignup(pendingRegistration.email);
        clearOtp(); $("#verificationForm button[type='submit']").disabled = false; startResendCountdown();
        showToast("Novo código enviado.");
      } catch (error) { $("#verificationError").textContent = cloud.friendlyError(error); }
    });
    $("#logoutDemo").addEventListener("click", async () => {
      try { await cloud.signOut(); } catch (error) { console.error(error); }
      requireAuthentication(); showToast("Você saiu da conta.");
    });
    $("#logoutAllDemo").addEventListener("click", async () => {
      try { await cloud.signOut("global"); } catch (error) { console.error(error); }
      requireAuthentication(); showToast("Todas as sessões foram encerradas.");
    });
    $("#resendSecurityVerification").addEventListener("click", () => showToast("Seu e-mail já está confirmado."));
    $$('[data-demo-document]').forEach((button) => button.addEventListener("click", () => showToast("Documento em preparação para a versão comercial.")));
    $("#authModal").addEventListener("cancel", (event) => { if (cloudRequired && !demoUser) event.preventDefault(); });
    $("#authModal").addEventListener("close", () => {
      clearInterval(resendTimer);
      if (cloudRequired && authInitialized && !demoUser) setTimeout(() => requireAuthentication(), 0);
    });

    $("#transactionSearch").addEventListener("input", renderTransactions);
    $("#transactionTypeFilter").addEventListener("change", renderTransactions);
    $("#transactionStatusFilter").addEventListener("change", renderTransactions);
    $("#emptyAddTransaction").addEventListener("click", () => openTransactionModal());
    $("#emptyAddInvestment").addEventListener("click", () => openInvestmentModal());

    const handleTransactionTableAction = (event) => {
      const edit = event.target.closest("[data-edit-transaction]");
      const remove = event.target.closest("[data-delete-transaction]");
      if (edit) openTransactionModal(edit.dataset.editTransaction);
      if (remove) deleteTransaction(remove.dataset.deleteTransaction);
    };
    $("#transactionsTableBody").addEventListener("click", handleTransactionTableAction);
    $("#transactionsMobileList").addEventListener("click", handleTransactionTableAction);
    $("#dashboardTransactionRows").addEventListener("click", handleTransactionTableAction);

    $("#investmentsTableBody").addEventListener("click", (event) => {
      const edit = event.target.closest("[data-edit-investment]");
      const remove = event.target.closest("[data-delete-investment]");
      if (edit) openInvestmentModal(edit.dataset.editInvestment);
      if (remove) deleteInvestment(remove.dataset.deleteInvestment);
    });
    $("#investmentEventsBody").addEventListener("click", (event) => { const remove = event.target.closest("[data-delete-investment-event]"); if (remove && confirm("Excluir este evento?")) { state.investmentEvents = state.investmentEvents.filter((item) => item.id !== remove.dataset.deleteInvestmentEvent); saveState(); renderAll(); } });
    $("#recurringList").addEventListener("click", (event) => {
      const skip = event.target.closest("[data-skip-recurrence]"); const remove = event.target.closest("[data-delete-recurrence]");
      if (skip) { const item = state.recurrences.find((entry) => entry.id === skip.dataset.skipRecurrence); if (!item) return; item.skippedMonths ||= []; const wasSkipped = item.skippedMonths.includes(selectedMonth); if (wasSkipped) item.skippedMonths = item.skippedMonths.filter((month) => month !== selectedMonth); else { item.skippedMonths.push(selectedMonth); state.transactions = state.transactions.filter((tx) => !(tx.recurrenceId === item.id && monthFromDate(tx.date) === selectedMonth && tx.status === "pending")); } generateRecurringTransactions(); saveState(); renderAll(); renderRecurringList(); showToast(wasSkipped ? `Recorrência reativada em ${monthLabel(selectedMonth)}.` : `Recorrência ignorada em ${monthLabel(selectedMonth)}.`); }
      if (remove && confirm("Excluir esta recorrência e os lançamentos futuros pendentes?")) { const id = remove.dataset.deleteRecurrence; state.recurrences = state.recurrences.filter((item) => item.id !== id); state.transactions = state.transactions.filter((tx) => !(tx.recurrenceId === id && tx.status === "pending" && tx.date >= todayISO())); saveState(); renderAll(); renderRecurringList(); }
    });
    $("#closureList").addEventListener("click", (event) => { const download = event.target.closest("[data-download-closure]"); if (download) downloadClosurePdf(download.dataset.downloadClosure); });

    $("#exportData").addEventListener("click", exportData);
    $("#importData").addEventListener("change", (event) => {
      const [file] = event.target.files;
      if (file) importData(file);
      event.target.value = "";
    });
    $("#clearData").addEventListener("click", clearData);
    [$("#themeToggle"), $("#themeToggleSettings")].forEach((button) => button?.addEventListener("click", () => applyTheme(document.body.classList.contains("dark") ? "light" : "dark")));

    window.addEventListener("resize", debounce(() => {
      if ($("#dashboardSection").classList.contains("active") && dashboardView === "charts") {
        renderHistoryChart();
        renderCategoryChart(getMonthStats());
      }
    }, 150));
  }

  function debounce(fn, wait) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
  }

  async function init() {
    elements.monthSelector.value = selectedMonth;
    $("#transactionDate").value = todayISO();
    $("#investmentDate").value = todayISO();
    $("#investmentEventDate").value = todayISO();
    $("#recurringStart").value = todayISO();
    applyTheme(localStorage.getItem(THEME_KEY) || "light");
    applyPrivacyValues(localStorage.getItem(PRIVACY_KEY) === "true");
    bindEvents();
    updateProfileButton();
    setDashboardView(dashboardView);
    setDashboardFilter(dashboardFilter);
    if (window.matchMedia("(max-width: 760px)").matches) $("#forecastDisclosure").open = false;
    renderAll();
    await initializeCloudAuth();
  }

  init();
})();

