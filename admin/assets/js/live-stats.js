async function vocalisLiveStats() {
  const headers = {};
  try {
    const k = localStorage.getItem('vocalisAdminKey');
    if (k) headers.Authorization = 'Bearer ' + k;
  } catch (e) {}
  const res = await fetch('/v1/admin/stats', { headers });
  if (!res.ok) throw new Error('stats ' + res.status);
  return res.json();
}

function vocalisApplyNavCounts(s) {
  document.querySelectorAll('#sideBadgeClients, .nav-item .badge, a[href="clients.html"] .nav-badge').forEach((el) => {
    if (el.classList.contains('warning')) return;
    el.textContent = String(s.clients);
  });
  document.querySelectorAll('#sideBadgeTrials, a[href="trials.html"] .nav-badge').forEach((el) => {
    el.textContent = String(s.trials);
  });
}
