(() => {
  "use strict";

  const STORAGE_KEY = "financeQuestData_v1";
  const THEME_KEY = "financeQuestTheme";

  const expenseCategories = [
    "Moradia", "Alimentação", "Transporte", "Assinaturas", "Lazer",
    "Saúde", "Compras", "Trabalho", "Educação", "Outros"
  ];
  const incomeCategories = ["Freelance", "Reembolso", "Venda", "Presente", "Outras receitas"];

  const categoryColors = ["#5f47ff", "#168c5b", "#d13c55", "#c27a0a", "#2675d8", "#8d57c8", "#33a6a6", "#d0652a", "#718096", "#d34fb8"];

  const defaultState = {
    version: 1,
    plans: {},
    transactions: [],
    investments: []
  };

  let state = loadState();
  let selectedMonth = currentMonthKey();
  let toastTimer = null;
  let dashboardView = "table";
  let dashboardFilter = "fixed";
  let valuesHidden = false;

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
      return {
        ...structuredClone(defaultState),
        ...parsed,
        plans: parsed.plans || {},
        transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
        investments: Array.isArray(parsed.investments) ? parsed.investments : []
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
      ...(state.plans[monthKey] || {})
    };
  }

  function monthTransactions(monthKey = selectedMonth) {
    return state.transactions.filter((item) => monthFromDate(item.date) === monthKey);
  }

  function monthInvestments(monthKey = selectedMonth) {
    return state.investments.filter((item) => monthFromDate(item.date) === monthKey);
  }

  function getMonthStats(monthKey = selectedMonth) {
    const plan = getPlan(monthKey);
    const transactions = monthTransactions(monthKey);
    const investments = monthInvestments(monthKey);
    const paid = transactions.filter((item) => item.status === "paid");
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
    const contributed = state.investments.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const current = state.investments.reduce((sum, item) => sum + Number(item.currentValue ?? item.amount ?? 0), 0);
    return { contributed, current, result: current - contributed };
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
      income: "Receitas extras",
      fixed: "Despesas fixas",
      variable: "Variáveis e recorrentes"
    };
    const rows = stats.transactions
      .filter((item) => {
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

  function togglePrivacyValues() {
    valuesHidden = !valuesHidden;
    document.body.classList.toggle("hide-values", valuesHidden);
    const button = $("#privacyToggle");
    button.textContent = valuesHidden ? "◌" : "◉";
    button.setAttribute("aria-label", valuesHidden ? "Exibir valores" : "Ocultar valores");
    button.title = valuesHidden ? "Exibir valores" : "Ocultar valores";
  }

  function renderAll() {
    renderMonthNavigation();
    renderDashboard();
    renderTransactions();
    renderInvestments();
    renderGoals();
  }

  function renderDashboard() {
    const stats = getMonthStats();
    const investments = getInvestmentTotals();
    const liquidity = Math.max(0, stats.balance);
    const trackedPatrimony = investments.current + liquidity;
    const expenseRatio = stats.income > 0 ? (stats.totalExpenses / stats.income) * 100 : 0;

    $("#patrimonyMetric").textContent = formatCurrency(trackedPatrimony);
    $("#patrimonyInvestmentMetric").textContent = formatCurrency(investments.current);
    $("#patrimonyLiquidityMetric").textContent = formatCurrency(liquidity);

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
    $("#movementInvestMetric").textContent = formatCurrency(stats.invested);
    $("#movementExpenseMetric").textContent = formatCurrency(stats.totalExpenses);
    $("#movementBalanceMetric").textContent = formatCurrency(stats.balance);
    $("#movementBalanceMetric").className = `money-value ${stats.balance >= 0 ? "amount-positive" : "amount-negative"}`;

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
  }

  function classLabel(value) {
    return ({ fixed: "Fixa", variable: "Variável", recurring: "Recorrente" })[value] || "—";
  }

  function renderInvestments() {
    const rows = [...state.investments].sort((a, b) => b.date.localeCompare(a.date));
    const monthRows = monthInvestments();
    const monthTotal = monthRows.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const totals = getInvestmentTotals();
    const liquidity = Math.max(0, getMonthStats().balance);

    $("#investmentMonthTotal").textContent = formatCurrency(monthTotal);
    $("#investmentContributedTotal").textContent = formatCurrency(totals.contributed);
    $("#investmentCurrentTotal").textContent = formatCurrency(totals.current);
    $("#portfolioHeroMetric").textContent = formatCurrency(totals.current);
    $("#portfolioLiquidityMetric").textContent = formatCurrency(liquidity);
    $("#investmentResultTotal").textContent = formatCurrency(totals.result);
    $("#investmentResultTotal").className = `money-value ${totals.result >= 0 ? "amount-positive" : "amount-negative"}`;

    const body = $("#investmentsTableBody");
    $("#investmentsEmpty").classList.toggle("hidden", rows.length > 0);
    body.innerHTML = rows.map((item) => {
      const current = Number(item.currentValue ?? item.amount ?? 0);
      const itemResult = current - Number(item.amount || 0);
      return `
        <tr>
          <td>${formatDate(item.date)}</td>
          <td><strong>${escapeHtml(item.name)}</strong></td>
          <td>${escapeHtml(item.type)}</td>
          <td>${escapeHtml(item.institution || "—")}</td>
          <td class="align-right money-value">${formatCurrency(item.amount)}</td>
          <td class="align-right money-value">${formatCurrency(current)}</td>
          <td class="align-right money-value ${itemResult >= 0 ? "amount-positive" : "amount-negative"}">${formatCurrency(itemResult)}</td>
          <td>
            <div class="row-actions">
              <button class="row-action" data-edit-investment="${item.id}" type="button">Editar</button>
              <button class="row-action" data-delete-investment="${item.id}" type="button">Excluir</button>
            </div>
          </td>
        </tr>
      `;
    }).join("");
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
      $("#investmentAmount").value = item.amount;
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
    $("#expenseClassField").classList.toggle("hidden", !isExpense);
    populateCategories(isExpense ? "expense" : "income");
  }

  function handleTransactionSubmit(event) {
    event.preventDefault();
    const id = $("#transactionId").value || generateId("tx");
    const type = $("#transactionType").value;
    const item = {
      id,
      type,
      date: $("#transactionDate").value,
      description: $("#transactionDescription").value.trim(),
      amount: Number($("#transactionAmount").value),
      category: $("#transactionCategory").value,
      expenseClass: type === "expense" ? $("#transactionExpenseClass").value : null,
      status: $("#transactionStatus").value,
      paymentMethod: $("#transactionPaymentMethod").value,
      notes: $("#transactionNotes").value.trim()
    };

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
      amount,
      currentValue: currentInput === "" ? amount : Number(currentInput),
      notes: $("#investmentNotes").value.trim()
    };

    const existingIndex = state.investments.findIndex((entry) => entry.id === id);
    if (existingIndex >= 0) state.investments[existingIndex] = item;
    else state.investments.push(item);

    saveState();
    elements.investmentModal.close();
    selectedMonth = monthFromDate(item.date);
    elements.monthSelector.value = selectedMonth;
    renderAll();
    showToast(existingIndex >= 0 ? "Investimento atualizado." : "Investimento adicionado.");
  }

  function handlePlanSubmit(event) {
    event.preventDefault();
    state.plans[selectedMonth] = {
      salary: Number($("#planSalary").value || 0),
      budget: Number($("#planBudget").value || 0),
      investmentGoal: Number($("#planInvestmentGoal").value || 0)
    };
    saveState();
    elements.planModal.close();
    renderAll();
    showToast("Planejamento do mês salvo.");
  }

  function deleteTransaction(id) {
    if (!confirm("Excluir esta movimentação?")) return;
    state.transactions = state.transactions.filter((item) => item.id !== id);
    saveState();
    renderAll();
    showToast("Movimentação excluída.");
  }

  function deleteInvestment(id) {
    if (!confirm("Excluir este investimento?")) return;
    state.investments = state.investments.filter((item) => item.id !== id);
    saveState();
    renderAll();
    showToast("Investimento excluído.");
  }

  function navigate(section) {
    const titles = {
      dashboard: "Visão geral",
      movements: "Orçamento",
      investments: "Patrimônio",
      goals: "Metas e conquistas",
      settings: "Dados e privacidade"
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
    link.download = `finance-quest-backup-${todayISO()}.json`;
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
        state = {
          ...structuredClone(defaultState),
          ...parsed,
          plans: parsed.plans || {},
          transactions: parsed.transactions,
          investments: parsed.investments
        };
        saveState();
        renderAll();
        showToast("Backup importado com sucesso.");
      } catch (error) {
        console.error(error);
        alert("Não foi possível importar este arquivo. Verifique se ele é um backup válido do Finance Quest.");
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
    requestAnimationFrame(() => {
      renderHistoryChart();
      renderCategoryChart(getMonthStats());
    });
  }

  function bindEvents() {
    elements.monthSelector.addEventListener("change", () => {
      selectedMonth = elements.monthSelector.value || currentMonthKey();
      renderAll();
    });
    $("#previousMonth").addEventListener("click", () => shiftMonth(-1));
    $("#nextMonth").addEventListener("click", () => shiftMonth(1));
    $("#privacyToggle").addEventListener("click", togglePrivacyValues);

    $$(".nav-item").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.section)));
    $$('[data-section-link]').forEach((button) => button.addEventListener("click", () => navigate(button.dataset.sectionLink)));
    $$('[data-dashboard-view-button]').forEach((button) => button.addEventListener("click", () => setDashboardView(button.dataset.dashboardViewButton)));
    $$('[data-dashboard-filter]').forEach((button) => button.addEventListener("click", () => setDashboardFilter(button.dataset.dashboardFilter)));

    $("#openTransactionModal").addEventListener("click", () => openTransactionModal());
    $("#openTransactionModalSecondary").addEventListener("click", () => openTransactionModal());
    $("#openTransactionModalDashboard").addEventListener("click", () => openTransactionModal());
    $("#openInvestmentModal").addEventListener("click", () => openInvestmentModal());
    $("#openPlanModal").addEventListener("click", openPlanModal);
    $("#openPlanModalSecondary").addEventListener("click", openPlanModal);
    $("#openPlanModalMovement").addEventListener("click", openPlanModal);

    $$(".close-modal").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
    $("#transactionType").addEventListener("change", toggleExpenseFields);
    elements.transactionForm.addEventListener("submit", handleTransactionSubmit);
    elements.investmentForm.addEventListener("submit", handleInvestmentSubmit);
    elements.planForm.addEventListener("submit", handlePlanSubmit);

    $("#transactionSearch").addEventListener("input", renderTransactions);
    $("#transactionTypeFilter").addEventListener("change", renderTransactions);
    $("#transactionStatusFilter").addEventListener("change", renderTransactions);

    const handleTransactionTableAction = (event) => {
      const edit = event.target.closest("[data-edit-transaction]");
      const remove = event.target.closest("[data-delete-transaction]");
      if (edit) openTransactionModal(edit.dataset.editTransaction);
      if (remove) deleteTransaction(remove.dataset.deleteTransaction);
    };
    $("#transactionsTableBody").addEventListener("click", handleTransactionTableAction);
    $("#dashboardTransactionRows").addEventListener("click", handleTransactionTableAction);

    $("#investmentsTableBody").addEventListener("click", (event) => {
      const edit = event.target.closest("[data-edit-investment]");
      const remove = event.target.closest("[data-delete-investment]");
      if (edit) openInvestmentModal(edit.dataset.editInvestment);
      if (remove) deleteInvestment(remove.dataset.deleteInvestment);
    });

    $("#exportData").addEventListener("click", exportData);
    $("#importData").addEventListener("change", (event) => {
      const [file] = event.target.files;
      if (file) importData(file);
      event.target.value = "";
    });
    $("#clearData").addEventListener("click", clearData);
    $("#themeToggle").addEventListener("click", () => applyTheme(document.body.classList.contains("dark") ? "light" : "dark"));

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

  function init() {
    elements.monthSelector.value = selectedMonth;
    $("#transactionDate").value = todayISO();
    $("#investmentDate").value = todayISO();
    applyTheme(localStorage.getItem(THEME_KEY) || "light");
    bindEvents();
    setDashboardView(dashboardView);
    setDashboardFilter(dashboardFilter);
    renderAll();
  }

  init();
})();
