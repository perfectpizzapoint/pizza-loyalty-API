// ============================================================
// Perfect Pizza Point - Frontend Logic
// ============================================================

// ⚠️ IMPORTANT: Set your deployed Google Apps Script Web App URL here
const API_URL = "https://script.google.com/macros/s/AKfycbzfcThwO6xpJ0FRACtR3toOkl9SToRUnP8kESQ17Y19AQiVmWz6LmHz-WBdn5rUHd3w/exec";

// ===== STATE =====
let appConfig = null;
let currentMobile = "";
let currentCustomerData = null;
let adminCharts = {};

// ===== HELPERS =====
function getISTNow() {
  const now = new Date();
  const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
  return ist;
}

function getISTDate() {
  const ist = getISTNow();
  return ist.getUTCFullYear() + '-' +
    String(ist.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(ist.getUTCDate()).padStart(2, '0');
}

function getISTTime() {
  const ist = getISTNow();
  return String(ist.getUTCHours()).padStart(2, '0') + ':' +
    String(ist.getUTCMinutes()).padStart(2, '0') + ':' +
    String(ist.getUTCSeconds()).padStart(2, '0');
}

function showToast(message, type = "") {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.className = "toast" + (type ? " " + type : "");
  requestAnimationFrame(() => toast.classList.add("show"));
  setTimeout(() => toast.classList.remove("show"), 3000);
}

async function apiCall(action, params = {}) {
  const url = new URL(API_URL);
  url.searchParams.set("action", action);
  for (const key in params) {
    url.searchParams.set(key, params[key]);
  }
  try {
    const resp = await fetch(url.toString());
    const data = await resp.json();
    return data;
  } catch (err) {
    return { success: false, error: "Network error: " + err.message };
  }
}

// ===== LOGIN =====
document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const user = document.getElementById("loginUser").value.trim();
  const pass = document.getElementById("loginPass").value.trim();
  const errEl = document.getElementById("loginError");
  const btn = document.getElementById("loginBtn");

  if (!user || !pass) {
    errEl.textContent = "Please fill in both fields.";
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Logging in...';
  errEl.textContent = "";

  const result = await apiCall("login", { username: user, password: pass });

  if (result.success) {
    sessionStorage.setItem("loggedIn", "true");
    // Also fetch config
    const configResult = await apiCall("getConfig");
    if (configResult.success) {
      appConfig = configResult;
    }
    document.getElementById("loginView").classList.add("hidden");
    document.getElementById("appView").classList.remove("hidden");
    showToast("Welcome back! 🍕", "success");
  } else {
    errEl.textContent = result.error || "Login failed.";
  }

  btn.disabled = false;
  btn.innerHTML = "🔐 Login";
});

// ===== LOGOUT =====
document.getElementById("logoutBtn").addEventListener("click", () => {
  sessionStorage.removeItem("loggedIn");
  document.getElementById("appView").classList.add("hidden");
  document.getElementById("loginView").classList.remove("hidden");
  document.getElementById("loginUser").value = "";
  document.getElementById("loginPass").value = "";
});

// ===== TABS =====
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    const tab = btn.dataset.tab;
    document.getElementById("entrySection").classList.toggle("hidden", tab !== "entry");
    document.getElementById("adminSection").classList.toggle("hidden", tab !== "admin");
    if (tab === "admin") loadAdminData();
  });
});

// ===== ADD ENTRY BUTTON =====
document.getElementById("addEntryBtn").addEventListener("click", async () => {
  const mobile = document.getElementById("mobileInput").value.trim();
  const errEl = document.getElementById("mobileError");
  errEl.textContent = "";

  if (!/^\d{10}$/.test(mobile)) {
    errEl.textContent = "Please enter exactly 10 digits.";
    return;
  }

  const btn = document.getElementById("addEntryBtn");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';

  // Check if mobile can add entry today
  const checkResult = await apiCall("checkMobile", { mobile });

  if (!checkResult.success) {
    errEl.textContent = checkResult.error;
    btn.disabled = false;
    btn.innerHTML = "Add Entry";
    return;
  }

  // Fetch customer data
  const custResult = await apiCall("getCustomerData", { mobile });

  btn.disabled = false;
  btn.innerHTML = "Add Entry";

  if (!custResult.success) {
    errEl.textContent = custResult.error || "Error loading customer data.";
    return;
  }

  currentMobile = mobile;
  currentCustomerData = custResult;
  appConfig = appConfig || {};
  appConfig.cycle = custResult.cycle;
  appConfig.rewardValue = custResult.rewardValue;
  appConfig.minAmount = custResult.minAmount;

  openCustomerModal(custResult);
});

// ===== CUSTOMER MODAL =====
function openCustomerModal(data) {
  const modal = document.getElementById("customerModal");
  modal.classList.remove("hidden");

  document.getElementById("modalMobile").textContent = currentMobile;

  // Build dot visualization
  buildDots(data.totalEntries, data.cycle, data.rewardsClaimed);

  // Rewards emojis
  const rewardsSection = document.getElementById("rewardsSection");
  const rewardsDisplay = document.getElementById("rewardsDisplay");
  if (data.rewardsClaimed > 0) {
    rewardsSection.style.display = "";
    rewardsDisplay.innerHTML = "";
    for (let i = 0; i < data.rewardsClaimed; i++) {
      const span = document.createElement("span");
      span.className = "reward-emoji";
      span.textContent = "🎁";
      span.style.animationDelay = (i * 0.1) + "s";
      rewardsDisplay.appendChild(span);
    }
  } else {
    rewardsSection.style.display = "none";
  }

  // Eligibility
  const banner = document.getElementById("eligibilityBanner");
  const claimSection = document.getElementById("claimSection");
  const entryForm = document.getElementById("entryForm");
  const saveBtn = document.getElementById("saveEntryBtn");

  if (data.eligible) {
    banner.style.display = "";
    banner.className = "eligibility-banner eligible";
    banner.textContent = "🎉 Eligible for FREE meal (up to ₹" + (data.rewardValue || 150) + ")! Claim now!";
    claimSection.style.display = "";
    // On 11th/21st entry force claim: disable save
    saveBtn.disabled = true;
    saveBtn.title = "Must claim reward first";
  } else {
    banner.style.display = "";
    banner.className = "eligibility-banner not-eligible";
    const remaining = data.cycle - (data.totalEntries % data.cycle);
    banner.textContent = remaining + " more visit" + (remaining !== 1 ? "s" : "") + " to earn a free meal!";
    claimSection.style.display = "none";
    saveBtn.disabled = false;
    saveBtn.title = "";
  }

  // Fill date/time
  document.getElementById("dateInput").value = getISTDate();
  document.getElementById("timeInput").value = getISTTime();
  document.getElementById("amountInput").value = "";
  document.getElementById("messageInput").value = "";
  document.getElementById("formError").textContent = "";

  // Reset sections
  document.getElementById("whatsappSection").style.display = "none";
  document.getElementById("entriesList").classList.add("hidden");
  document.getElementById("showDetailsBtn").textContent = "📜 Show Past Entry Details";
  entryForm.style.display = "";

  // Build past entries (hidden by default)
  buildPastEntries(data.entries || []);
}

function buildDots(totalEntries, cycle, rewardsClaimed) {
  const section = document.getElementById("dotsSection");
  // Clear previous content except label
  const label = section.querySelector('.dots-section-label');
  section.innerHTML = '';
  section.appendChild(label);

  // How many complete cycles and current position
  const completedCycles = Math.floor(totalEntries / cycle);
  const currentPos = totalEntries % cycle;

  // Show each cycle row
  const totalRows = completedCycles + (currentPos > 0 || totalEntries === 0 ? 1 : 0);

  for (let row = 0; row < totalRows; row++) {
    const dotRow = document.createElement("div");
    dotRow.className = "dot-row";

    const rowLabel = document.createElement("div");
    rowLabel.className = "dot-row-label";
    const startNum = row * cycle + 1;
    const endNum = (row + 1) * cycle;
    rowLabel.textContent = "Visits " + startNum + "–" + endNum;
    dotRow.appendChild(rowLabel);

    for (let d = 0; d < cycle; d++) {
      const dot = document.createElement("div");
      dot.className = "dot";
      const entryNum = row * cycle + d + 1;
      if (entryNum <= totalEntries) {
        dot.classList.add("filled");
        // If this is the last dot of a completed cycle, mark as reward dot
        if ((entryNum % cycle === 0) && (entryNum / cycle <= rewardsClaimed)) {
          dot.classList.add("reward-dot");
        }
      }
      dotRow.appendChild(dot);
    }
    section.appendChild(dotRow);
  }
}

function buildPastEntries(entries) {
  const list = document.getElementById("entriesList");
  list.innerHTML = "";
  if (entries.length === 0) {
    list.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;padding:12px">No past entries yet. This is a new customer!</p>';
    return;
  }
  // Show in reverse chronological
  const reversed = [...entries].reverse();
  for (const entry of reversed) {
    const item = document.createElement("div");
    item.className = "entry-item";
    item.innerHTML =
      '<span>#</span><span>' + entry.index + '</span>' +
      '<span>Mobile</span><span>' + entry.mobile + '</span>' +
      '<span>Amount</span><span>₹' + entry.amount + '</span>' +
      '<span>Date</span><span>' + entry.date + '</span>' +
      '<span>Time</span><span>' + entry.time + '</span>' +
      '<span>Message</span><span>' + (entry.message || '—') + '</span>';
    list.appendChild(item);
  }
}

// Show/Hide past entries
document.getElementById("showDetailsBtn").addEventListener("click", () => {
  const list = document.getElementById("entriesList");
  const btn = document.getElementById("showDetailsBtn");
  if (list.classList.contains("hidden")) {
    list.classList.remove("hidden");
    btn.textContent = "📜 Hide Past Entry Details";
  } else {
    list.classList.add("hidden");
    btn.textContent = "📜 Show Past Entry Details";
  }
});

// ===== SAVE ENTRY =====
document.getElementById("saveEntryBtn").addEventListener("click", async () => {
  const amount = document.getElementById("amountInput").value.trim();
  const message = document.getElementById("messageInput").value.trim();
  const errEl = document.getElementById("formError");
  errEl.textContent = "";

  const minAmount = (appConfig && appConfig.minAmount) || 100;
  if (!amount || Number(amount) < minAmount) {
    errEl.textContent = "Billing amount must be ₹" + minAmount + " or more.";
    return;
  }

  const btn = document.getElementById("saveEntryBtn");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Saving...';

  const result = await apiCall("addEntry", {
    mobile: currentMobile,
    amount: amount,
    message: message
  });

  if (result.success) {
    showToast("Entry saved! ✅", "success");

    // Update dots
    currentCustomerData.totalEntries = result.totalEntries;
    currentCustomerData.eligible = result.eligible;
    currentCustomerData.rewardsClaimed = result.rewardsClaimed;
    buildDots(result.totalEntries, result.cycle, result.rewardsClaimed);

    // Update eligibility banner
    const banner = document.getElementById("eligibilityBanner");
    const claimSection = document.getElementById("claimSection");
    if (result.eligible) {
      banner.className = "eligibility-banner eligible";
      banner.textContent = "🎉 Eligible for FREE meal (up to ₹" + result.rewardValue + ")! Claim now!";
      claimSection.style.display = "";
    } else {
      banner.className = "eligibility-banner not-eligible";
      const remaining = result.cycle - (result.totalEntries % result.cycle);
      banner.textContent = remaining + " more visit" + (remaining !== 1 ? "s" : "") + " to earn a free meal!";
      claimSection.style.display = "none";
    }

    // Hide entry form, show WhatsApp
    document.getElementById("entryForm").style.display = "none";
    document.getElementById("whatsappSection").style.display = "";
    document.getElementById("whatsappBtn").href = result.whatsappLink;

  } else {
    errEl.textContent = result.error || "Failed to save entry.";
    btn.disabled = false;
    btn.innerHTML = "💾 Save Entry";
  }
});

// ===== CLAIM REWARD =====
document.getElementById("claimRewardBtn").addEventListener("click", async () => {
  const btn = document.getElementById("claimRewardBtn");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Claiming...';

  const result = await apiCall("claimReward", { mobile: currentMobile });

  if (result.success) {
    showToast("Reward claimed! 🎁🎉", "success");

    currentCustomerData.rewardsClaimed = result.rewardsClaimed;
    currentCustomerData.totalEntries = result.totalEntries;
    currentCustomerData.eligible = result.eligible;

    // Update dots and rewards
    buildDots(result.totalEntries, result.cycle, result.rewardsClaimed);

    // Update rewards emojis
    const rewardsSection = document.getElementById("rewardsSection");
    const rewardsDisplay = document.getElementById("rewardsDisplay");
    rewardsSection.style.display = "";
    rewardsDisplay.innerHTML = "";
    for (let i = 0; i < result.rewardsClaimed; i++) {
      const span = document.createElement("span");
      span.className = "reward-emoji";
      span.textContent = "🎁";
      span.style.animationDelay = (i * 0.1) + "s";
      rewardsDisplay.appendChild(span);
    }

    // Re-enable save button since reward is claimed
    const saveBtn = document.getElementById("saveEntryBtn");
    saveBtn.disabled = false;
    saveBtn.title = "";

    // Update eligibility
    const banner = document.getElementById("eligibilityBanner");
    // After claiming, eligible may still be true (since entries didn't change)
    // but the claim was processed. We let the UI reflect the new state.
    if (!result.eligible) {
      banner.className = "eligibility-banner not-eligible";
      const remaining = result.cycle - (result.totalEntries % result.cycle);
      banner.textContent = remaining + " more visit" + (remaining !== 1 ? "s" : "") + " to earn a free meal!";
      document.getElementById("claimSection").style.display = "none";
    }

    btn.innerHTML = "✅ Reward Claimed!";
  } else {
    showToast(result.error || "Failed to claim reward.", "error");
    btn.disabled = false;
    btn.innerHTML = "🎁 Claim Reward";
  }
});

// ===== CLOSE MODAL =====
function closeModal() {
  document.getElementById("customerModal").classList.add("hidden");
  currentMobile = "";
  currentCustomerData = null;
}
document.getElementById("modalCloseBtn").addEventListener("click", closeModal);
document.getElementById("cancelEntryBtn").addEventListener("click", closeModal);
document.getElementById("customerModal").addEventListener("click", (e) => {
  if (e.target === document.getElementById("customerModal")) closeModal();
});

// ===== ADMIN PANEL =====
async function loadAdminData() {
  const loading = document.getElementById("adminLoading");
  loading.classList.remove("hidden");

  const result = await apiCall("getAdminData");
  loading.classList.add("hidden");

  if (!result.success) {
    showToast(result.error || "Failed to load admin data.", "error");
    return;
  }

  renderAdminStats(result);
  renderTopCustomers(result.topCustomers);
  renderRepeatChart(result.repeatCustomers, result.newCustomers);
}

function renderAdminStats(data) {
  const grid = document.getElementById("statsGrid");
  grid.innerHTML = "";

  const todayToggleId = "todayToggle";
  const stats = [
    { icon: "👥", value: data.totalCustomers, label: "Total Customers" },
    { icon: "📝", value: data.totalVisits, label: "Total Visits" },
    { icon: "🎁", value: data.totalRewardsGiven, label: "Rewards Given" },
    { icon: "⏳", value: data.rewardsPending, label: "Rewards Pending" },
    { icon: "📅", value: data.todayEntries, label: "Today's Entries", altValue: "₹" + data.todayAmount, altLabel: "Today's Amount", toggleable: true },
    { icon: "💰", value: "₹" + data.avgBilling, label: "Avg Billing" },
    { icon: "📊", value: data.avgVisitsPerCustomer, label: "Avg Visits/Customer" },
    { icon: "🏆", value: data.rewardConversionRate + "%", label: "Reward Conv. Rate" }
  ];

  stats.forEach((s, i) => {
    const card = document.createElement("div");
    card.className = "stat-card";
    card.id = "stat-card-" + i;

    if (s.toggleable) {
      card.innerHTML =
        '<div class="stat-icon">' + s.icon + '</div>' +
        '<div class="toggle-group" style="margin-bottom:6px">' +
          '<button class="toggle-btn active" data-show="primary">Entries</button>' +
          '<button class="toggle-btn" data-show="alt">Amount</button>' +
        '</div>' +
        '<div class="stat-value" id="todayStatVal">' + s.value + '</div>' +
        '<div class="stat-label" id="todayStatLabel">' + s.label + '</div>';
      card.dataset.primaryVal = s.value;
      card.dataset.primaryLabel = s.label;
      card.dataset.altVal = s.altValue;
      card.dataset.altLabel = s.altLabel;
    } else {
      card.innerHTML =
        '<div class="stat-icon">' + s.icon + '</div>' +
        '<div class="stat-value">' + s.value + '</div>' +
        '<div class="stat-label">' + s.label + '</div>';
    }
    grid.appendChild(card);
  });

  // Today's toggle
  grid.querySelectorAll('.toggle-group .toggle-btn').forEach(btn => {
    btn.addEventListener("click", (e) => {
      const parent = e.target.closest('.stat-card');
      parent.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove("active"));
      e.target.classList.add("active");
      const show = e.target.dataset.show;
      const valEl = parent.querySelector('.stat-value');
      const labelEl = parent.querySelector('.stat-label');
      if (show === "alt") {
        valEl.textContent = parent.dataset.altVal;
        labelEl.textContent = parent.dataset.altLabel;
      } else {
        valEl.textContent = parent.dataset.primaryVal;
        labelEl.textContent = parent.dataset.primaryLabel;
      }
    });
  });
}

function renderTopCustomers(customers) {
  const tbody = document.querySelector("#topCustomersTable tbody");
  tbody.innerHTML = "";
  if (!customers || customers.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" style="color:var(--text-muted);text-align:center">No data</td></tr>';
    return;
  }
  customers.forEach((c, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = '<td>' + (i + 1) + '</td><td>' + c.mobile + '</td><td>' + c.count + '</td>';
    tbody.appendChild(tr);
  });
}

function renderRepeatChart(repeat, newC) {
  const ctx = document.getElementById("repeatChart").getContext("2d");
  if (adminCharts.repeat) adminCharts.repeat.destroy();
  adminCharts.repeat = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["Repeat Customers", "New Customers"],
      datasets: [{
        data: [repeat, newC],
        backgroundColor: ["#ff8c32", "#e84545"],
        borderColor: "transparent",
        borderWidth: 0,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          position: "bottom",
          labels: { color: "#a89e94", font: { family: "Outfit" } }
        }
      }
    }
  });
}

// ===== HEATMAP =====
let heatmapType = "entries";
document.querySelectorAll("#heatmapToggle .toggle-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#heatmapToggle .toggle-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    heatmapType = btn.dataset.type;
  });
});

document.getElementById("calcHeatmapBtn").addEventListener("click", async () => {
  const btn = document.getElementById("calcHeatmapBtn");
  btn.disabled = true;
  btn.textContent = "⏳ Calculating...";

  const result = await apiCall("getHeatmapData", { type: heatmapType });
  btn.disabled = false;
  btn.textContent = "📊 Calculate Heatmap";

  if (!result.success) {
    showToast(result.error || "Heatmap calculation failed.", "error");
    return;
  }
  renderHeatmap(result.heatmap, result.type);
});

function renderHeatmap(data, type) {
  const area = document.getElementById("heatmapArea");
  area.innerHTML = "";

  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  // Find max for color scaling
  let maxVal = 0;
  data.forEach(row => row.forEach(v => { if (v > maxVal) maxVal = v; }));

  // Hour labels
  const hourRow = document.createElement("div");
  hourRow.className = "heatmap-hour-labels";
  hourRow.innerHTML = '<div></div>';
  for (let h = 0; h < 24; h++) {
    const el = document.createElement("div");
    el.className = "heatmap-hour";
    el.textContent = h;
    hourRow.appendChild(el);
  }
  area.appendChild(hourRow);

  const container = document.createElement("div");
  container.className = "heatmap-container";

  const grid = document.createElement("div");
  grid.className = "heatmap-grid";

  for (let d = 0; d < 7; d++) {
    const label = document.createElement("div");
    label.className = "heatmap-label";
    label.textContent = days[d];
    grid.appendChild(label);

    for (let h = 0; h < 24; h++) {
      const cell = document.createElement("div");
      cell.className = "heatmap-cell";
      const val = data[d][h];
      const intensity = maxVal > 0 ? val / maxVal : 0;
      if (val === 0) {
        cell.style.background = "var(--bg-primary)";
      } else {
        const alpha = 0.2 + intensity * 0.8;
        cell.style.background = type === "amount"
          ? `rgba(52, 211, 153, ${alpha})`
          : `rgba(255, 140, 50, ${alpha})`;
      }
      cell.textContent = val > 0 ? (type === "amount" ? "₹" + val : val) : "";
      cell.title = days[d] + " " + h + ":00 — " + (type === "amount" ? "₹" + val : val + " entries");
      grid.appendChild(cell);
    }
  }

  container.appendChild(grid);
  area.appendChild(container);
}

// ===== TIME BETWEEN VISITS =====
document.getElementById("calcVisitsBtn").addEventListener("click", async () => {
  const btn = document.getElementById("calcVisitsBtn");
  btn.disabled = true;
  btn.textContent = "⏳ Calculating...";

  const result = await apiCall("getTimeBetweenVisits");
  btn.disabled = false;
  btn.textContent = "📊 Calculate";

  if (!result.success) {
    showToast(result.error || "Calculation failed.", "error");
    return;
  }
  renderTimeBetween(result);
});

function renderTimeBetween(data) {
  const area = document.getElementById("timeBetweenArea");
  area.innerHTML = "";

  // Stats cards
  const statsDiv = document.createElement("div");
  statsDiv.className = "visit-stats";
  const items = [
    { value: data.avgGap + "d", label: "Average Gap" },
    { value: data.medianGap + "d", label: "Median Gap" },
    { value: data.minGap + "d", label: "Min Gap" },
    { value: data.maxGap + "d", label: "Max Gap" },
    { value: data.totalGaps, label: "Total Gaps" }
  ];
  items.forEach(item => {
    const div = document.createElement("div");
    div.className = "visit-stat";
    div.innerHTML = '<div class="visit-stat-value">' + item.value + '</div>' +
                    '<div class="visit-stat-label">' + item.label + '</div>';
    statsDiv.appendChild(div);
  });
  area.appendChild(statsDiv);

  // Distribution chart
  const chartWrap = document.createElement("div");
  chartWrap.className = "chart-wrap";
  chartWrap.style.marginTop = "20px";
  const canvas = document.createElement("canvas");
  canvas.id = "visitDistChart";
  chartWrap.appendChild(canvas);
  area.appendChild(chartWrap);

  if (adminCharts.visitDist) adminCharts.visitDist.destroy();
  adminCharts.visitDist = new Chart(canvas.getContext("2d"), {
    type: "bar",
    data: {
      labels: Object.keys(data.distribution),
      datasets: [{
        label: "Visit Gaps",
        data: Object.values(data.distribution),
        backgroundColor: "rgba(255, 140, 50, 0.6)",
        borderColor: "#ff8c32",
        borderWidth: 1,
        borderRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      scales: {
        x: { ticks: { color: "#a89e94", font: { family: "Outfit" } }, grid: { color: "rgba(255,140,50,0.05)" } },
        y: { ticks: { color: "#a89e94", font: { family: "Outfit" } }, grid: { color: "rgba(255,140,50,0.05)" }, beginAtZero: true }
      },
      plugins: {
        legend: { display: false }
      }
    }
  });
}

// ===== MOBILE INPUT - only numeric =====
document.getElementById("mobileInput").addEventListener("input", (e) => {
  e.target.value = e.target.value.replace(/\D/g, "").slice(0, 10);
});

// ===== AMOUNT INPUT - only numeric =====
document.getElementById("amountInput").addEventListener("input", (e) => {
  e.target.value = e.target.value.replace(/[^\d]/g, "");
});

// Enter key on mobile input triggers Add Entry
document.getElementById("mobileInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    document.getElementById("addEntryBtn").click();
  }
});
