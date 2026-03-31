// ─── Data Layer ─────────────────────────────────────────────────────────────

const STORAGE_KEY = 'servicetrack_employees';
const DISMISSED_KEY = 'servicetrack_dismissed';

function loadEmployees() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
}

function saveEmployees(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function loadDismissed() {
  try { return JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]'); } catch { return []; }
}

function saveDismissed(data) {
  localStorage.setItem(DISMISSED_KEY, JSON.stringify(data));
}

let employees = loadEmployees();
let dismissed = loadDismissed();

// ─── Calculations ────────────────────────────────────────────────────────────

function yearsWorked(startDate) {
  const diff = Date.now() - new Date(startDate).getTime();
  return diff / (1000 * 60 * 60 * 24 * 365.25);
}

/**
 * Notification rules:
 * - First alert at exactly 10 years
 * - After 10 years, every 5 years (15, 20, 25, ...)
 */
function nextMilestone(years) {
  if (years < 10) return { milestone: 10, label: '10-year Loyalty Award' };
  const intervals = Math.floor((years - 10) / 5);
  const next = 10 + (intervals + 1) * 5;
  const isAward = next % 10 === 0;
  return { milestone: next, label: isAward ? `${next}-year Loyalty Award` : `${next}-year milestone` };
}

function daysUntilMilestone(startDate, milestoneYears) {
  const target = new Date(new Date(startDate).getTime() + milestoneYears * 365.25 * 24 * 60 * 60 * 1000);
  return Math.ceil((target - Date.now()) / (1000 * 60 * 60 * 24));
}

function milestoneDate(startDate, milestoneYears) {
  return new Date(new Date(startDate).getTime() + milestoneYears * 365.25 * 24 * 60 * 60 * 1000);
}

function getPastMilestones(years) {
  const milestones = [];
  if (years >= 10) {
    milestones.push(10);
    let m = 15;
    while (m <= Math.floor(years)) { milestones.push(m); m += 5; }
  }
  return milestones;
}

function progressToNext(years) {
  if (years < 10) return (years / 10) * 100;
  const above = years - 10;
  return ((above % 5) / 5) * 100;
}

// ─── Notifications ───────────────────────────────────────────────────────────

function getNotifications() {
  const notifs = [];
  employees.forEach(emp => {
    const years = yearsWorked(emp.startDate);

    // Past milestones (reached but not yet dismissed)
    getPastMilestones(years).forEach(m => {
      const key = `${emp.id}_milestone_${m}`;
      notifs.push({ type: 'milestone', emp, milestone: m, key, dismissed: dismissed.includes(key) });
    });

    // Upcoming within 90 days
    const next = nextMilestone(years);
    const days = daysUntilMilestone(emp.startDate, next.milestone);
    if (days > 0 && days <= 90) {
      const key = `${emp.id}_upcoming_${next.milestone}`;
      notifs.push({ type: 'upcoming', emp, milestone: next.milestone, daysLeft: days, key, dismissed: dismissed.includes(key) });
    }
  });
  return notifs;
}

function activeNotifCount() {
  return getNotifications().filter(n => !n.dismissed).length;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(d) {
  return new Date(d).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

function initials(name) {
  return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

function formatCurrency(amount) {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(amount);
}

function promotionBadge(count) {
  if (!count || count === 0) return '<span class="badge badge-gray" style="font-weight:500">No promotion</span>';
  let suffix = 'th';
  if (count === 1) suffix = 'st';
  else if (count === 2) suffix = 'nd';
  else if (count === 3) suffix = 'rd';
  return `<span class="badge badge-blue">${count}${suffix} promotion</span>`;
}

function statusBadge(years) {
  if (years < 1) return '<span class="badge badge-gray">New Hire</span>';
  if (years < 5) return '<span class="badge badge-blue">Active</span>';
  if (years < 10) return '<span class="badge badge-teal">Senior</span>';
  return '<span class="badge badge-amber">Veteran</span>';
}

// ─── Render ──────────────────────────────────────────────────────────────────

function renderMetrics() {
  const total = employees.length;
  const veterans = employees.filter(e => yearsWorked(e.startDate) >= 10).length;
  const milestoneAlerts = getNotifications().filter(n => n.type === 'milestone' && !n.dismissed).length;
  const upcomingAlerts = getNotifications().filter(n => n.type === 'upcoming' && !n.dismissed).length;

  document.getElementById('metricsGrid').innerHTML = `
    <div class="metric-card"><div class="metric-label">Total Employees</div><div class="metric-value blue">${total}</div></div>
    <div class="metric-card"><div class="metric-label">Veterans (10+ yrs)</div><div class="metric-value teal">${veterans}</div></div>
    <div class="metric-card"><div class="metric-label">Milestone Alerts</div><div class="metric-value amber">${milestoneAlerts}</div></div>
    <div class="metric-card"><div class="metric-label">Upcoming (90 days)</div><div class="metric-value red">${upcomingAlerts}</div></div>
  `;
}

function renderUpcoming() {
  const upcoming = getNotifications().filter(n => n.type === 'upcoming' && !n.dismissed);
  const el = document.getElementById('upcomingList');
  if (upcoming.length === 0) {
    el.innerHTML = '<div class="upcoming-empty">No milestones coming up in the next 90 days.</div>';
    return;
  }
  el.innerHTML = upcoming.map(n => `
    <div class="upcoming-item">
      <div class="upcoming-avatar">${initials(n.emp.name)}</div>
      <div class="upcoming-info">
        <div class="upcoming-name">${n.emp.name}</div>
        <div class="upcoming-meta">${n.emp.department || '—'} · ${n.milestone}-year ${n.milestone % 10 === 0 ? 'Loyalty Award' : 'milestone'} on ${formatDate(milestoneDate(n.emp.startDate, n.milestone))}</div>
      </div>
      <div class="upcoming-days">in ${n.daysLeft} days</div>
    </div>
  `).join('');
}

function renderTable() {
  const tbody = document.getElementById('empTableBody');
  if (employees.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="table-empty">No employees added yet. Click "Add Employee" to get started.</div></td></tr>`;
    return;
  }
  tbody.innerHTML = employees.map(emp => {
    const years = yearsWorked(emp.startDate);
    const pct = Math.min(100, Math.round(progressToNext(years)));
    const next = nextMilestone(years);
    const daysLeft = daysUntilMilestone(emp.startDate, next.milestone);
    return `
      <tr>
        <td style="font-weight:600;color:var(--text-hint);font-size:12px;">${emp.employeeId || '—'}</td>
        <td style="font-weight:500;">${emp.name}</td>
        <td style="color:var(--text-muted);">${emp.department || '—'}</td>
        <td style="color:var(--text-muted);">${formatDate(emp.startDate)}</td>
        <td style="font-weight:600;">${formatCurrency(emp.currentSalary || 0)}</td>
        <td>${promotionBadge(emp.promotionCount || 0)}</td>
        <td>
          <div class="progress-wrap">
            <span style="font-weight:600;min-width:32px;">${years.toFixed(1)}</span>
            <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
          </div>
        </td>
        <td style="font-size:13px;">
          ${next.label}<br>
          <span style="color:var(--text-hint);font-size:11px;">${daysLeft > 0 ? `in ${daysLeft} days` : 'Due now!'}</span>
        </td>
        <td>${statusBadge(years)}</td>
        <td>
           <div style="display:flex;gap:4px;">
              <button class="btn-icon blue" onclick="openEditModal('${emp.id}')">Edit</button>
              <button class="btn-icon teal" onclick="handlePromote('${emp.id}')">Promote</button>
              <button class="btn-icon amber" onclick="handleDemote('${emp.id}')" ${(emp.promotionCount || 0) === 0 ? 'disabled' : ''}>Demote</button>
              <button class="btn-icon" onclick="removeEmployee('${emp.id}')">Remove</button>
           </div>
        </td>
      </tr>
    `;
  }).join('');
}

function renderNotifications() {
  const notifs = getNotifications();
  const active = notifs.filter(n => !n.dismissed);
  const el = document.getElementById('notifContainer');

  if (active.length === 0) {
    el.innerHTML = `<div class="notif-empty">
      No active notifications. Milestone alerts appear when an employee reaches 10 years, then every 5 years after.
    </div>`;
    return;
  }

  el.innerHTML = `<div class="notif-list">${active.map(n => {
    if (n.type === 'milestone') {
      return `
        <div class="notif-card milestone">
          <div class="notif-icon milestone">&#9733;</div>
          <div class="notif-body">
            <div class="notif-title">${n.emp.name} has reached ${n.milestone} years of service! ${n.milestone % 10 === 0 ? '(Loyalty Award)' : ''}</div>
            <div class="notif-sub">
              ${n.emp.department || 'No department'} · Started ${formatDate(n.emp.startDate)} · Admin recognition recommended
            </div>
            <button class="notif-dismiss" onclick="dismissNotif('${n.key}')">Dismiss</button>
          </div>
        </div>
      `;
    } else {
      return `
        <div class="notif-card upcoming">
          <div class="notif-icon upcoming">&#8987;</div>
          <div class="notif-body">
            <div class="notif-title">${n.emp.name} — ${n.milestone}-year ${n.milestone % 10 === 0 ? 'Loyalty Award' : 'milestone'} in ${n.daysLeft} days</div>
            <div class="notif-sub">
              ${n.emp.department || 'No department'} · Milestone date: ${formatDate(milestoneDate(n.emp.startDate, n.milestone))}
            </div>
            <button class="notif-dismiss" onclick="dismissNotif('${n.key}')">Dismiss</button>
          </div>
        </div>
      `;
    }
  }).join('')}</div>`;
}

function renderSidebarBadge() {
  const count = activeNotifCount();
  const badge = document.getElementById('sidebarBadge');
  badge.textContent = count > 0 ? count : '';
  badge.style.display = count > 0 ? '' : 'none';
}

function renderAll() {
  renderMetrics();
  renderUpcoming();
  renderTable();
  renderNotifications();
  renderSidebarBadge();
}

// ─── Actions ─────────────────────────────────────────────────────────────────

function addEmployee() {
  const empIdText = document.getElementById('inputId').value.trim();
  const name = document.getElementById('inputName').value.trim();
  const dept = document.getElementById('inputDept').value.trim();
  const date = document.getElementById('inputDate').value;
  const salaryInput = document.getElementById('inputSalary').value;

  if (!name || !date || !salaryInput) { alert('Please provide a name, start date, and starting salary.'); return; }

  const currentSalary = parseFloat(salaryInput) || 0;

  employees.push({ id: Date.now().toString(), employeeId: empIdText || '—', name, department: dept, startDate: date, currentSalary, promotionCount: 0 });
  saveEmployees(employees);
  closeModal();
  renderAll();
}

let currentRemoveEmpId = null;

function removeEmployee(id) {
  currentRemoveEmpId = id;
  const emp = employees.find(e => e.id === id);
  if (emp) {
    document.getElementById('removeEmpName').textContent = emp.name;
  }
  document.getElementById('removeModal').style.display = 'flex';
}

function closeRemoveModal() {
  document.getElementById('removeModal').style.display = 'none';
  currentRemoveEmpId = null;
}

function closeRemoveModalOutside(e) {
  if (e.target.id === 'removeModal') closeRemoveModal();
}

function confirmRemoveEmployee() {
  if (!currentRemoveEmpId) return;
  employees = employees.filter(e => e.id !== currentRemoveEmpId);
  dismissed = dismissed.filter(k => !k.startsWith(currentRemoveEmpId));
  saveEmployees(employees);
  saveDismissed(dismissed);
  closeRemoveModal();
  renderAll();
}

function dismissNotif(key) {
  if (!dismissed.includes(key)) dismissed.push(key);
  saveDismissed(dismissed);
  renderAll();
}

function clearAllDismissed() {
  dismissed = [];
  saveDismissed(dismissed);
  renderAll();
}

// ─── View Switching ───────────────────────────────────────────────────────────

function switchView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`view-${name}`).classList.add('active');
  event.currentTarget.classList.add('active');
}

// ─── Modal ───────────────────────────────────────────────────────────────────

function openModal() {
  document.getElementById('modal').style.display = 'flex';
  document.getElementById('inputId').focus();
}

function closeModal() {
  document.getElementById('modal').style.display = 'none';
  document.getElementById('inputId').value = '';
  document.getElementById('inputName').value = '';
  document.getElementById('inputDept').value = '';
  document.getElementById('inputDate').value = '';
  document.getElementById('inputSalary').value = '';

  const csvInput = document.getElementById('csvFileInput');
  if (csvInput) csvInput.value = '';

  if (typeof switchAddMode === 'function') {
    switchAddMode('manual');
  }
}

function closeModalOutside(e) {
  if (e.target.id === 'modal') closeModal();
}

// ─── Promotion & Demotion Engine ───

function handlePromote(id) {
  const emp = employees.find(e => e.id === id);
  if (!emp) return;
  if (!emp.salaryHistory) emp.salaryHistory = [emp.currentSalary];

  let nextCount = (emp.promotionCount || 0) + 1;
  // If we are reaching the 3rd, 6th, 9th promotion... pop up the new salary form.
  if (nextCount > 0 && nextCount % 3 === 0) {
    openPromoteModal(id);
  } else {
    // Silent promote
    emp.promotionCount = nextCount;
    saveEmployees(employees);
    renderAll();
  }
}

function handleDemote(id) {
  const emp = employees.find(e => e.id === id);
  if (!emp) return;
  if (!emp.salaryHistory) emp.salaryHistory = [emp.currentSalary];

  let currentCount = emp.promotionCount || 0;
  if (currentCount <= 0) {
    alert('This employee has 0 promotions and cannot be demoted further.');
    return;
  }

  // Reverting logic: Did they just drop below a multiple of 3? (e.g. 3->2, 6->5)
  if (currentCount > 0 && currentCount % 3 === 0) {
    if (emp.salaryHistory.length > 1) {
      emp.salaryHistory.pop(); // Remove the latest salary bump
      emp.currentSalary = emp.salaryHistory[emp.salaryHistory.length - 1]; // Revert 
    }
  }

  emp.promotionCount = currentCount - 1;
  saveEmployees(employees);
  renderAll();
}

let currentPromoteEmpId = null;

function openPromoteModal(id) {
  currentPromoteEmpId = id;
  const emp = employees.find(e => e.id === id);
  if (emp && emp.currentSalary) {
    document.getElementById('inputNewSalary').value = emp.currentSalary;
    const hint = document.getElementById('promoteHint');
    if (hint) {
      hint.style.color = 'var(--amber)';
      hint.textContent = `* Must be higher than ₱${emp.currentSalary.toLocaleString()}`;
    }
  } else {
    document.getElementById('inputNewSalary').value = '';
    document.getElementById('promoteHint').textContent = '';
  }
  document.getElementById('promoteModal').style.display = 'flex';
  document.getElementById('inputNewSalary').focus();
}

function closePromoteModal() {
  document.getElementById('promoteModal').style.display = 'none';
  document.getElementById('inputNewSalary').value = '';
  document.getElementById('promoteHint').textContent = '';
  currentPromoteEmpId = null;
}

function closePromoteModalOutside(e) {
  if (e.target.id === 'promoteModal') closePromoteModal();
}

function submitPromotion() {
  if (!currentPromoteEmpId) return;
  const newSalary = parseFloat(document.getElementById('inputNewSalary').value);
  if (isNaN(newSalary) || newSalary <= 0) {
    alert('Please enter a valid salary amount.');
    return;
  }

  const empIndex = employees.findIndex(e => e.id === currentPromoteEmpId);
  if (empIndex > -1) {
    const emp = employees[empIndex];

    if (newSalary <= (emp.currentSalary || 0)) {
      const hint = document.getElementById('promoteHint');
      if (hint) {
        hint.style.color = 'var(--red)';
        hint.textContent = 'Invalid Salary: Amount must be higher than current salary.';
      } else {
        alert('Invalid Salary');
      }
      return;
    }

    if (!emp.salaryHistory) emp.salaryHistory = [emp.currentSalary];

    emp.currentSalary = newSalary;
    emp.salaryHistory.push(newSalary);
    emp.promotionCount = (emp.promotionCount || 0) + 1;

    saveEmployees(employees);
    renderAll();
  }
  closePromoteModal();
}

let currentEditEmpId = null;

function openEditModal(id) {
  currentEditEmpId = id;
  const emp = employees.find(e => e.id === id);
  if (!emp) return;
  document.getElementById('editId').value = emp.employeeId || '';
  document.getElementById('editName').value = emp.name || '';
  document.getElementById('editDept').value = emp.department || '';
  document.getElementById('editDate').value = emp.startDate || '';
  document.getElementById('editSalary').value = emp.currentSalary || '';
  document.getElementById('editModal').style.display = 'flex';
}

function closeEditModal() {
  document.getElementById('editModal').style.display = 'none';
  currentEditEmpId = null;
}

function closeEditModalOutside(e) {
  if (e.target.id === 'editModal') closeEditModal();
}

function submitEditEmployee() {
  if (!currentEditEmpId) return;
  const empIndex = employees.findIndex(e => e.id === currentEditEmpId);
  if (empIndex === -1) return;

  const empIdText = document.getElementById('editId').value.trim();
  const name = document.getElementById('editName').value.trim();
  const dept = document.getElementById('editDept').value.trim();
  const date = document.getElementById('editDate').value;
  const salaryInput = document.getElementById('editSalary').value;

  if (!name || !date || !salaryInput) {
    alert('Please provide a name, start date, and starting salary.');
    return;
  }

  const emp = employees[empIndex];
  if (!emp.salaryHistory) emp.salaryHistory = [emp.currentSalary];

  emp.employeeId = empIdText || '—';
  emp.name = name;
  emp.department = dept;
  emp.startDate = date;

  const newSalary = parseFloat(salaryInput) || 0;
  emp.currentSalary = newSalary;
  // Overwrite the last history entry so they don't break rollback tracking if edited manually
  emp.salaryHistory[emp.salaryHistory.length - 1] = newSalary;

  saveEmployees(employees);
  closeEditModal();
  renderAll();
}

// ─── Modal Tabs & CSV Import ────────────────────────────────────────────────

function switchAddMode(mode) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('formManual').style.display = 'none';
  document.getElementById('formCsv').style.display = 'none';
  document.getElementById('footerManual').style.display = 'none';

  if (mode === 'manual') {
    document.getElementById('tabManual').classList.add('active');
    document.getElementById('formManual').style.display = 'flex';
    document.getElementById('footerManual').style.display = 'flex';
  } else {
    document.getElementById('tabCsv').classList.add('active');
    document.getElementById('formCsv').style.display = 'flex';
  }
}

function parseCSVLine(text) {
  let ret = [''], i = 0, p = '', s = true;
  for (let l = text; i < l.length; i++) {
    let c = l[i];
    if (c === '"') {
      if (s && c === '"') s = !s;
      else if (l[i + 1] && l[i + 1] === '"') { ret[ret.length - 1] += '"'; i++; }
      else s = !s;
    } else if (c === ',' && s) ret.push('');
    else ret[ret.length - 1] += c;
    p = c;
  }
  return ret;
}

function handleCsvUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function (e) {
    const text = e.target.result;
    const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
    if (lines.length < 2) {
      alert("The CSV file seems to be empty or missing data.");
      return;
    }

    const headers = parseCSVLine(lines[0]).map(h => h.trim().toLowerCase());
    const idIdx = headers.indexOf('id');
    const nameIdx = headers.indexOf('name');
    const deptIdx = headers.indexOf('department');
    const dateIdx = headers.indexOf('start date');
    const salaryIdx = headers.indexOf('salary');

    if (nameIdx === -1 || dateIdx === -1 || salaryIdx === -1) {
      alert("CSV must contain exactly these headers: ID, Name, Department, Start Date, Salary. (Check your spelling)");
      return;
    }

    let importedCount = 0;
    for (let i = 1; i < lines.length; i++) {
      const row = parseCSVLine(lines[i]);
      // Skip empty or malformed rows that don't at least attempt to map to headers
      if (row.length === 0 || (row.length === 1 && row[0] === '')) continue;

      const csvId = idIdx > -1 ? (row[idIdx] || '').trim() : '';
      const name = nameIdx > -1 ? (row[nameIdx] || '').trim() : '';
      const dept = deptIdx > -1 ? (row[deptIdx] || '').trim() : '';
      const rawDate = dateIdx > -1 ? (row[dateIdx] || '').trim() : '';
      const rawSalary = salaryIdx > -1 ? (row[salaryIdx] || '').trim().replace(/[^0-9.-]+/g, "") : '';

      if (!name || !rawDate) continue; // Name and Date are highly necessary

      // Date normalization to YYYY-MM-DD format commonly expected by input type="date"
      let formattedDate = rawDate;
      const parsedDate = new Date(rawDate);
      if (!isNaN(parsedDate.getTime())) {
        formattedDate = parsedDate.toISOString().split('T')[0];
      }

      const currentSalary = parseFloat(rawSalary) || 0;

      employees.push({
        id: Date.now().toString() + i, // Force unique ID per batch line
        employeeId: csvId || '—',
        name,
        department: dept,
        startDate: formattedDate,
        currentSalary,
        promotionCount: 0
      });
      importedCount++;
    }

    if (importedCount > 0) {
      saveEmployees(employees);
      renderAll();
      alert(`Success! Imported ${importedCount} employees.`);
      closeModal();
    } else {
      alert("No valid employee records found to import.");
    }
  };

  reader.readAsText(file);
  event.target.value = ''; // Reset input to allow re-uploading the exact same file
}

// ─── Theme Toggle ────────────────────────────────────────────────────────────

function initTheme() {
  const savedTheme = localStorage.getItem('servicetrack_theme') || 'light';
  document.documentElement.setAttribute('data-theme', savedTheme);
  updateThemeIcon(savedTheme);
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
  const newTheme = currentTheme === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', newTheme);
  localStorage.setItem('servicetrack_theme', newTheme);
  updateThemeIcon(newTheme);
}

function updateThemeIcon(theme) {
  const icon = document.getElementById('themeIcon');
  const label = document.getElementById('themeLabel');
  if (icon && label) {
    icon.innerHTML = theme === 'dark' ? '&#9728;' : '&#9789;'; // Sun / Moon
    label.textContent = theme === 'dark' ? 'Light Mode' : 'Dark Mode';
  }
}

// ─── Init ────────────────────────────────────────────────────────────────────

initTheme();
renderAll();
