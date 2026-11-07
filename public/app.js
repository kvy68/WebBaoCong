/* TBT Báo Công – giao diện web (JavaScript thuần, không cần build) */
'use strict';

// ================= Tiện ích =================
const $app = document.getElementById('app');
const state = { me: null, webAdmin: null, sites: [], stats: null };
const isAdminPortalUrl = () => location.pathname.startsWith('/admin') || /^#\/?admin(\b|\/|\?|$)/.test(location.hash);

/** Tạo phần tử DOM an toàn (nội dung chữ luôn được escape). */
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value' || k === 'checked' || k === 'selected' || k === 'disabled') el[k] = v;
    else if (k === 'ref') v(el);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

async function api(path, opts = {}) {
  const init = { method: opts.method || 'GET', headers: {}, credentials: 'same-origin' };
  if (opts.form) init.body = opts.form;
  else if (opts.body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  let res;
  try { res = await fetch('/api' + path, init); }
  catch { throw new Error('Mất kết nối mạng. Kiểm tra internet rồi thử lại.'); }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/login') && !path.startsWith('/setup') && !path.startsWith('/webadmin/login')) {
    if (path.startsWith('/webadmin') || path.startsWith('/admin') || isAdminPortalUrl()) {
      state.webAdmin = null;
      if (isAdminPortalUrl() && !path.startsWith('/webadmin/me')) renderWebAdminAuth();
    } else {
      state.me = null;
      renderAuth();
    }
    throw new Error(data.error || 'Phiên đăng nhập hết hạn');
  }
  if (!res.ok) throw new Error(data.error || `Lỗi ${res.status}`);
  return data;
}

let toastTimer;
function toast(msg, isErr) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'show' + (isErr ? ' err' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.className = ''), 3200);
}
const fail = (e) => toast(e.message || String(e), true);

const fmtMoney = (n) => Math.round(n || 0).toLocaleString('vi-VN') + 'đ';
const fmtNum = (n) => (Math.round((n || 0) * 100) / 100).toLocaleString('vi-VN');
const pad = (n) => String(n).padStart(2, '0');
const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const thisMonth = () => localDate().slice(0, 7);
function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s + 'T12:00:00');
  const wd = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][d.getDay()];
  return `${wd}, ${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
}
function addDays(s, n) { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return localDate(d); }
const TYPE = { full: 'Cả ngày', half: 'Nửa ngày', off: 'Nghỉ' };
const STATUS = { pending: 'Chờ duyệt', approved: 'Đã duyệt', rejected: 'Từ chối' };
const badge = (s) => h('span', { class: 'badge b-' + s }, STATUS[s]);
const mapUrl = (lat, lng) => `https://www.google.com/maps?q=${lat},${lng}`;

/** Ô nhập tiền tự thêm dấu chấm ngăn cách hàng nghìn. */
function moneyInput(attrs = {}) {
  const el = h('input', { inputmode: 'numeric', autocomplete: 'off', placeholder: '0', ...attrs });
  const format = () => {
    const digits = el.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    el.value = digits ? Number(digits).toLocaleString('vi-VN') : '';
  };
  el.addEventListener('input', format);
  if (attrs.value != null) { el.value = String(attrs.value); format(); }
  el.getValue = () => Number(el.value.replace(/\D/g, '') || 0);
  return el;
}

function field(label, input, hint) {
  return h('label', { class: 'f' }, h('span', {}, label), input, hint ? h('div', { class: 'small muted' }, hint) : null);
}

function monthPicker(value, onChange) {
  return h('input', { type: 'month', value, max: thisMonth(), style: 'max-width:190px', onchange: (e) => e.target.value && onChange(e.target.value) });
}

function openModal(title, body) {
  const close = () => { bg.remove(); document.body.style.overflow = ''; };
  const bg = h('div', { class: 'modal-bg', onclick: (e) => e.target === bg && close() },
    h('div', { class: 'modal' },
      h('div', { class: 'modal-head' }, h('h2', {}, title), h('button', { class: 'btn-ghost', onclick: close, 'aria-label': 'Đóng' }, '✕')),
      body));
  document.body.append(bg);
  document.body.style.overflow = 'hidden';
  return close;
}

function viewPhoto(src) {
  const v = h('div', { class: 'viewer', onclick: () => v.remove() }, h('img', { src, alt: 'Ảnh báo công' }));
  document.body.append(v);
}

function confirmBox(msg) { return window.confirm(msg); }

/** Nút chạy tác vụ bất đồng bộ, tự khóa khi đang xử lý. */
function actionBtn(label, cls, fn) {
  const b = h('button', { class: cls, type: 'button' }, label);
  b.addEventListener('click', async () => {
    b.disabled = true;
    try { await fn(); } catch (e) { fail(e); } finally { b.disabled = false; }
  });
  return b;
}

// ================= Ảnh & GPS =================
function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Thiết bị không hỗ trợ GPS'));
    if (!window.isSecureContext) return reject(new Error('Trình duyệt chỉ cho lấy vị trí khi web chạy HTTPS'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (err) => reject(new Error(err.code === 1
        ? 'Bạn đã chặn quyền vị trí. Vào cài đặt trình duyệt → cho phép Vị trí cho trang này.'
        : 'Không lấy được vị trí. Hãy bật GPS và thử lại.')),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 });
  });
}

/** Thu nhỏ ảnh + đóng dấu thời gian, vị trí, tên lên ảnh. */
async function processPhoto(file, stampLines) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Không đọc được ảnh')); i.src = url;
    });
    const MAX = 1600;
    const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale), hgt = Math.round(img.naturalHeight * scale);
    const c = document.createElement('canvas'); c.width = w; c.height = hgt;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, w, hgt);
    const fs = Math.max(16, Math.round(w / 40));
    ctx.font = `bold ${fs}px system-ui, sans-serif`;
    const lh = fs * 1.35, boxH = lh * stampLines.length + fs * 0.6;
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, hgt - boxH, w, boxH);
    ctx.fillStyle = '#fff';
    stampLines.forEach((t, i) => ctx.fillText(t, fs * 0.6, hgt - boxH + fs * 0.3 + lh * (i + 1) - fs * 0.3));
    return await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.8));
  } finally { URL.revokeObjectURL(url); }
}

// ================= Thương hiệu =================
// 👉 Sửa thông tin nhóm / dev tại đây (hoặc chỉnh trực tiếp trong tab Quản trị Website)
const BRAND = {
  team: 'TBT',
  app: 'TBT Báo Công',
  slogan: 'Hệ thống Quản lý Chấm công · Duyệt công · Tính lương Chuyên nghiệp',
  dev: 'Tên Dev',          // ← đổi thành tên của bạn
  devLink: '',             // (tuỳ chọn) link Facebook / Zalo / GitHub
  version: '2.0.0',
  year: new Date().getFullYear(),
};

function applySiteConfig(cfg) {
  if (!cfg) return;
  state.config = cfg;
  if (cfg.brand_team) BRAND.team = cfg.brand_team;
  if (cfg.site_title) { BRAND.app = cfg.site_title; document.title = cfg.site_title; }
  if (cfg.site_slogan !== undefined) BRAND.slogan = cfg.site_slogan;
  if (cfg.brand_dev) BRAND.dev = cfg.brand_dev;
  if (cfg.brand_dev_link !== undefined) BRAND.devLink = cfg.brand_dev_link;
}

let clockTimer = null;
function fmtClock(d = new Date()) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function startClock() {
  if (clockTimer) return;
  clockTimer = setInterval(() => {
    const nowStr = fmtClock();
    document.querySelectorAll('.live-clock').forEach((el) => { el.textContent = nowStr; });
  }, 1000);
}
startClock();

// Bộ icon SVG (phong cách Lucide, nét mảnh)
const ICONS = {
  clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  banknote: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>',
  user: '<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>',
  check: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  chart: '<path d="M3 3v18h18"/><path d="M18 17V9M13 17V5M8 17v-3"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
  code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
  heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
};
function icon(name, size = 22) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size);
  s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2');
  s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true');
  s.innerHTML = ICONS[name] || ''; // nội dung cố định trong code, không lấy từ người dùng
  return s;
}
const logoMark = (cls = 'brand-mark') => h('div', { class: cls }, BRAND.team);
function credit() {
  const name = BRAND.devLink
    ? h('a', { href: BRAND.devLink, target: '_blank', rel: 'noopener' }, BRAND.dev)
    : h('strong', {}, BRAND.dev);
  return h('div', { class: 'credit' },
    h('div', {}, 'Phát triển bởi ', name, ' ', h('span', { class: 'heart' }, icon('heart', 13))),
    h('div', {}, `© ${BRAND.year} Nhóm ${BRAND.team} · v${BRAND.version} Enterprise`));
}
function greeting() {
  const hr = new Date().getHours();
  return hr < 11 ? 'Chào buổi sáng' : hr < 14 ? 'Chào buổi trưa' : hr < 18 ? 'Chào buổi chiều' : 'Chào buổi tối';
}
const initials = (name) => (name || '?').trim().split(/\s+/).slice(-2).map((w) => w[0]).join('').toUpperCase();

// ================= Đăng nhập =================
async function renderAuth() {
  stopPolling();
  let needSetup = false;
  try {
    const s = await api('/setup');
    needSetup = s.needSetup;
    if (s.config) applySiteConfig(s.config);
  } catch (e) { /* bỏ qua */ }
  const err = h('div', { class: 'errbox hidden' });
  const name = h('input', { placeholder: 'Ví dụ: Nguyễn Văn A', autocomplete: 'name' });
  const phone = h('input', { type: 'tel', inputmode: 'tel', placeholder: 'Nhập số điện thoại', autocomplete: 'username' });
  const pass = h('input', { type: 'password', placeholder: 'Nhập mật khẩu', autocomplete: needSetup ? 'new-password' : 'current-password' });
  const eye = h('button', { type: 'button', class: 'eye', 'aria-label': 'Hiện mật khẩu', onclick: () => {
    pass.type = pass.type === 'password' ? 'text' : 'password'; eye.textContent = pass.type === 'password' ? '👁' : '🙈';
  } }, '👁');
  const btn = h('button', { class: 'btn-primary btn-block', type: 'submit' }, needSetup ? '🚀 Khởi tạo hệ thống quản lý' : 'Đăng nhập vào hệ thống →');
  const form = h('form', {
    class: 'card auth-card', onsubmit: async (e) => {
      e.preventDefault(); btn.disabled = true; err.classList.add('hidden');
      try {
        const body = { phone: phone.value, password: pass.value };
        if (needSetup) body.name = name.value;
        state.me = await api(needSetup ? '/setup' : '/login', { method: 'POST', body });
        await boot();
      } catch (ex) { err.textContent = ex.message; err.classList.remove('hidden'); }
      finally { btn.disabled = false; }
    },
  },
  h('h2', {}, needSetup ? 'Thiết lập Quản lý lần đầu' : 'Đăng nhập tài khoản'),
  err,
  needSetup ? h('div', { class: 'okbox' }, 'Chào mừng! Hãy tạo tài khoản Quản lý (Chủ) đầu tiên. Sau khi vào hệ thống, bạn sẽ tạo tài khoản và mức lương cho từng anh em.') : null,
  needSetup ? field('Họ tên quản lý', name) : null,
  field('Số điện thoại', phone),
  field('Mật khẩu', h('div', { class: 'pw' }, pass, eye), needSetup ? 'Tối thiểu 6 ký tự' : null),
  btn,
  !needSetup ? h('p', { class: 'center small muted', style: 'margin:14px 0 0' }, 'Quên mật khẩu? Liên hệ quản lý để được cấp lại.') : null);

  $app.replaceChildren(h('div', { class: 'auth-bg' },
    h('div', { class: 'auth-wrap' },
      h('div', { class: 'auth-hero' },
        logoMark('brand-mark lg'),
        h('h1', {}, BRAND.app),
        h('p', { class: 'sub' }, BRAND.slogan),
        h('div', { class: 'auth-features' },
          h('div', { class: 'auth-feat' },
            h('div', { class: 'auth-feat-ic' }, '📸'),
            h('div', {}, h('strong', {}, 'Chấm công Ảnh & GPS chống gian lận'), h('span', {}, 'Tự động đóng dấu giờ, tọa độ GPS và tên công trình trực tiếp lên ảnh chụp.'))),
          h('div', { class: 'auth-feat' },
            h('div', { class: 'auth-feat-ic' }, '⚡'),
            h('div', {}, h('strong', {}, 'Duyệt công 1 chạm & Lưu nháp Offline'), h('span', {}, 'Thông báo đẩy tức thì về điện thoại, tự động lưu nháp khi công trình mất sóng.'))),
          h('div', { class: 'auth-feat' },
            h('div', { class: 'auth-feat-ic' }, '📊'),
            h('div', {}, h('strong', {}, 'Tính lương, Chốt sổ & Xuất Excel 6 Sheet'), h('span', {}, 'Tổng hợp công, tăng ca, ứng tiền, chi phí công trình và xuất phiếu lương PNG sắc nét.'))))),
      h('div', { class: 'auth' }, form, credit()))));
}

// ================= Khung ứng dụng Enterprise =================
const WORKER_NAV = [
  ['report', 'clipboard', 'Báo công'], ['history', 'calendar', 'Lịch sử'], ['advance', 'banknote', 'Ứng tiền'],
  ['salary', 'wallet', 'Lương'], ['account', 'user', 'Tài khoản'],
];
const ADMIN_NAV = [
  ['review', 'check', 'Duyệt công'], ['payroll', 'chart', 'Bảng lương'], ['advances', 'banknote', 'Ứng tiền'],
  ['staff', 'users', 'Nhân sự & CT'], ['account', 'user', 'Tài khoản'],
];
const isAdmin = () => state.me?.role === 'admin';

let pollTimer;
function stopPolling() { clearInterval(pollTimer); pollTimer = null; }
async function refreshStats() {
  if (!isAdmin()) return;
  try { state.stats = await api('/stats'); updateNavBadges(); } catch { /* bỏ qua */ }
}
function updateNavBadges() {
  const s = state.stats || {};
  document.querySelectorAll('[data-r="review"] .dot').forEach((el) => {
    el.textContent = s.pending_reports || '';
    el.classList.toggle('hidden', !s.pending_reports);
  });
  document.querySelectorAll('[data-r="advances"] .dot').forEach((el) => {
    el.textContent = s.pending_advances || '';
    el.classList.toggle('hidden', !s.pending_advances);
  });
}

function isDarkNow() {
  const t = getTheme();
  return t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
}

function shell(route, content) {
  const nav = isAdmin() ? ADMIN_NAV : WORKER_NAV;
  const title = nav.find((n) => n[0] === route)?.[2] || BRAND.app;
  const firstName = state.me.name.trim().split(/\s+/).pop();
  const themeBtn = h('button', {
    type: 'button', class: 'icon-btn', title: 'Đổi chế độ Sáng / Tối',
    onclick: () => {
      const next = isDarkNow() ? 'light' : 'dark';
      setTheme(next);
      themeBtn.textContent = isDarkNow() ? '☀️' : '🌙';
    },
  }, isDarkNow() ? '☀️' : '🌙');

  const cfg = state.config || {};
  const impersonateBanner = (state.me?.is_webadmin || state.webAdmin)
    ? h('div', { class: 'impersonate-bar' },
      h('span', {}, `🕵️ Đang xem giao diện dưới tài khoản: ${state.me.name} (${isAdmin() ? '👑 Quản lý đội' : '👷 Nhân viên'})`),
      h('button', {
        type: 'button',
        onclick: () => { location.hash = '#/admin/users'; },
      }, '🛡️ Quay lại Quản trị Web'))
    : null;
  const maintBanner = cfg.maintenance_mode
    ? h('div', { class: 'sys-banner maint' }, '🚧 ', h('span', {}, 'Hệ thống đang bật Chế độ Bảo trì (nhân viên tạm ngưng gửi báo công mới).'))
    : null;
  const announceBanner = cfg.system_banner
    ? h('div', { class: 'sys-banner' }, '📢 ', h('span', {}, cfg.system_banner))
    : null;

  const sidebar = h('aside', { class: 'sidebar' },
    h('div', { class: 'sidebar-brand' },
      logoMark(),
      h('div', {},
        h('h2', {}, BRAND.app),
        h('p', {}, `v${BRAND.version} · Enterprise`))),
    h('nav', { class: 'sidebar-nav' }, nav.map(([r, ic, label]) =>
      h('a', { href: '#/' + r, 'data-r': r, class: r === route ? 'active' : '' },
        h('span', { class: 'ic' }, icon(ic, 20)),
        h('span', {}, label),
        h('span', { class: 'dot hidden' })))),
    h('div', { class: 'sidebar-foot' },
      h('a', { href: '#/account', class: 'sidebar-user', style: 'text-decoration:none;color:inherit' },
        h('div', { class: 'avatar sm' }, initials(state.me.name)),
        h('div', { class: 'grow', style: 'min-width:0' },
          h('strong', {}, state.me.name),
          h('span', {}, isAdmin() ? '👑 Quản lý đội' : '👷 Nhân viên')))));

  const workspace = h('div', { class: 'workspace' },
    h('header', { class: 'topbar' },
      h('div', { class: 'topbar-in' },
        logoMark(),
        h('div', { class: 'grow' },
          h('div', { class: 'hello' }, `${greeting()}, ${firstName} 👋`),
          h('h1', {}, title)),
        h('div', { class: 'clock-pill', title: 'Giờ hệ thống trực tiếp' },
          h('span', { class: 'live-clock' }, fmtClock())),
        themeBtn,
        h('a', { href: '#/account', class: 'avatar', title: state.me.name }, initials(state.me.name)))),
    h('main', { class: 'fade-in' }, impersonateBanner, maintBanner, announceBanner, content),
    h('nav', { class: 'bottom' }, nav.map(([r, ic, label]) =>
      h('a', { href: '#/' + r, 'data-r': r, class: r === route ? 'active' : '' },
        h('span', { class: 'ic' }, icon(ic)), h('span', { class: 'lb' }, label), h('span', { class: 'dot hidden' })))));

  $app.replaceChildren(h('div', { class: 'app-layout' }, sidebar, workspace));
  updateNavBadges();
}

async function loadSites() { state.sites = await api('/sites'); }

async function route() {
  if (isAdminPortalUrl()) return routeWebAdmin();
  if (!state.me) return renderAuth();
  const r = (location.hash.replace(/^#\/?/, '') || '').split('?')[0];
  const nav = isAdmin() ? ADMIN_NAV : WORKER_NAV;
  const name = nav.some((n) => n[0] === r) ? r : nav[0][0];
  const views = isAdmin()
    ? { review: viewReview, payroll: viewPayroll, advances: viewAdminAdvances, staff: viewStaff, account: viewAccount }
    : { report: viewReport, history: viewHistory, advance: viewAdvance, salary: viewSalary, account: viewAccount };
  const box = h('div', {},
    h('div', { class: 'card' },
      h('div', { class: 'skel lg', style: 'width:45%;margin-bottom:14px' }),
      h('div', { class: 'skel', style: 'width:100%;margin-bottom:10px' }),
      h('div', { class: 'skel', style: 'width:80%;margin-bottom:10px' }),
      h('div', { class: 'skel', style: 'width:60%' })));
  shell(name, box);
  window.scrollTo(0, 0);
  try { await views[name](box); } catch (e) { box.replaceChildren(h('div', { class: 'errbox' }, e.message)); }
}

async function boot() {
  if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('/sw.js').catch(() => {});
  if (isAdminPortalUrl()) return routeWebAdmin();
  try {
    state.me = await api('/me');
    if (state.me.config) applySiteConfig(state.me.config);
  } catch { return renderAuth(); }
  await loadSites().catch(() => {});
  if (isAdmin()) { await refreshStats(); stopPolling(); pollTimer = setInterval(refreshStats, 60000); }
  route();
}
window.addEventListener('hashchange', route);

// ================= Lưu nháp khi mất sóng (IndexedDB) =================
function openDraftDB() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error('Thiết bị không hỗ trợ lưu nháp'));
    const req = indexedDB.open('tbt_baocong_offline', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('drafts', { keyPath: 'id', autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function saveDraftOffline(draft) {
  const db = await openDraftDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('drafts', 'readwrite');
    tx.objectStore('drafts').add({ ...draft, saved_at: new Date().toISOString() });
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
async function listDraftsOffline() {
  try {
    const db = await openDraftDB();
    return await new Promise((res, rej) => {
      const req = db.transaction('drafts', 'readonly').objectStore('drafts').getAll();
      req.onsuccess = () => res(req.result || []);
      req.onerror = () => rej(req.error);
    });
  } catch { return []; }
}
async function deleteDraftOffline(id) {
  const db = await openDraftDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('drafts', 'readwrite');
    tx.objectStore('drafts').delete(id);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
async function sendDraftObject(d) {
  const fd = new FormData();
  fd.append('work_date', d.work_date);
  fd.append('day_type', d.day_type);
  fd.append('note', d.note || '');
  if (d.day_type !== 'off') {
    if (d.photoBlob) fd.append('photo', d.photoBlob, 'photo.jpg');
    fd.append('site_id', d.site_id);
    fd.append('check_in', d.check_in);
    fd.append('check_out', d.check_out);
    fd.append('ot_hours', d.ot_hours || '0');
    if (d.lat != null) fd.append('lat', d.lat);
    if (d.lng != null) fd.append('lng', d.lng);
    if (d.accuracy != null) fd.append('accuracy', d.accuracy || 0);
  }
  return api('/reports', { method: 'POST', form: fd });
}
async function syncOfflineDrafts() {
  const drafts = await listDraftsOffline();
  if (!drafts.length || !navigator.onLine) return 0;
  let sent = 0;
  for (const d of drafts) {
    try { await sendDraftObject(d); await deleteDraftOffline(d.id); sent++; } catch { /* giữ lại nếu lỗi */ }
  }
  if (sent) toast(`📶 Đã tự động gửi ${sent} báo công lưu nháp!`);
  return sent;
}
window.addEventListener('online', () => { syncOfflineDrafts().then((n) => n && route()); });

// ================= NHÂN VIÊN: Báo công & Xin nghỉ phép =================
async function viewReport(box) {
  await loadSites().catch(() => {});
  const today = state.me.today || localDate();
  let existingToday = null;
  try { existingToday = (await api('/reports?date=' + today))[0]; } catch { /* offline */ }
  const drafts = await listDraftsOffline();

  const pos = { value: null };
  const photo = { file: null };
  const err = h('div', { class: 'errbox hidden' });

  const dateHint = h('div', { class: 'small muted' }, `Được báo bù tối đa ${state.me.backdate_days ?? 3} ngày trước`);
  const date = h('input', { type: 'date', value: today, max: today, min: addDays(today, -(state.me.backdate_days ?? 3)) });
  const typeSeg = h('div', { class: 'seg' }, [
    ['full', 'Cả ngày'], ['half', 'Nửa ngày'], ['off', '🏖 Xin nghỉ'],
  ].map(([v, l]) =>
    h('label', {}, h('input', { type: 'radio', name: 'day_type', value: v, checked: v === 'full', onchange: toggleWorking }), l)));
  const site = h('select', {},
    h('option', { value: '' }, state.sites.length ? '— Chọn công trình —' : '(Chưa có công trình, báo quản lý thêm)'),
    state.sites.map((s) => h('option', { value: s.id }, s.name + (s.address ? ' – ' + s.address : ''))));
  if (state.sites.length === 1) site.value = state.sites[0].id;
  const lastSite = localStorage.getItem('lastSite');
  if (lastSite && state.sites.some((s) => String(s.id) === lastSite)) site.value = lastSite;
  const cfg = state.config || {};
  const checkIn = h('input', { type: 'time', value: localStorage.getItem('lastIn') || cfg.default_check_in || '07:00' });
  const checkOut = h('input', { type: 'time', value: localStorage.getItem('lastOut') || cfg.default_check_out || '17:00' });
  const ot = h('input', { type: 'number', inputmode: 'decimal', min: 0, max: 16, step: 0.5, value: 0 });
  const note = h('textarea', { placeholder: 'Hôm nay làm gì? (vd: đổ bê tông tầng 2, xây tường rào…)', maxlength: 1000 });

  // Ảnh
  const preview = h('img', { class: 'hidden', alt: 'Ảnh xem trước' });
  const fileIn = h('input', {
    type: 'file', accept: 'image/*', capture: 'environment', class: 'hidden', onchange: () => {
      const f = fileIn.files[0]; if (!f) return;
      photo.file = f; preview.src = URL.createObjectURL(f); preview.classList.remove('hidden');
      photoBtn.textContent = '📷 Chụp lại';
    },
  });
  const photoBtn = h('button', { type: 'button', class: 'btn-primary', onclick: () => fileIn.click() }, '📷 Chụp ảnh tại nơi làm');
  const photoBox = h('div', { class: 'photo-box' }, preview, photoBtn, fileIn,
    h('div', { class: 'small muted mt' }, 'Ảnh sẽ được đóng dấu giờ & vị trí tự động'));

  // GPS
  const gpsText = h('span', { class: 'grow' }, 'Đang lấy vị trí…');
  const gpsBox = h('div', { class: 'gps' }, h('span', {}, '📍'), gpsText, h('button', { type: 'button', class: 'btn-sm', onclick: locate }, 'Lấy lại'));
  async function locate() {
    gpsBox.className = 'gps'; gpsText.textContent = 'Đang lấy vị trí…';
    try {
      pos.value = await getPosition();
      gpsBox.className = 'gps ok';
      gpsText.replaceChildren('Đã lấy vị trí (sai số ±' + Math.round(pos.value.accuracy) + 'm) · ',
        h('a', { href: mapUrl(pos.value.lat, pos.value.lng), target: '_blank', rel: 'noopener' }, 'xem bản đồ'));
    } catch (e) { pos.value = null; gpsBox.className = 'gps err'; gpsText.textContent = e.message; }
  }

  const workingFields = h('div', {},
    field('Công trình / địa điểm', site),
    h('div', { class: 'grid2' }, field('Giờ vào', checkIn), field('Giờ ra', checkOut)),
    field('Tăng ca (số giờ)', ot, 'Để 0 nếu không tăng ca'),
    field('Ảnh chụp', photoBox),
    field('Vị trí GPS', gpsBox));

  function toggleWorking() {
    const t = typeSeg.querySelector('input:checked').value;
    const isOff = t === 'off';
    workingFields.classList.toggle('hidden', isOff);
    if (isOff) {
      date.max = addDays(today, 30);
      dateHint.textContent = '🏖 Xin nghỉ phép: có thể chọn ngày hôm nay hoặc xin nghỉ trước tối đa 30 ngày';
      note.placeholder = 'Lý do xin nghỉ phép (bắt buộc nếu xin nghỉ trước)…';
      submit.textContent = 'Gửi đơn xin nghỉ';
    } else {
      date.max = today;
      if (date.value > today) date.value = today;
      dateHint.textContent = `Được báo bù tối đa ${state.me.backdate_days ?? 3} ngày trước`;
      note.placeholder = 'Hôm nay làm gì? (vd: đổ bê tông tầng 2, xây tường rào…)';
      submit.textContent = 'Gửi báo công';
    }
  }

  async function buildDraftPayload() {
    const dayType = typeSeg.querySelector('input:checked').value;
    const working = dayType !== 'off';
    if (working) {
      if (!site.value) throw new Error('Vui lòng chọn công trình');
      if (cfg.require_photo !== false && !photo.file) throw new Error('Vui lòng chụp ảnh tại nơi làm việc');
      if (cfg.require_gps !== false && !pos.value) throw new Error('Chưa lấy được vị trí GPS. Bấm "Lấy lại".');
      if (checkIn.value && checkOut.value && checkOut.value <= checkIn.value && !confirmBox('Giờ ra sớm hơn giờ vào – bạn làm qua đêm phải không?')) return null;
      const siteName = state.sites.find((s) => String(s.id) === site.value)?.name || '';
      const now = new Date();
      const photoBlob = photo.file ? await processPhoto(photo.file, [
        `${state.me.name} · ${siteName}`.slice(0, 60),
        `${pad(now.getHours())}:${pad(now.getMinutes())} ${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} · công ngày ${date.value.split('-').reverse().join('/')}`,
        pos.value ? `GPS ${pos.value.lat.toFixed(6)}, ${pos.value.lng.toFixed(6)} (±${Math.round(pos.value.accuracy)}m)` : 'Không có GPS',
      ]) : null;
      localStorage.setItem('lastSite', site.value);
      localStorage.setItem('lastIn', checkIn.value);
      localStorage.setItem('lastOut', checkOut.value);
      return {
        work_date: date.value, day_type: dayType, note: note.value,
        site_id: site.value, site_name: siteName, check_in: checkIn.value, check_out: checkOut.value,
        ot_hours: ot.value || '0', lat: pos.value?.lat ?? null, lng: pos.value?.lng ?? null, accuracy: pos.value?.accuracy ?? null,
        photoBlob,
      };
    }
    if (date.value > today && !note.value.trim()) throw new Error('Vui lòng nhập lý do xin nghỉ phép');
    return { work_date: date.value, day_type: 'off', note: note.value };
  }

  const submit = h('button', { class: 'btn-primary btn-block', type: 'submit' }, 'Gửi báo công');
  const saveOfflineBtn = actionBtn('📶 Mất sóng? Lưu nháp vào máy', 'btn-block mt', async () => {
    err.classList.add('hidden');
    const payload = await buildDraftPayload();
    if (!payload) return;
    await saveDraftOffline(payload);
    toast('📶 Đã lưu nháp vào máy! Khi có mạng sẽ gửi lên.');
    viewReport(box);
  });

  const form = h('form', {
    class: 'card', onsubmit: async (e) => {
      e.preventDefault(); err.classList.add('hidden');
      let payload;
      try {
        submit.disabled = true; submit.textContent = 'Đang gửi…';
        payload = await buildDraftPayload();
        if (!payload) return;
        await sendDraftObject(payload);
        toast(payload.day_type === 'off' ? '✅ Đã gửi đơn xin nghỉ, chờ quản lý duyệt' : '✅ Đã gửi báo công, chờ quản lý duyệt');
        location.hash = '#/history';
      } catch (ex) {
        if (payload && /Mất kết nối mạng/.test(ex.message)) {
          await saveDraftOffline(payload).catch(() => {});
          toast('📶 Mất mạng – đã tự lưu nháp vào máy để gửi sau!');
          return viewReport(box);
        }
        err.textContent = ex.message; err.classList.remove('hidden'); err.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } finally { submit.disabled = false; toggleWorking(); }
    },
  },
  err,
  h('label', { class: 'f' }, h('span', {}, 'Ngày'), date, dateHint),
  field('Loại công / Nghỉ phép', typeSeg),
  workingFields,
  field('Ghi chú công việc / Lý do nghỉ', note),
  submit,
  saveOfflineBtn);

  // Thẻ danh sách bản nháp lưu khi mất sóng
  const draftsCard = drafts.length ? h('div', { class: 'card' },
    h('div', { class: 'row between' },
      h('strong', {}, `📶 ${drafts.length} báo công lưu nháp (chưa gửi)`),
      actionBtn('📤 Gửi tất cả', 'btn-ok btn-sm', async () => {
        for (const d of drafts) { await sendDraftObject(d); await deleteDraftOffline(d.id); }
        toast('✅ Đã gửi hết các bản nháp!'); viewReport(box);
      })),
    h('div', { class: 'mt' }, drafts.map((d) => h('div', { class: 'item row between' },
      h('div', {},
        h('strong', {}, fmtDate(d.work_date)), ' · ', TYPE[d.day_type],
        d.site_name ? ' · ' + d.site_name : '',
        d.note ? h('div', { class: 'small muted' }, d.note) : null),
      h('div', { class: 'row' },
        actionBtn('Gửi', 'btn-sm btn-primary', async () => {
          await sendDraftObject(d); await deleteDraftOffline(d.id); toast('✅ Đã gửi'); viewReport(box);
        }),
        actionBtn('Xóa', 'btn-sm btn-bad', async () => {
          await deleteDraftOffline(d.id); viewReport(box);
        })))))) : null;

  const shiftHero = h('div', { class: 'shift-hero' },
    h('div', {},
      h('div', { class: 'shift-date' }, `${fmtDate(today)} · CA LÀM VIỆC HÔM NAY`),
      h('div', { class: 'shift-clock live-clock' }, fmtClock()),
      h('div', { class: 'shift-meta' },
        existingToday
          ? h('span', {}, `✓ Đã gửi: ${TYPE[existingToday.day_type]} (${STATUS[existingToday.status]})`)
          : h('span', {}, '⏳ Hôm nay chưa gửi báo công'),
        drafts.length ? h('span', {}, `📶 ${drafts.length} bản nháp chờ gửi`) : null)),
    h('div', {},
      existingToday ? badge(existingToday.status) : h('span', { class: 'badge b-pending' }, 'Chưa báo')));

  const statusCard = existingToday ? h('div', { class: 'card' },
    h('div', { class: 'row between' }, h('strong', {}, 'Hôm nay bạn đã báo công'), badge(existingToday.status)),
    h('div', { class: 'small muted mt' }, `${TYPE[existingToday.day_type]}${existingToday.site_name ? ' · ' + existingToday.site_name : ''}${existingToday.check_in ? ` · ${existingToday.check_in}–${existingToday.check_out}` : ''}`),
    existingToday.status === 'rejected' ? h('div', { class: 'errbox mt' }, 'Lý do từ chối: ' + existingToday.review_note + ' — hãy gửi lại bên dưới.') : null,
    existingToday.status === 'pending' ? h('div', { class: 'small muted mt' }, 'Gửi lại bên dưới sẽ thay thế báo công cũ.') : null) : null;

  const secureWarn = !window.isSecureContext
    ? h('div', { class: 'warnbox' }, '⚠️ Trang đang chạy không có HTTPS nên điện thoại sẽ không cho lấy vị trí GPS. Báo quản lý cài HTTPS.')
    : null;

  box.replaceChildren(shiftHero, secureWarn, draftsCard, statusCard, existingToday?.status === 'approved' ? null : form);
  if (existingToday?.status === 'approved') {
    box.append(h('div', { class: 'card center muted' }, 'Ngày hôm nay đã được duyệt. Muốn báo bù ngày trước hoặc xin nghỉ phép ngày tới? ',
      h('button', { class: 'btn-ghost', onclick: () => { box.append(form); } }, 'Mở form')));
  }
  locate();
}

// ================= NHÂN VIÊN: Lịch sử (lịch tháng) =================
async function viewHistory(box, month = thisMonth()) {
  const list = await api('/reports?month=' + month);
  const approved = list.filter((r) => r.status === 'approved');
  const days = approved.reduce((s, r) => s + ({ full: 1, half: 0.5, off: 0 })[r.day_type], 0);
  const ot = approved.reduce((s, r) => s + r.ot_hours, 0);
  const pending = list.filter((r) => r.status === 'pending').length;
  const listCard = h('div', { class: 'card' },
    h('h2', {}, 'Chi tiết'),
    list.length ? list.map((r) => reportItem(r, {
      onDelete: r.status !== 'approved' ? async () => {
        if (!confirmBox('Xóa báo công ngày ' + fmtDate(r.work_date) + '?')) return;
        await api('/reports/' + r.id, { method: 'DELETE' }); toast('Đã xóa'); viewHistory(box, month);
      } : null,
    })) : h('div', { class: 'empty' }, 'Chưa có báo công nào trong tháng'));
  box.replaceChildren(
    h('div', { class: 'card' },
      h('div', { class: 'row between' }, monthPicker(month, (m) => viewHistory(box, m)),
        h('div', { class: 'mini-stats' },
          h('div', {}, h('b', {}, fmtNum(days)), h('span', {}, 'công')),
          h('div', {}, h('b', {}, fmtNum(ot)), h('span', {}, 'giờ TC')),
          pending ? h('div', { class: 'warn' }, h('b', {}, pending), h('span', {}, 'chờ')) : null)),
      calendar(month, list, (r) => {
        if (!r) return;
        openModal(fmtDate(r.work_date), h('div', {}, reportItem(r)));
      })),
    listCard);
}

/** Lịch tháng dạng ô ngày (tuần bắt đầu Thứ 2). */
function calendar(month, reports, onPick) {
  const map = Object.fromEntries(reports.map((r) => [r.work_date, r]));
  const [y, m] = month.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const total = new Date(y, m, 0).getDate();
  const lead = (first.getDay() + 6) % 7; // số ô trống trước ngày 1
  const today = localDate();
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(h('div', { class: 'cal-cell empty' }));
  for (let d = 1; d <= total; d++) {
    const key = `${month}-${pad(d)}`;
    const r = map[key];
    let cls = 'cal-cell';
    let mark = '';
    if (r) {
      if (r.status === 'pending') { cls += ' st-pending'; mark = '⏳'; }
      else if (r.status === 'rejected') { cls += ' st-rejected'; mark = '✕'; }
      else if (r.day_type === 'full') { cls += ' st-full'; mark = '✓'; }
      else if (r.day_type === 'half') { cls += ' st-half'; mark = '½'; }
      else { cls += ' st-off'; mark = 'N'; }
    } else if (key < today && new Date(key + 'T12:00:00').getDay() !== 0) cls += ' st-missing';
    if (key === today) cls += ' today';
    if (key > today) cls += ' future';
    cells.push(h('button', { type: 'button', class: cls, onclick: () => onPick(r), 'aria-label': fmtDate(key) },
      h('span', { class: 'cal-d' }, d),
      mark ? h('span', { class: 'cal-m' }, mark) : null,
      r?.ot_hours ? h('span', { class: 'cal-ot' }, '+' + fmtNum(r.ot_hours) + 'h') : null));
  }
  return h('div', {},
    h('div', { class: 'cal' },
      ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map((w) => h('div', { class: 'cal-wd' }, w)),
      cells),
    h('div', { class: 'cal-legend' },
      h('span', {}, h('i', { class: 'st-full' }), 'Cả ngày'),
      h('span', {}, h('i', { class: 'st-half' }), 'Nửa ngày'),
      h('span', {}, h('i', { class: 'st-off' }), 'Nghỉ'),
      h('span', {}, h('i', { class: 'st-pending' }), 'Chờ duyệt'),
      h('span', {}, h('i', { class: 'st-rejected' }), 'Từ chối'),
      h('span', {}, h('i', { class: 'st-missing' }), 'Chưa báo')));
}

/** Một dòng báo công (dùng cho cả nhân viên & quản lý). */
function reportItem(r, { showName, onDelete, actions } = {}) {
  const leftMedia = r.photo
    ? h('img', { class: 'thumb', src: '/api/photos/' + r.photo, loading: 'lazy', alt: 'Ảnh', onclick: () => viewPhoto('/api/photos/' + r.photo) })
    : (showName ? h('div', { class: 'avatar sm', style: 'margin-top:2px' }, initials(r.user_name)) : null);
  return h('div', { class: 'item', 'data-search': `${r.user_name || ''} ${r.site_name || ''} ${r.note || ''}`.toLowerCase(), 'data-site': String(r.site_id || '') },
    h('div', { class: 'rep' },
      leftMedia,
      h('div', { class: 'grow' },
        h('div', { class: 'row between' },
          h('strong', {}, showName ? r.user_name : fmtDate(r.work_date)),
          badge(r.status)),
        showName && r.user_name !== fmtDate(r.work_date) ? h('div', { class: 'small muted' }, fmtDate(r.work_date)) : null,
        h('div', { class: 'meta-pills' },
          h('span', { class: 'badge ' + (r.day_type === 'off' ? 'b-off' : 'b-approved') }, TYPE[r.day_type]),
          r.site_name ? h('span', { class: 'pill' }, '🏗️ ' + r.site_name) : null,
          r.check_in ? h('span', { class: 'pill' }, `🕒 ${r.check_in}–${r.check_out}`) : null,
          r.ot_hours ? h('span', { class: 'pill' }, `⚡ TC +${fmtNum(r.ot_hours)}h`) : null,
          r.lat != null ? h('a', { class: 'pill', href: mapUrl(r.lat, r.lng), target: '_blank', rel: 'noopener', style: 'text-decoration:none' },
            `📍 GPS${r.accuracy ? ` ±${Math.round(r.accuracy)}m` : ''}`) : null),
        r.note ? h('div', { class: 'small muted', style: 'margin-top:4px' }, '“' + r.note + '”') : null,
        r.status === 'rejected' && r.review_note ? h('div', { class: 'small', style: 'color:var(--bad);margin-top:4px' }, 'Lý do từ chối: ' + r.review_note) : null,
        (onDelete || actions) ? h('div', { class: 'row wrap mt' }, actions || null,
          onDelete ? h('button', { class: 'btn-sm btn-bad', onclick: () => onDelete().catch(fail) }, 'Xóa') : null) : null)));
}

// ================= NHÂN VIÊN: Ứng tiền =================
async function viewAdvance(box) {
  const list = await api('/advances');
  const amount = moneyInput({ placeholder: 'Số tiền muốn ứng' });
  const reason = h('input', { placeholder: 'Lý do (không bắt buộc)', maxlength: 500 });
  const btn = h('button', { class: 'btn-primary btn-block', type: 'submit' }, 'Gửi yêu cầu ứng');
  box.replaceChildren(
    h('form', {
      class: 'card', onsubmit: async (e) => {
        e.preventDefault();
        if (!amount.getValue()) return toast('Nhập số tiền', true);
        btn.disabled = true;
        try {
          await api('/advances', { method: 'POST', body: { amount: amount.getValue(), reason: reason.value } });
          toast('Đã gửi yêu cầu ứng tiền'); viewAdvance(box);
        } catch (ex) { fail(ex); } finally { btn.disabled = false; }
      },
    }, h('h2', {}, 'Xin ứng tiền'), field('Số tiền (VNĐ)', amount), field('Lý do', reason), btn),
    h('div', { class: 'card' }, h('h2', {}, 'Lịch sử ứng tiền'),
      list.length ? list.map((a) => advanceItem(a, {
        onDelete: a.status === 'pending' ? async () => {
          if (!confirmBox('Hủy yêu cầu ứng này?')) return;
          await api('/advances/' + a.id, { method: 'DELETE' }); viewAdvance(box);
        } : null,
      })) : h('div', { class: 'empty' }, 'Chưa có khoản ứng nào')));
}

function advanceItem(a, { showName, onDelete, actions } = {}) {
  return h('div', { class: 'item' },
    h('div', { class: 'row between' },
      h('div', {}, h('strong', {}, fmtMoney(a.amount)), showName ? ' · ' + a.user_name : ''),
      badge(a.status)),
    h('div', { class: 'small muted' }, fmtDate(a.adv_date), a.reason ? ' · ' + a.reason : ''),
    a.status === 'rejected' && a.review_note ? h('div', { class: 'small', style: 'color:var(--bad)' }, 'Lý do: ' + a.review_note) : null,
    (onDelete || actions) ? h('div', { class: 'row wrap mt' }, actions || null,
      onDelete ? h('button', { class: 'btn-sm btn-bad', onclick: () => onDelete().catch(fail) }, 'Xóa') : null) : null);
}

// ================= NHÂN VIÊN: Lương =================
async function viewSalary(box, month = thisMonth()) {
  const data = await api('/payroll?month=' + month);
  const r = data.rows[0];
  box.replaceChildren(
    h('div', { class: 'card row between wrap' },
      monthPicker(month, (m) => viewSalary(box, m)),
      data.locked ? h('span', { class: 'badge b-approved' }, '🔒 Đã chốt sổ') : null),
    r ? salaryCard(r, month) : h('div', { class: 'card empty' }, 'Không có dữ liệu'),
    r && r.adjustments.length ? h('div', { class: 'card' }, h('h2', {}, 'Thưởng / phụ cấp / phạt'), r.adjustments.map((j) => adjustmentItem(j))) : null);
}

const KIND = { bonus: 'Thưởng', allowance: 'Phụ cấp', penalty: 'Phạt' };
const KIND_IC = { bonus: '🎉', allowance: '💰', penalty: '⚠️' };

// Danh sách ngân hàng phổ biến tại Việt Nam (chuẩn mã BIN Napas để tạo VietQR)
const BANKS = [
  ['970436', 'Vietcombank (VCB)'],
  ['970415', 'VietinBank (CTG)'],
  ['970418', 'BIDV'],
  ['970405', 'Agribank'],
  ['970422', 'MBBank (MB)'],
  ['970407', 'Techcombank (TCB)'],
  ['970416', 'ACB'],
  ['970432', 'VPBank'],
  ['970423', 'TPBank'],
  ['970403', 'Sacombank (STB)'],
  ['970437', 'HDBank'],
  ['970441', 'VIB'],
  ['970443', 'SHB'],
  ['970440', 'SeABank'],
  ['970426', 'MSB'],
  ['970448', 'OCB'],
  ['970449', 'LPBank'],
  ['970431', 'Eximbank'],
  ['970428', 'Nam A Bank'],
  ['546034', 'CAKE by VPBank'],
  ['963388', 'Timo'],
];

function stripVN(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function copyText(text, label = 'Đã sao chép') {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(String(text)).then(() => toast('📋 ' + label)).catch(() => {});
  } else {
    const ta = h('textarea', { value: String(text), style: 'position:fixed;opacity:0' });
    document.body.append(ta); ta.select();
    try { document.execCommand('copy'); toast('📋 ' + label); } catch { /* ignore */ }
    ta.remove();
  }
}

/** Modal tạo mã VietQR chuyển khoản lương tự động + điền nhanh STK nếu chưa có. */
function openVietQRModal(r, month, reload) {
  const u = r.user;
  const amount = Math.max(0, Math.round(r.net || 0));
  const memo = `Thanh toan luong T${month.slice(5)} ${stripVN(u.name)}`.slice(0, 50);
  let close;

  if (!u.bank_bin || !u.bank_account) {
    const bankSel = h('select', {},
      h('option', { value: '' }, '— Chọn ngân hàng —'),
      BANKS.map(([bin, name]) => h('option', { value: bin, selected: bin === u.bank_bin }, name)));
    const accIn = h('input', { value: u.bank_account || '', placeholder: 'Nhập số tài khoản ngân hàng', inputmode: 'numeric' });
    const holderIn = h('input', { value: u.bank_holder || stripVN(u.name), placeholder: 'VD: NGUYEN VAN A' });

    close = openModal(`🏧 Cài đặt Ngân hàng – ${u.name}`, h('div', {},
      h('div', { class: 'warnbox', style: 'margin-bottom:12px' },
        `Nhân viên `, h('b', {}, u.name), ` chưa có thông tin Số tài khoản ngân hàng. Hãy chọn ngân hàng và nhập STK bên dưới để tạo mã QR chuyển lương tự động:`),
      field('Ngân hàng thụ hưởng', bankSel),
      field('Số tài khoản', accIn),
      field('Tên chủ tài khoản (không dấu)', holderIn),
      actionBtn('💾 Lưu & Tạo mã VietQR ngay', 'btn-primary btn-block mt', async () => {
        if (!bankSel.value || !accIn.value.trim()) throw new Error('Vui lòng chọn ngân hàng và nhập số tài khoản');
        const bName = BANKS.find((b) => b[0] === bankSel.value)?.[1] || '';
        const updated = await api('/users/' + u.id, {
          method: 'PUT',
          body: {
            bank_bin: bankSel.value,
            bank_name: bName,
            bank_account: accIn.value.trim(),
            bank_holder: holderIn.value.trim().toUpperCase(),
          },
        });
        Object.assign(r.user, updated);
        toast('✅ Đã lưu thông tin ngân hàng');
        close();
        if (reload) reload();
        openVietQRModal(r, month, reload);
      })));
    return;
  }

  const holder = u.bank_holder || stripVN(u.name);
  const qrUrl = `https://img.vietqr.io/image/${encodeURIComponent(u.bank_bin)}-${encodeURIComponent(u.bank_account)}-compact2.png?amount=${amount}&addInfo=${encodeURIComponent(memo)}&accountName=${encodeURIComponent(holder)}`;

  close = openModal(`🏧 Mã QR Chuyển lương – ${u.name}`, h('div', {},
    r.paid
      ? h('div', { class: 'okbox', style: 'margin-bottom:12px' },
        `✅ Đã quyết toán lương tháng ${month.slice(5)}/${month.slice(0, 4)} (${r.paid.method === 'cash' ? '💵 Tiền mặt' : '🏦 Chuyển khoản'} · ${fmtDateTime(r.paid.paid_at)})`)
      : null,
    h('div', { class: 'vietqr-box' },
      h('img', { class: 'vietqr-img', src: qrUrl, alt: 'Mã VietQR chuyển khoản lương' }),
      h('div', { style: 'font-weight:800;font-size:16px;color:#0f172a' }, holder),
      h('div', { style: 'font-size:13px;color:#475569;margin-top:2px' }, `${u.bank_name} · STK: ${u.bank_account}`)),
    h('div', { class: 'mt' },
      h('div', { class: 'copy-row' },
        h('span', {}, '🏦 Số tài khoản: ', h('code', {}, u.bank_account)),
        h('button', { class: 'btn-sm', onclick: () => copyText(u.bank_account, 'Đã chép STK: ' + u.bank_account) }, '📋 Chép')),
      h('div', { class: 'copy-row' },
        h('span', {}, '💰 Số tiền thực lĩnh: ', h('code', {}, fmtMoney(amount))),
        h('button', { class: 'btn-sm', onclick: () => copyText(amount, 'Đã chép số tiền: ' + fmtMoney(amount)) }, '📋 Chép')),
      h('div', { class: 'copy-row' },
        h('span', {}, '📝 Nội dung: ', h('code', {}, memo)),
        h('button', { class: 'btn-sm', onclick: () => copyText(memo, 'Đã chép nội dung CK') }, '📋 Chép'))),
    isAdmin() ? h('div', { class: 'row wrap mt' },
      !r.paid ? actionBtn('✅ Đã chuyển khoản xong → Xác nhận ĐÃ TRẢ LƯƠNG', 'btn-ok btn-block', async () => {
        await api('/payroll/paid', {
          method: 'POST',
          body: {
            month,
            user_id: u.id,
            paid: true,
            method: 'transfer',
            amount,
            note: `Chuyển khoản VietQR (${u.bank_name} - ${u.bank_account})`,
          },
        });
        toast(`💸 Đã xác nhận trả lương cho ${u.name}`);
        close();
        if (reload) reload();
      }) : null,
      h('button', {
        class: 'btn-sm btn-ghost btn-block',
        onclick: () => {
          close();
          const savedBin = u.bank_bin;
          u.bank_bin = '';
          openVietQRModal(r, month, reload);
          u.bank_bin = savedBin;
        },
      }, '✎ Đổi số tài khoản ngân hàng của ' + u.name)) : null));
}

/** Modal xác nhận quyết toán & ký nhận lương tháng (Chuyển khoản / Tiền mặt). */
function openPayConfirmModal(r, month, reload) {
  const u = r.user;
  const isPaid = !!r.paid;
  const defMethod = r.paid?.method || (u.bank_account ? 'transfer' : 'cash');
  const methodSeg = h('div', { class: 'seg' },
    [['transfer', '🏦 Chuyển khoản ngân hàng'], ['cash', '💵 Tiền mặt trực tiếp']].map(([v, l]) =>
      h('label', {}, h('input', { type: 'radio', name: 'pay_method', value: v, checked: v === defMethod }), l)));
  const amountIn = moneyInput({ value: r.paid?.amount || Math.max(0, Math.round(r.net || 0)) });
  const noteIn = h('input', {
    value: r.paid?.note || '',
    placeholder: 'VD: Đã chuyển khoản Vietcombank / Nhân viên đã ký nhận đủ tiền mặt…',
    maxlength: 300,
  });
  let close;
  close = openModal(`✍️ Quyết toán Lương T${month.slice(5)}/${month.slice(0, 4)} – ${u.name}`, h('div', {},
    h('div', { class: 'okbox', style: 'margin-bottom:12px' },
      h('div', { class: 'row between' },
        h('span', {}, 'Nhân viên: ', h('b', {}, u.name)),
        h('span', {}, 'Thực lĩnh: ', h('b', { style: 'font-size:16px' }, fmtMoney(r.net)))),
      h('div', { class: 'small muted', style: 'margin-top:4px' },
        `Công đã duyệt: ${fmtNum(r.work_days)} công (+${fmtNum(r.ot_hours)}h TC) · Tổng lương: ${fmtMoney(r.gross)} · Đã ứng: ${fmtMoney(r.advance_total)}`)),
    field('Hình thức thanh toán', methodSeg),
    field('Số tiền thực trả (VNĐ)', amountIn),
    field('Ghi chú quyết toán / ký nhận', noteIn),
    h('div', { class: 'row wrap mt' },
      actionBtn('💾 Xác nhận ĐÃ THANH TOÁN LƯƠNG', 'btn-ok grow', async () => {
        const method = methodSeg.querySelector('input:checked')?.value || 'transfer';
        await api('/payroll/paid', {
          method: 'POST',
          body: {
            month,
            user_id: u.id,
            paid: true,
            method,
            amount: amountIn.getValue(),
            note: noteIn.value.trim(),
          },
        });
        toast(`💸 Đã xác nhận thanh toán lương cho ${u.name}`);
        close();
        if (reload) reload();
      }),
      h('button', {
        type: 'button',
        class: 'btn-primary',
        onclick: () => { close(); openVietQRModal(r, month, reload); },
      }, '🏧 Mở mã QR')),
    isPaid ? h('div', { class: 'mt' },
      actionBtn('↩️ Hủy trạng thái Đã thanh toán', 'btn-bad btn-block btn-sm', async () => {
        if (!confirmBox(`Hủy xác nhận đã trả lương tháng ${month.slice(5)}/${month.slice(0, 4)} của ${u.name}?`)) return;
        await api('/payroll/paid', { method: 'POST', body: { month, user_id: u.id, paid: false } });
        toast('Đã hủy đánh dấu trả lương');
        close();
        if (reload) reload();
      })) : null));
}

function salaryCard(r, month, reload) {
  const paidMethodLabel = r.paid ? (r.paid.method === 'cash' ? '💵 Tiền mặt' : '🏦 Chuyển khoản') : '';
  return h('div', { class: 'card' },
    r.paid ? h('div', { class: 'okbox' },
      `💸 Đã thanh toán lương (${paidMethodLabel}${r.paid.amount ? ' · ' + fmtMoney(r.paid.amount) : ''} · ${fmtDateTime(r.paid.paid_at)}${r.paid.note ? ' · ' + r.paid.note : ''})`) : null,
    r.pending_reports ? h('div', { class: 'warnbox' }, `Còn ${r.pending_reports} báo công chờ duyệt, chưa được tính vào lương.`) : null,
    h('div', { class: 'kv' }, h('span', {}, 'Số công (đã duyệt)'), h('strong', {}, fmtNum(r.work_days))),
    h('div', { class: 'kv' }, h('span', {}, 'Tiền công'), h('span', {}, fmtMoney(r.wage_amount))),
    h('div', { class: 'kv' }, h('span', {}, `Tăng ca (${fmtNum(r.ot_hours)} giờ)`), h('span', {}, fmtMoney(r.ot_amount))),
    r.allowance_total ? h('div', { class: 'kv' }, h('span', {}, '💰 Phụ cấp'), h('span', { class: 'plus' }, '+' + fmtMoney(r.allowance_total))) : null,
    r.bonus_total ? h('div', { class: 'kv' }, h('span', {}, '🎉 Thưởng'), h('span', { class: 'plus' }, '+' + fmtMoney(r.bonus_total))) : null,
    r.penalty_total ? h('div', { class: 'kv' }, h('span', {}, '⚠️ Phạt'), h('span', { class: 'minus' }, '−' + fmtMoney(r.penalty_total))) : null,
    h('div', { class: 'kv' }, h('strong', {}, 'Tổng lương'), h('strong', {}, fmtMoney(r.gross))),
    h('div', { class: 'kv' }, h('span', {}, 'Đã ứng'), h('span', { class: 'minus' }, '−' + fmtMoney(r.advance_total))),
    h('div', { class: 'kv total' }, h('span', {}, 'Thực lĩnh'), h('span', {}, fmtMoney(r.net))),
    r.user.bank_account
      ? h('div', { class: 'small muted mt' }, `🏦 Nhận lương: ${r.user.bank_name} · STK: ${r.user.bank_account} (${r.user.bank_holder || stripVN(r.user.name)})`)
      : null,
    h('div', { class: 'small muted mt' }, `Mức hiện tại: ${fmtMoney(r.user.daily_wage)}/ngày · ${fmtMoney(r.user.ot_rate)}/giờ tăng ca`),
    month ? h('div', { class: 'grid2 mt' },
      h('button', { class: 'btn-primary', onclick: () => showPayslip(r, month) }, '🧾 Xem phiếu lương'),
      h('button', { class: '', onclick: () => openVietQRModal(r, month, reload) }, '🏧 Mã QR Chuyển lương')) : null);
}

function adjustmentItem(j, onDelete) {
  return h('div', { class: 'item row between' },
    h('div', { class: 'grow' },
      h('div', {}, KIND_IC[j.kind] + ' ', h('strong', {}, KIND[j.kind]), ' · ',
        h('strong', { class: j.kind === 'penalty' ? 'minus' : 'plus' }, (j.kind === 'penalty' ? '−' : '+') + fmtMoney(j.amount)),
        j.user_name && onDelete ? ' · ' + j.user_name : ''),
      h('div', { class: 'small muted' }, fmtDate(j.adj_date), j.reason ? ' · ' + j.reason : '')),
    onDelete ? h('button', { class: 'btn-sm btn-bad', onclick: () => onDelete().catch(fail) }, 'Xóa') : null);
}

// ================= Phiếu lương (ảnh PNG để gửi Zalo / in) =================
function drawPayslip(r, month) {
  const W = 900, P = 48;
  const lines = [
    ['Số công (đã duyệt)', fmtNum(r.work_days) + ' công'],
    ['Lương 1 ngày', fmtMoney(r.user.daily_wage)],
    ['Tiền công', fmtMoney(r.wage_amount)],
    [`Tăng ca (${fmtNum(r.ot_hours)} giờ × ${fmtMoney(r.user.ot_rate)})`, fmtMoney(r.ot_amount)],
  ];
  if (r.allowance_total) lines.push(['Phụ cấp', '+' + fmtMoney(r.allowance_total), '#059669']);
  if (r.bonus_total) lines.push(['Thưởng', '+' + fmtMoney(r.bonus_total), '#059669']);
  if (r.penalty_total) lines.push(['Phạt', '−' + fmtMoney(r.penalty_total), '#dc2626']);
  lines.push(['TỔNG LƯƠNG', fmtMoney(r.gross), null, true]);
  lines.push(['Đã ứng', '−' + fmtMoney(r.advance_total), '#dc2626']);
  if (r.user.bank_account) {
    lines.push(['Tài khoản nhận lương', `${r.user.bank_name} · ${r.user.bank_account}`]);
  }
  const adj = r.adjustments || [];
  const RH = 58, headH = 230, totalH = 120;
  const adjH = adj.length ? 50 + adj.length * 40 : 0;
  const H = headH + 40 + lines.length * RH + 30 + totalH + adjH + 120;
  const dpr = 2;
  const c = document.createElement('canvas'); c.width = W * dpr; c.height = H * dpr;
  const x = c.getContext('2d'); x.scale(dpr, dpr);
  const font = (w, s) => `${w} ${s}px system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
  const rr = (X, Y, w, hh, rad) => { x.beginPath(); if (x.roundRect) x.roundRect(X, Y, w, hh, rad); else x.rect(X, Y, w, hh); };

  x.fillStyle = '#ffffff'; x.fillRect(0, 0, W, H);
  // Đầu phiếu
  const g = x.createLinearGradient(0, 0, W, headH);
  g.addColorStop(0, '#2563eb'); g.addColorStop(.55, '#4f46e5'); g.addColorStop(1, '#7c3aed');
  x.fillStyle = g; x.fillRect(0, 0, W, headH);
  x.fillStyle = 'rgba(255,255,255,.1)'; x.beginPath(); x.arc(W - 60, 30, 140, 0, Math.PI * 2); x.fill();
  x.fillStyle = 'rgba(255,255,255,.2)'; rr(P, 40, 76, 76, 20); x.fill();
  x.fillStyle = '#fff'; x.font = font(800, 26); x.textAlign = 'center'; x.fillText(BRAND.team, P + 38, 88);
  x.textAlign = 'left';
  x.font = font(800, 34); x.fillText('PHIẾU LƯƠNG', P + 100, 72);
  x.font = font(500, 20); x.globalAlpha = .9; x.fillText(`Tháng ${month.slice(5)}/${month.slice(0, 4)} · ${BRAND.app}`, P + 100, 104); x.globalAlpha = 1;
  x.font = font(700, 28); x.fillText(r.user.name, P, 172);
  x.font = font(400, 19); x.globalAlpha = .85; x.fillText('SĐT: ' + r.user.phone, P, 202); x.globalAlpha = 1;
  if (r.paid) {
    const stampTxt = r.paid.method === 'cash' ? '✓ ĐÃ TRẢ TIỀN MẶT' : '✓ ĐÃ CHUYỂN KHOẢN';
    x.fillStyle = 'rgba(16,185,129,.95)'; rr(W - P - 235, 152, 235, 44, 12); x.fill();
    x.fillStyle = '#fff'; x.font = font(800, 18); x.textAlign = 'center'; x.fillText(stampTxt, W - P - 117, 181);
  }

  // Các dòng
  let yy = headH + 40;
  for (const [label, val, color, bold] of lines) {
    if (bold) { x.fillStyle = '#f1f5ff'; rr(P - 14, yy - 2, W - 2 * P + 28, RH - 8, 12); x.fill(); }
    x.fillStyle = '#334155'; x.font = font(bold ? 800 : 500, 22); x.textAlign = 'left'; x.fillText(label, P, yy + 34);
    x.fillStyle = color || '#0f1b2d'; x.font = font(bold ? 800 : 600, 22); x.textAlign = 'right'; x.fillText(val, W - P, yy + 34);
    if (!bold) { x.strokeStyle = '#e5eaf2'; x.setLineDash([6, 6]); x.beginPath(); x.moveTo(P, yy + RH - 4); x.lineTo(W - P, yy + RH - 4); x.stroke(); x.setLineDash([]); }
    yy += RH;
  }
  // Thực lĩnh
  yy += 20;
  const g2 = x.createLinearGradient(P, yy, W - P, yy + 90);
  g2.addColorStop(0, '#2563eb'); g2.addColorStop(1, '#7c3aed');
  x.fillStyle = g2; rr(P, yy, W - 2 * P, 92, 20); x.fill();
  x.fillStyle = '#fff'; x.textAlign = 'left'; x.font = font(700, 24); x.fillText('THỰC LĨNH', P + 28, yy + 56);
  x.textAlign = 'right'; x.font = font(800, 36); x.fillText(fmtMoney(r.net), W - P - 28, yy + 60);
  yy += totalH;
  // Chi tiết thưởng phạt
  if (adj.length) {
    x.textAlign = 'left'; x.fillStyle = '#64748b'; x.font = font(700, 18); x.fillText('CHI TIẾT THƯỞNG / PHỤ CẤP / PHẠT', P, yy + 20);
    yy += 50;
    for (const j of adj) {
      x.fillStyle = '#334155'; x.font = font(400, 18); x.textAlign = 'left';
      x.fillText(`${j.adj_date.slice(8, 10)}/${j.adj_date.slice(5, 7)} · ${KIND[j.kind]}${j.reason ? ' – ' + j.reason : ''}`.slice(0, 60), P, yy);
      x.fillStyle = j.kind === 'penalty' ? '#dc2626' : '#059669'; x.textAlign = 'right';
      x.fillText((j.kind === 'penalty' ? '−' : '+') + fmtMoney(j.amount), W - P, yy);
      yy += 40;
    }
  }
  // Chân phiếu
  const now = new Date();
  x.textAlign = 'center'; x.fillStyle = '#94a3b8'; x.font = font(400, 16);
  x.fillText(`Lập lúc ${pad(now.getHours())}:${pad(now.getMinutes())} ${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}` +
    (r.pending_reports ? ` · còn ${r.pending_reports} báo công chờ duyệt` : ''), W / 2, H - 70);
  x.fillText(`${BRAND.app} · Nhóm ${BRAND.team} · Phát triển bởi ${BRAND.dev}`, W / 2, H - 42);
  return c;
}

function showPayslip(r, month) {
  const canvas = drawPayslip(r, month);
  const fileName = `phieu-luong-${month}-${r.user.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').replace(/\s+/g, '-').toLowerCase()}.png`;
  const img = h('img', { class: 'payslip-img', src: canvas.toDataURL('image/png'), alt: 'Phiếu lương' });
  const getBlob = () => new Promise((res) => canvas.toBlob(res, 'image/png'));
  const canShare = !!(navigator.canShare && navigator.canShare({ files: [new File([new Blob()], 'a.png', { type: 'image/png' })] }));
  openModal('Phiếu lương', h('div', {},
    img,
    h('div', { class: 'grid2 mt' },
      canShare ? actionBtn('📤 Gửi Zalo…', 'btn-primary', async () => {
        const file = new File([await getBlob()], fileName, { type: 'image/png' });
        try { await navigator.share({ files: [file], title: 'Phiếu lương ' + month }); } catch (e) { if (e.name !== 'AbortError') throw e; }
      }) : null,
      actionBtn('⬇ Tải ảnh', canShare ? '' : 'btn-primary', async () => {
        const url = URL.createObjectURL(await getBlob());
        const a = h('a', { href: url, download: fileName }); document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }),
      actionBtn('🖨 In', '', async () => {
        const w = window.open('', '_blank');
        if (!w) throw new Error('Trình duyệt chặn cửa sổ in');
        w.document.write(`<title>${fileName}</title><body style="margin:0"><img src="${img.src}" style="width:100%" onload="setTimeout(()=>print(),200)">`);
        w.document.close();
      })),
    h('div', { class: 'small muted mt center' }, canShare ? 'Bấm "Gửi Zalo…" rồi chọn Zalo trong danh sách.' : 'Tải ảnh về rồi gửi qua Zalo.')));
}

// ================= Tài khoản (chung) =================
async function viewAccount(box) {
  const oldP = h('input', { type: 'password', autocomplete: 'current-password' });
  const newP = h('input', { type: 'password', autocomplete: 'new-password' });
  const btn = h('button', { class: 'btn-primary', type: 'submit' }, 'Đổi mật khẩu');
  const cur = getTheme();
  const themeSeg = h('div', { class: 'seg' }, [['auto', '🌗 Tự động'], ['light', '☀️ Sáng'], ['dark', '🌙 Tối']].map(([v, l]) =>
    h('label', {}, h('input', { type: 'radio', name: 'theme', value: v, checked: v === cur, onchange: () => setTheme(v) }), l)));
  const notifyCard = h('div', { class: 'card' }, h('h2', {}, '🔔 Thông báo'), h('div', { class: 'muted small' }, 'Đang kiểm tra…'));
  const reminderCard = isAdmin() ? h('div', { class: 'card' }, h('h2', {}, '⏰ Nhắc báo công hằng ngày'), h('div', { class: 'muted small' }, 'Đang tải…')) : null;
  const backupCard = isAdmin() ? h('div', { class: 'card' }, h('h2', {}, '💾 Sao lưu dữ liệu'), h('div', { class: 'muted small' }, 'Đang tải…')) : null;

  // Thẻ cài đặt tài khoản ngân hàng nhận lương (VietQR)
  const bankSel = h('select', {},
    h('option', { value: '' }, '— Chọn ngân hàng nhận lương —'),
    BANKS.map(([bin, name]) => h('option', { value: bin, selected: bin === (state.me.bank_bin || '') }, name)));
  const bankAcc = h('input', { value: state.me.bank_account || '', placeholder: 'Nhập số tài khoản ngân hàng', inputmode: 'numeric' });
  const bankHolder = h('input', { value: state.me.bank_holder || stripVN(state.me.name), placeholder: 'VD: NGUYEN VAN A' });
  const bankCard = state.me.id ? h('div', { class: 'card' },
    h('h2', {}, '🏧 Tài khoản Ngân hàng nhận lương (VietQR)'),
    h('div', { class: 'small muted', style: 'margin-bottom:10px' }, 'Điền số tài khoản để Quản lý quét mã QR chuyển khoản lương chính xác từng đồng.'),
    field('Ngân hàng', bankSel),
    h('div', { class: 'grid2' },
      field('Số tài khoản', bankAcc),
      field('Chủ tài khoản (không dấu)', bankHolder)),
    actionBtn('💾 Lưu thông tin ngân hàng', 'btn-primary', async () => {
      const bName = BANKS.find((b) => b[0] === bankSel.value)?.[1] || '';
      const updated = await api('/me/bank', {
        method: 'PUT',
        body: {
          bank_bin: bankSel.value,
          bank_name: bName,
          bank_account: bankAcc.value.trim(),
          bank_holder: bankHolder.value.trim().toUpperCase(),
        },
      });
      Object.assign(state.me, updated);
      toast('✅ Đã lưu tài khoản ngân hàng nhận lương!');
    })) : null;

  box.replaceChildren(
    h('div', { class: 'card profile' },
      h('div', { class: 'avatar xl' }, initials(state.me.name)),
      h('div', { class: 'grow' },
        h('h2', { style: 'margin:0 0 2px' }, state.me.name),
        h('div', { class: 'muted row', style: 'gap:6px' }, icon('phone', 15), state.me.phone),
        h('span', { class: 'badge ' + (isAdmin() ? 'b-approved' : 'b-pending'), style: 'margin-top:6px' }, isAdmin() ? '👑 Quản lý' : '👷 Nhân viên'))),
    bankCard,
    h('div', { class: 'card' }, h('h2', {}, '🎨 Giao diện'), themeSeg),
    notifyCard,
    reminderCard,
    backupCard,
    h('form', {
      class: 'card', onsubmit: async (e) => {
        e.preventDefault(); btn.disabled = true;
        try {
          await api('/me/password', { method: 'POST', body: { old_password: oldP.value, new_password: newP.value } });
          toast('Đã đổi mật khẩu'); oldP.value = newP.value = '';
        } catch (ex) { fail(ex); } finally { btn.disabled = false; }
      },
    }, h('h2', {}, 'Đổi mật khẩu'), field('Mật khẩu cũ', oldP), field('Mật khẩu mới', newP, 'Tối thiểu 6 ký tự'), btn),
    h('div', { class: 'card' },
      h('div', { class: 'small muted', style: 'margin-bottom:10px' }, 'Mẹo: trên điện thoại, bấm menu trình duyệt → "Thêm vào màn hình chính" để mở nhanh như ứng dụng.'),
      actionBtn('Đăng xuất', 'btn-bad btn-block', async () => {
        await api('/logout', { method: 'POST' }); state.me = null; location.hash = ''; renderAuth();
      })),
    h('div', { class: 'card about' },
      h('div', { class: 'row', style: 'margin-bottom:12px' }, logoMark(),
        h('div', {}, h('strong', {}, BRAND.app), h('div', { class: 'small muted' }, BRAND.slogan))),
      h('div', { class: 'kv' }, h('span', { class: 'row', style: 'gap:8px' }, icon('users', 17), 'Nhóm'), h('strong', {}, BRAND.team)),
      h('div', { class: 'kv' }, h('span', { class: 'row', style: 'gap:8px' }, icon('code', 17), 'Phát triển bởi'),
        BRAND.devLink ? h('a', { href: BRAND.devLink, target: '_blank', rel: 'noopener' }, BRAND.dev) : h('strong', {}, BRAND.dev)),
      h('div', { class: 'kv' }, h('span', { class: 'row', style: 'gap:8px' }, icon('shield', 17), 'Phiên bản'), h('span', {}, 'v' + BRAND.version)),
      credit()));

  renderNotifyCard(notifyCard);
  if (reminderCard) renderReminderCard(reminderCard);
  if (backupCard) renderBackupCard(backupCard, false);
}

async function renderBackupCard(card, allowRestore = false) {
  try {
    const data = await api('/backups');
    const kb = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
    const fileIn = h('input', {
      type: 'file',
      accept: '.db,.sqlite,.sqlite3',
      class: 'hidden',
      onchange: async (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        const restoreNow = confirmBox(`Bạn đã chọn file "${f.name}".\n\nBấm OK để KHÔI PHỤC NGAY dữ liệu từ file này (hệ thống sẽ tự động tạo 1 bản sao lưu an toàn trước khi khôi phục).\nBấm Hủy nếu không muốn thực hiện.`);
        if (!restoreNow) { fileIn.value = ''; return; }
        try {
          const fd = new FormData();
          fd.append('backup', f);
          fd.append('restore_now', '1');
          const r = await api('/admin/backups/upload', { method: 'POST', form: fd });
          toast(`♻️ Đã khôi phục dữ liệu từ "${f.name}"! (Bản lưu trước đó: ${r.pre_backup})`);
          renderBackupCard(card, allowRestore);
          if (isAdminPortalUrl()) routeWebAdmin();
        } catch (err) {
          fail(err);
        } finally {
          fileIn.value = '';
        }
      },
    });

    card.replaceChildren(
      h('div', { class: 'row between wrap' },
        h('h2', { style: 'margin:0' }, '💾 Sao lưu & Khôi phục Dữ liệu'),
        h('div', { class: 'row wrap', style: 'gap:6px' },
          allowRestore ? fileIn : null,
          allowRestore ? h('button', { class: 'btn-sm', onclick: () => fileIn.click() }, '📤 Tải file .db lên') : null,
          actionBtn('+ Sao lưu ngay', 'btn-primary btn-sm', async () => {
            await api('/backups', { method: 'POST' });
            toast('✅ Đã tạo bản sao lưu mới'); renderBackupCard(card, allowRestore);
          }))),
      h('div', { class: 'small muted mt' },
        `Cơ sở dữ liệu: ${kb(data.db_size)} · ${data.photo_count} ảnh báo công · Tự động sao lưu mỗi ngày (giữ 15 bản gần nhất)`),
      h('div', { class: 'mt' },
        data.backups.length ? data.backups.slice(0, 8).map((b) => h('div', { class: 'item row between wrap' },
          h('div', {},
            h('strong', { class: 'small' }, b.name),
            h('div', { class: 'small muted' }, `${kb(b.size)} · ${fmtDateTime(b.created_at.slice(0, 19).replace('T', ' '))}`)),
          h('div', { class: 'row wrap', style: 'gap:6px' },
            allowRestore ? actionBtn('♻️ Khôi phục', 'btn-sm btn-ok', async () => {
              if (!confirmBox(`Khôi phục toàn bộ dữ liệu về thời điểm của bản sao lưu "${b.name}"?\n\n(Hệ thống sẽ tự động tạo một bản sao lưu "pre-restore" trạng thái hiện tại trước khi khôi phục).`)) return;
              const r = await api('/admin/backups/restore/' + encodeURIComponent(b.name), { method: 'POST' });
              toast(`♻️ Đã khôi phục thành công bản "${b.name}"!`);
              if (isAdminPortalUrl()) routeWebAdmin();
              else renderBackupCard(card, allowRestore);
            }) : null,
            h('a', { class: 'btn btn-sm', href: '/api/backups/' + b.name, download: b.name }, '⬇ Tải'),
            actionBtn('🗑', 'btn-sm btn-bad', async () => {
              if (!confirmBox('Xóa bản sao lưu ' + b.name + '?')) return;
              await api('/backups/' + b.name, { method: 'DELETE' }); renderBackupCard(card, allowRestore);
            })))) : h('div', { class: 'empty' }, 'Chưa có bản sao lưu')));
  } catch (e) {
    card.replaceChildren(h('h2', {}, '💾 Sao lưu dữ liệu'), h('div', { class: 'errbox' }, e.message));
  }
}

// ----- Thông báo đẩy -----
function b64ToBytes(b64) {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (ch) => ch.charCodeAt(0));
}
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;

async function renderNotifyCard(card) {
  const head = h('h2', {}, '🔔 Thông báo');
  const desc = isAdmin()
    ? 'Nhận thông báo trên điện thoại này.'
    : 'Nhận nhắc nhở khi quên báo công, và báo khi được duyệt / từ chối / thưởng / phạt.';
  if (!window.isSecureContext) return card.replaceChildren(head, h('div', { class: 'warnbox' }, 'Cần chạy HTTPS để bật thông báo.'));
  if (!pushSupported()) {
    return card.replaceChildren(head, h('div', { class: 'warnbox' },
      isIOS() && !isStandalone()
        ? 'Trên iPhone: bấm nút Chia sẻ → "Thêm vào MH chính", rồi mở app từ màn hình chính để bật thông báo.'
        : 'Trình duyệt này không hỗ trợ thông báo. Hãy dùng Chrome.'));
  }
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    const { publicKey } = await api('/push/key');
    const on = !!sub && Notification.permission === 'granted';
    card.replaceChildren(head,
      h('div', { class: 'small muted', style: 'margin-bottom:12px' }, desc),
      Notification.permission === 'denied'
        ? h('div', { class: 'errbox' }, 'Bạn đã chặn thông báo. Vào cài đặt trình duyệt → Quyền trang web → Thông báo → Cho phép.')
        : h('div', { class: 'row wrap' },
          on ? h('span', { class: 'badge b-approved' }, '✓ Đang bật') : h('span', { class: 'badge b-off' }, 'Đang tắt'),
          h('span', { class: 'grow' }),
          on ? actionBtn('Gửi thử', 'btn-sm', async () => { await api('/push/test', { method: 'POST' }); toast('Đã gửi, chờ vài giây…'); }) : null,
          on
            ? actionBtn('Tắt', 'btn-sm btn-bad', async () => {
              await api('/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } });
              await sub.unsubscribe(); toast('Đã tắt thông báo'); renderNotifyCard(card);
            })
            : actionBtn('Bật thông báo', 'btn-sm btn-primary', async () => {
              const perm = await Notification.requestPermission();
              if (perm !== 'granted') throw new Error('Bạn chưa cho phép thông báo');
              const s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
              await api('/push/subscribe', { method: 'POST', body: s.toJSON() });
              toast('🔔 Đã bật thông báo'); renderNotifyCard(card);
            })));
  } catch (e) {
    card.replaceChildren(head, h('div', { class: 'errbox' }, 'Không bật được thông báo: ' + e.message));
  }
}

async function renderReminderCard(card) {
  const cfg = await api('/settings/reminder');
  const enabled = h('input', { type: 'checkbox', checked: cfg.enabled });
  const time = h('input', { type: 'time', value: cfg.time, style: 'max-width:150px' });
  card.replaceChildren(
    h('h2', {}, '⏰ Nhắc báo công hằng ngày'),
    h('div', { class: 'small muted', style: 'margin-bottom:12px' }, 'Đến giờ này, ai chưa báo công (và đã bật thông báo) sẽ nhận được lời nhắc.'),
    h('label', { class: 'f row' }, enabled, h('span', { style: 'margin:0' }, 'Bật nhắc tự động')),
    field('Giờ nhắc', time),
    h('div', { class: 'row wrap' },
      actionBtn('Lưu', 'btn-primary', async () => {
        await api('/settings/reminder', { method: 'PUT', body: { enabled: enabled.checked, time: time.value } });
        toast('Đã lưu giờ nhắc');
      }),
      actionBtn('📣 Nhắc ngay bây giờ', '', async () => {
        const r = await api('/push/remind-now', { method: 'POST' });
        toast(r.count ? `Đã nhắc ${r.count} người` : 'Không có ai cần nhắc (hoặc họ chưa bật thông báo)');
      })));
}

// ----- Chế độ sáng / tối -----
function getTheme() { return localStorage.getItem('theme') || 'auto'; }
function applyTheme() {
  const t = getTheme();
  document.documentElement.dataset.theme = t;
  const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#0b1220' : '#4f46e5');
}
function setTheme(t) { localStorage.setItem('theme', t); applyTheme(); }
applyTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);

// ================= QUẢN LÝ: Duyệt =================
function makeReportFilterBar(container) {
  const qIn = h('input', { type: 'search', placeholder: '🔍 Tìm nhanh theo tên nhân viên, công trình, ghi chú…' });
  const siteSel = h('select', { style: 'max-width:210px' },
    h('option', { value: '' }, '🏗️ Tất cả công trình'),
    state.sites.map((s) => h('option', { value: String(s.id) }, s.name)));
  const apply = () => {
    const q = qIn.value.trim().toLowerCase();
    const sid = siteSel.value;
    container.querySelectorAll('.item[data-search]').forEach((el) => {
      const matchQ = !q || (el.getAttribute('data-search') || '').includes(q);
      const matchS = !sid || el.getAttribute('data-site') === sid;
      el.classList.toggle('hidden', !(matchQ && matchS));
    });
  };
  qIn.addEventListener('input', apply);
  siteSel.addEventListener('change', apply);
  return h('div', { class: 'search-bar' }, qIn, siteSel);
}

async function viewReview(box, tab = 'pending', date = null) {
  await refreshStats();
  const s = state.stats;
  const content = h('div', {});
  const tabs = h('div', { class: 'tabs' },
    h('button', { class: tab === 'pending' ? 'on' : '', onclick: () => viewReview(box, 'pending') }, `⏳ Chờ duyệt (${s.pending_reports})`),
    h('button', { class: tab === 'day' ? 'on' : '', onclick: () => viewReview(box, 'day', date || s.today) }, '📅 Xem theo ngày'));

  const notReported = s.not_reported_today;
  box.replaceChildren(
    h('div', { class: 'stats' },
      h('div', { class: 'stat' + (s.pending_reports ? ' alert' : '') }, h('div', { class: 'n' }, s.pending_reports), h('div', { class: 'l' }, 'Báo công chờ duyệt')),
      h('div', { class: 'stat' }, h('div', { class: 'n' }, `${s.workers - notReported.length}/${s.workers}`), h('div', { class: 'l' }, 'Đã báo công hôm nay')),
      h('div', { class: 'stat' + (s.pending_advances ? ' alert' : '') }, h('div', { class: 'n' }, s.pending_advances), h('div', { class: 'l' }, 'Yêu cầu ứng tiền'))),
    notReported.length ? h('details', { class: 'card' },
      h('summary', {}, h('strong', {}, `⚠️ ${notReported.length} nhân viên chưa báo công hôm nay`)),
      h('div', { class: 'mt' }, notReported.map((u) => h('div', { class: 'row between item' },
        h('div', { class: 'row' }, h('div', { class: 'avatar sm' }, initials(u.name)), h('strong', {}, u.name)),
        h('a', { href: 'tel:' + u.phone, class: 'btn btn-sm btn-primary' }, '📞 Gọi ngay'))))) : null,
    tabs, content);

  if (tab === 'pending') {
    const list = await api('/reports?status=pending');
    const listWrap = h('div', {});
    const card = h('div', { class: 'card' });
    if (!list.length) card.append(h('div', { class: 'empty' }, '🎉 Tuyệt vời! Không có báo công nào tồn đọng chờ duyệt.'));
    else {
      card.append(
        h('div', { class: 'row between wrap', style: 'margin-bottom:12px' },
          h('strong', {}, `Danh sách chờ duyệt (${list.length})`),
          actionBtn(`✓ Duyệt tất cả (${list.length})`, 'btn-ok btn-sm', async () => {
            if (!confirmBox(`Duyệt tất cả ${list.length} báo công?`)) return;
            await api('/reports/review', { method: 'POST', body: { ids: list.map((r) => r.id), status: 'approved' } });
            toast('Đã duyệt tất cả'); viewReview(box);
          })),
        makeReportFilterBar(listWrap),
        listWrap);
      for (const r of list) listWrap.append(reviewItem(r, () => viewReview(box)));
    }
    content.append(card);
  } else {
    const d = date || s.today;
    const list = await api('/reports?date=' + d);
    const listWrap = h('div', {}, list.length ? list.map((r) => reviewItem(r, () => viewReview(box, 'day', d))) : h('div', { class: 'empty' }, 'Không có báo công ngày này'));
    content.append(h('div', { class: 'card' },
      h('div', { class: 'row between wrap', style: 'margin-bottom:12px' },
        h('input', { type: 'date', value: d, max: s.today, style: 'max-width:190px', onchange: (e) => e.target.value && viewReview(box, 'day', e.target.value) }),
        h('span', { class: 'badge b-approved' }, `${list.length} báo công`)),
      list.length ? makeReportFilterBar(listWrap) : null,
      listWrap));
  }
}

/** Dòng báo công có nút duyệt / từ chối / sửa. */
function reviewItem(r, reload) {
  const review = async (status) => {
    let note = '';
    if (status === 'rejected') {
      note = window.prompt('Lý do từ chối (nhân viên sẽ thấy):', '');
      if (note == null) return;
      if (!note.trim()) return toast('Cần nhập lý do từ chối', true);
    }
    await api('/reports/review', { method: 'POST', body: { ids: [r.id], status, note } });
    toast(status === 'approved' ? 'Đã duyệt' : status === 'rejected' ? 'Đã từ chối' : 'Đã chuyển về chờ duyệt');
    reload();
  };
  const actions = [];
  if (r.status !== 'approved') actions.push(actionBtn('✓ Duyệt', 'btn-ok btn-sm', () => review('approved')));
  if (r.status !== 'rejected') actions.push(actionBtn('✕ Từ chối', 'btn-bad btn-sm', () => review('rejected')));
  if (r.status !== 'pending') actions.push(actionBtn('↺ Bỏ duyệt', 'btn-sm', () => review('pending')));
  actions.push(h('button', { class: 'btn-sm', onclick: () => editReport(r, reload) }, '✎ Sửa'));
  return reportItem(r, { showName: true, actions });
}

function editReport(r, reload) {
  const type = h('select', {}, Object.entries(TYPE).map(([v, l]) => h('option', { value: v, selected: v === r.day_type }, l)));
  const site = h('select', {}, h('option', { value: '' }, '—'),
    state.sites.map((s) => h('option', { value: s.id, selected: s.id === r.site_id }, s.name)));
  const ci = h('input', { type: 'time', value: r.check_in || '' });
  const co = h('input', { type: 'time', value: r.check_out || '' });
  const ot = h('input', { type: 'number', step: 0.25, min: 0, max: 16, value: r.ot_hours });
  const note = h('textarea', { value: r.note || '' });
  let close;
  const body = h('div', {},
    h('div', { class: 'muted', style: 'margin-bottom:12px' }, `${r.user_name} · ${fmtDate(r.work_date)}`),
    field('Loại công', type), field('Công trình', site),
    h('div', { class: 'grid2' }, field('Giờ vào', ci), field('Giờ ra', co)),
    field('Tăng ca (giờ)', ot), field('Ghi chú', note),
    actionBtn('Lưu', 'btn-primary btn-block', async () => {
      await api('/reports/' + r.id, { method: 'PUT', body: {
        day_type: type.value, site_id: site.value || null, check_in: ci.value || null, check_out: co.value || null,
        ot_hours: Number(ot.value || 0), note: note.value } });
      toast('Đã lưu'); close(); reload();
    }),
    h('div', { class: 'mt' }, actionBtn('Xóa báo công này', 'btn-bad btn-block', async () => {
      if (!confirmBox('Xóa hẳn báo công này?')) return;
      await api('/reports/' + r.id, { method: 'DELETE' }); toast('Đã xóa'); close(); reload();
    })));
  close = openModal('Sửa báo công', body);
}

// ================= QUẢN LÝ: Bảng công / lương =================
async function viewPayroll(box, month = thisMonth(), tab = 'table') {
  const data = await api('/payroll?month=' + month);
  const sum = (k) => data.rows.reduce((s, r) => s + r[k], 0);
  const pendingTotal = sum('pending_reports');
  const reload = () => viewPayroll(box, month, tab);
  const content = h('div', {});
  const isLocked = !!data.locked;
  const totalWorkers = data.rows.length;
  const paidWorkers = data.rows.filter((r) => r.paid).length;
  const paidPct = totalWorkers ? Math.round((paidWorkers / totalWorkers) * 100) : 0;

  box.replaceChildren(
    h('div', { class: 'card' },
      h('div', { class: 'row between wrap' },
        monthPicker(month, (m) => viewPayroll(box, m, tab)),
        h('div', { class: 'row wrap' },
          actionBtn(isLocked ? '🔓 Mở khóa sổ' : '🔒 Chốt sổ tháng', isLocked ? 'btn-sm' : 'btn-sm btn-ok', async () => {
            if (isLocked) {
              if (!confirmBox(`Mở khóa sổ tháng ${month.slice(5)}/${month.slice(0, 4)} để cho phép chỉnh sửa lại?`)) return;
              await api('/payroll/lock', { method: 'POST', body: { month, locked: false } });
              toast('🔓 Đã mở khóa sổ tháng'); reload();
            } else {
              if (pendingTotal && !confirmBox(`Tháng này còn ${pendingTotal} báo công chờ duyệt. Vẫn chốt sổ?`)) return;
              const note = window.prompt('Ghi chú chốt sổ (không bắt buộc):', '') ?? null;
              if (note === null) return;
              await api('/payroll/lock', { method: 'POST', body: { month, locked: true, note } });
              toast('🔒 Đã chốt sổ tháng ' + month.slice(5) + '/' + month.slice(0, 4)); reload();
            }
          }),
          !isLocked ? h('button', { class: 'btn btn-sm', onclick: () => adjustmentModal(data.rows.map((r) => r.user).filter((u) => u.active), null, reload, month) }, '🎁 Thưởng/Phạt') : null,
          h('button', { class: 'btn btn-ok btn-sm', onclick: () => viewPayroll(box, month, 'paysheet') }, '🧾 Bảng Ký nhận & QR'),
          h('a', { class: 'btn btn-primary btn-sm', href: '/api/export?month=' + month, download: `bang-cong-${month}.xlsx` }, '⬇ Xuất Excel'))),
      totalWorkers ? h('div', { class: 'mt' },
        h('div', { class: 'row between small' },
          h('span', { class: 'muted' }, `💸 Tiến độ thanh toán lương tháng ${month.slice(5)}/${month.slice(0, 4)}`),
          h('strong', {}, `${paidWorkers}/${totalWorkers} nhân viên (${paidPct}%)`)),
        h('div', { class: 'progress-track' },
          h('div', { class: 'progress-fill', style: `width:${paidPct}%` }))) : null,
      isLocked ? h('div', { class: 'okbox mt' }, `🔒 Đã chốt sổ tháng (${fmtDateTime(data.locked.locked_at)} bởi ${data.locked.locked_by_name || 'Quản lý'}${data.locked.note ? ' · ' + data.locked.note : ''}) – dữ liệu tháng này được bảo vệ, không bị sửa/xóa nhầm.`) : null,
      pendingTotal ? h('div', { class: 'warnbox mt' }, `Còn ${pendingTotal} báo công chờ duyệt trong tháng này – chưa tính vào lương.`) : null),
    h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('div', { class: 'n' }, fmtNum(sum('work_days'))), h('div', { class: 'l' }, 'Tổng công')),
      h('div', { class: 'stat' }, h('div', { class: 'n', style: 'font-size:18px' }, fmtMoney(sum('gross'))), h('div', { class: 'l' }, 'Tổng lương')),
      h('div', { class: 'stat' }, h('div', { class: 'n', style: 'font-size:18px' }, fmtMoney(sum('net'))), h('div', { class: 'l' }, 'Còn phải trả'))),
    h('div', { class: 'tabs' },
      h('button', { class: tab === 'table' ? 'on' : '', onclick: () => viewPayroll(box, month, 'table') }, '📋 Bảng lương chi tiết'),
      h('button', { class: tab === 'paysheet' ? 'on' : '', onclick: () => viewPayroll(box, month, 'paysheet') }, '🧾 Ký nhận & QR Hàng loạt'),
      h('button', { class: tab === 'matrix' ? 'on' : '', onclick: () => viewPayroll(box, month, 'matrix') }, '📑 Chấm công Ma trận (1→31)'),
      h('button', { class: tab === 'chart' ? 'on' : '', onclick: () => viewPayroll(box, month, 'chart') }, '📈 Biểu đồ phân tích')),
    content);

  if (tab === 'chart') return renderCharts(content, month, data);
  if (tab === 'matrix') return renderAttendanceMatrix(content, data, month, reload);
  if (tab === 'paysheet') return renderPayrollPaymentSheet(content, data, month, reload);

  let payFilter = 'all';
  const applyTableFilter = () => {
    const q = (searchIn.value || '').trim().toLowerCase();
    content.querySelectorAll('tbody tr').forEach((tr) => {
      const matchQ = !q || (tr.getAttribute('data-name') || '').includes(q);
      const isPaid = tr.getAttribute('data-paid') === '1';
      const matchP = payFilter === 'all' || (payFilter === 'paid' && isPaid) || (payFilter === 'unpaid' && !isPaid);
      tr.classList.toggle('hidden', !(matchQ && matchP));
    });
  };

  const searchIn = h('input', {
    type: 'search',
    placeholder: '🔍 Tìm nhanh nhân viên theo tên hoặc SĐT…',
    oninput: applyTableFilter,
  });

  const filterSel = h('select', {
    style: 'max-width:210px',
    onchange: (e) => { payFilter = e.target.value; applyTableFilter(); },
  },
  h('option', { value: 'all' }, `👥 Tất cả (${totalWorkers})`),
  h('option', { value: 'unpaid' }, `⏳ Chưa thanh toán (${totalWorkers - paidWorkers})`),
  h('option', { value: 'paid' }, `✅ Đã thanh toán (${paidWorkers})`));

  content.append(h('div', { class: 'card' },
    data.rows.length ? h('div', { class: 'search-bar' }, searchIn, filterSel) : null,
    h('div', { class: 'small muted', style: 'margin-bottom:10px' }, '💡 Bấm "🏧 QR" để quét VietQR chuyển lương, "✍️ Quyết toán" để xác nhận trả lương, hoặc bấm vào tên để xem chi tiết & Phiếu lương PNG'),
    data.rows.length ? h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {},
        h('th', {}, 'Nhân viên'),
        h('th', { class: 'num' }, 'Công'),
        h('th', { class: 'num' }, 'Giờ TC'),
        h('th', { class: 'num' }, '+/−'),
        h('th', { class: 'num' }, 'Tổng lương'),
        h('th', { class: 'num' }, 'Đã ứng'),
        h('th', { class: 'num' }, 'Thực lĩnh'),
        h('th', { style: 'text-align:right' }, 'Thanh toán'))),
      h('tbody', {}, data.rows.map((r) => {
        const adj = r.bonus_total + r.allowance_total - r.penalty_total;
        const paidBadge = r.paid
          ? h('span', { class: 'badge b-approved', style: 'margin-left:6px' },
            r.paid.method === 'cash' ? '💵 Đã trả TM' : '🏦 Đã CK')
          : h('span', { class: 'badge b-pending', style: 'margin-left:6px' }, '⏳ Chưa trả');
        return h('tr', {
          class: 'click',
          'data-name': `${r.user.name} ${r.user.phone}`.toLowerCase(),
          'data-paid': r.paid ? '1' : '0',
          onclick: () => payrollDetail(r, month, reload),
        },
        h('td', {},
          h('strong', {}, r.user.name),
          paidBadge,
          r.pending_reports ? h('span', { class: 'badge b-rejected', style: 'margin-left:6px' }, `${r.pending_reports} chờ`) : null,
          !r.user.active ? h('span', { class: 'badge b-off', style: 'margin-left:6px' }, 'nghỉ việc') : null),
        h('td', { class: 'num' }, fmtNum(r.work_days)),
        h('td', { class: 'num' }, fmtNum(r.ot_hours)),
        h('td', { class: 'num ' + (adj > 0 ? 'plus' : adj < 0 ? 'minus' : 'muted') }, adj ? (adj > 0 ? '+' : '−') + fmtMoney(Math.abs(adj)) : '–'),
        h('td', { class: 'num' }, fmtMoney(r.gross)),
        h('td', { class: 'num' }, fmtMoney(r.advance_total)),
        h('td', { class: 'num' }, h('strong', {}, fmtMoney(r.net))),
        h('td', { style: 'text-align:right;white-space:nowrap', onclick: (e) => e.stopPropagation() },
          h('button', {
            class: 'btn-sm btn-primary',
            style: 'margin-right:4px',
            title: 'Tạo mã VietQR chuyển khoản lương',
            onclick: () => openVietQRModal(r, month, reload),
          }, '🏧 QR'),
          h('button', {
            class: 'btn-sm ' + (r.paid ? '' : 'btn-ok'),
            title: 'Xác nhận đã thanh toán / ký nhận lương',
            onclick: () => openPayConfirmModal(r, month, reload),
          }, r.paid ? '✓ Sửa TT' : '✍️ Trả')));
      })),
      h('tfoot', {}, h('tr', {},
        h('td', {}, 'Tổng cộng'),
        h('td', { class: 'num' }, fmtNum(sum('work_days'))),
        h('td', { class: 'num' }, fmtNum(sum('ot_hours'))),
        h('td', { class: 'num' }, fmtMoney(sum('bonus_total') + sum('allowance_total') - sum('penalty_total'))),
        h('td', { class: 'num' }, fmtMoney(sum('gross'))),
        h('td', { class: 'num' }, fmtMoney(sum('advance_total'))),
        h('td', { class: 'num' }, fmtMoney(sum('net'))),
        h('td', { style: 'text-align:right' }, `${paidWorkers}/${totalWorkers} đã trả`))))) :
      h('div', { class: 'empty' }, 'Chưa có nhân viên. Vào "Nhân sự & CT" để thêm.')));
}

// ----- Đọc số tiền sang chữ Tiếng Việt chuẩn kế toán -----
function docSoTienVN(so) {
  const n = Math.round(Math.abs(Number(so) || 0));
  if (n === 0) return 'Không đồng';
  const chu = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
  const hang = ['', 'nghìn', 'triệu', 'tỷ', 'nghìn tỷ'];
  function doc3So(baso, dayDu) {
    const tram = Math.floor(baso / 100);
    const chuc = Math.floor((baso % 100) / 10);
    const donvi = baso % 10;
    let kq = '';
    if (tram > 0 || dayDu) {
      kq += chu[tram] + ' trăm ';
      if (chuc === 0 && donvi > 0) kq += 'lẻ ';
    }
    if (chuc > 1) {
      kq += chu[chuc] + ' mươi ';
      if (donvi === 1) kq += 'mốt ';
      else if (donvi === 5) kq += 'lăm ';
      else if (donvi > 0) kq += chu[donvi] + ' ';
    } else if (chuc === 1) {
      kq += 'mười ';
      if (donvi === 5) kq += 'lăm ';
      else if (donvi > 0) kq += chu[donvi] + ' ';
    } else if (donvi > 0) {
      kq += chu[donvi] + ' ';
    }
    return kq.trim();
  }
  const nhom = [];
  let tmp = n;
  while (tmp > 0) {
    nhom.push(tmp % 1000);
    tmp = Math.floor(tmp / 1000);
  }
  const parts = [];
  for (let i = nhom.length - 1; i >= 0; i--) {
    if (nhom[i] > 0) {
      const s = doc3So(nhom[i], i < nhom.length - 1);
      parts.push((s + (hang[i] ? ' ' + hang[i] : '')).trim());
    }
  }
  const text = parts.join(' ').replace(/\s+/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1) + ' đồng chẵn';
}

// ----- Mở cửa sổ In A4 hoặc Khung xem trước bản in (tương thích cả Web & App APK) -----
function openPrintWindowOrFrame(title, htmlContent) {
  const isApk = navigator.userAgent.includes('TBTWebAdminAPK');
  if (!isApk) {
    const w = window.open('', '_blank');
    if (w) {
      w.document.write(htmlContent);
      w.document.close();
      return;
    }
  }
  // Fallback hoặc trong App APK: Mở Modal Xem trước Bản in + Iframe
  const iframe = h('iframe', {
    style: 'width:100%;height:70vh;border:1px solid var(--border);border-radius:10px;background:#fff',
  });
  openModal(`🖨️ Xem trước bản in: ${title}`, h('div', {},
    h('div', { class: 'row between wrap', style: 'margin-bottom:10px' },
      h('span', { class: 'small muted' }, 'Bấm "🖨️ In / Lưu PDF" để xuất ra máy in hoặc lưu thành file PDF A4.'),
      h('button', {
        class: 'btn-primary btn-sm',
        onclick: () => {
          try {
            iframe.contentWindow.focus();
            iframe.contentWindow.print();
          } catch (e) {
            window.print();
          }
        },
      }, '🖨️ In ngay / Lưu PDF')),
    iframe));
  setTimeout(() => {
    const doc = iframe.contentDocument || iframe.contentWindow.document;
    doc.open();
    doc.write(htmlContent);
    doc.close();
  }, 60);
}

// ----- 7. Bảng Thanh toán Lương Tổng hợp (Kèm cột Ký nhận & Mã VietQR Hàng loạt) -----
function renderPayrollPaymentSheet(box, data, month, reload) {
  let subMode = 'sheet'; // 'sheet' | 'qrbatch'
  let filterMode = 'all'; // 'all' | 'unpaid' | 'bank' | 'cash'
  let showQrInSheet = true;

  const getFilteredRows = () => data.rows.filter((r) => {
    if (filterMode === 'unpaid') return !r.paid && r.net > 0;
    if (filterMode === 'bank') return !!(r.user.bank_bin && r.user.bank_account);
    if (filterMode === 'cash') return !(r.user.bank_bin && r.user.bank_account);
    return true;
  });

  const buildQrUrl = (r, template = 'qr_only') => {
    const u = r.user;
    if (!u.bank_bin || !u.bank_account || r.net <= 0) return '';
    const amount = Math.max(0, Math.round(r.net));
    const memo = stripVN(`Thanh toan luong T${month.slice(5)}/${month.slice(0, 4)} ${u.name}`);
    const holder = stripVN(u.bank_holder || u.name);
    return `https://img.vietqr.io/image/${encodeURIComponent(u.bank_bin)}-${encodeURIComponent(u.bank_account)}-${template}.png?amount=${amount}&addInfo=${encodeURIComponent(memo)}&accountName=${encodeURIComponent(holder)}`;
  };

  const printPaymentSheetA4 = () => {
    const rows = getFilteredRows();
    if (!rows.length) return toast('Không có nhân viên nào trong danh sách lọc để in', true);
    const sumField = (k) => rows.reduce((s, r) => s + (r[k] || 0), 0);
    const totalNet = sumField('net');
    const now = new Date();

    const rowsHtml = rows.map((r, idx) => {
      const u = r.user;
      const adj = r.bonus_total + r.allowance_total - r.penalty_total;
      const qrUrl = showQrInSheet ? buildQrUrl(r, 'qr_only') : '';
      const bankText = u.bank_bin && u.bank_account
        ? `<b>${u.bank_name || u.bank_bin}</b><br>${u.bank_account}<br><span style="font-size:9px;color:#475569">${u.bank_holder || stripVN(u.name)}</span>`
        : `<span style="color:#64748b;font-style:italic">Tiền mặt</span>`;
      const signHtml = r.paid
        ? `<div style="color:#047857;font-weight:700;font-size:10px">✓ ĐÃ THANH TOÁN<br><span style="font-weight:400;font-size:9px">${r.paid.method === 'cash' ? 'Tiền mặt' : 'Chuyển khoản'} · ${fmtDateTime(r.paid.paid_at).split(' · ')[1]}</span></div>`
        : `<div style="height:52px"></div>`;

      return `<tr>
        <td>${idx + 1}</td>
        <td style="text-align:left">
          <div style="font-weight:700;font-size:11.5px">${u.name}</div>
          <div style="font-size:9.5px;color:#475569">${u.phone}</div>
        </td>
        <td style="text-align:right">${fmtMoney(u.daily_wage)}</td>
        <td style="font-weight:700">${fmtNum(r.work_days)}</td>
        <td>${r.ot_hours ? `${fmtNum(r.ot_hours)}h<br><span style="font-size:9px;color:#475569">${fmtMoney(r.ot_pay)}</span>` : '–'}</td>
        <td style="text-align:right">${adj ? (adj > 0 ? '+' : '−') + fmtMoney(Math.abs(adj)) : '–'}</td>
        <td style="text-align:right">${fmtMoney(r.gross)}</td>
        <td style="text-align:right">${r.advance_total ? fmtMoney(r.advance_total) : '–'}</td>
        <td style="text-align:right;font-weight:800;font-size:12px;color:#0f172a">${fmtMoney(r.net)}</td>
        <td style="text-align:left;font-size:10px">${bankText}</td>
        ${showQrInSheet ? `<td style="padding:3px">${qrUrl ? `<img src="${qrUrl}" style="width:68px;height:68px;object-fit:contain;display:block;margin:0 auto">` : '<span style="font-size:9px;color:#94a3b8">–</span>'}</td>` : ''}
        <td style="min-width:125px">${signHtml}</td>
      </tr>`;
    }).join('');

    const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8">
      <title>Bang-thanh-toan-luong-${month}</title>
      <style>
        @page { size: A4 landscape; margin: 10mm; }
        body { font-family: Arial, sans-serif; color: #0f172a; margin: 0; font-size: 11px; }
        .top-meta { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px; }
        h1 { margin: 2px 0 3px; font-size: 18px; text-transform: uppercase; text-align: center; letter-spacing: .3px; }
        .sub { text-align: center; color: #475569; margin-bottom: 10px; font-size: 11.5px; }
        table { width: 100%; border-collapse: collapse; }
        th, td { border: 1px solid #334155; padding: 5px 6px; text-align: center; vertical-align: middle; font-size: 10.5px; }
        th { background: #e2e8f0; font-weight: 700; text-transform: uppercase; font-size: 9.5px; }
        .words { margin-top: 10px; font-size: 11.5px; padding: 7px 10px; background: #f8fafc; border: 1px dashed #64748b; border-radius: 6px; }
        .signs { display: flex; justify-content: space-around; margin-top: 22px; text-align: center; font-weight: 700; page-break-inside: avoid; }
        .signs div p { font-weight: 400; font-style: italic; font-size: 10px; margin-top: 2px; color: #475569; }
      </style></head><body>
      <div class="top-meta">
        <div>
          <div style="font-weight:800;font-size:13px">${BRAND.app} (${BRAND.team})</div>
          <div style="font-size:10.5px;color:#475569">${BRAND.slogan || 'Hệ thống Quản lý Chấm công & Bảng lương'}</div>
        </div>
        <div style="text-align:right;font-size:10px;color:#475569">
          Mẫu số: <b>02-LĐTL / TBT</b><br>
          Ngày in: ${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}
        </div>
      </div>
      <h1>BẢNG THANH TOÁN TIỀN LƯƠNG & KÝ NHẬN THÁNG ${month.slice(5)}/${month.slice(0, 4)}</h1>
      <div class="sub">Kỳ quyết toán: Tháng ${month.slice(5)} năm ${month.slice(0, 4)} · Tổng số: <b>${rows.length} nhân viên</b></div>
      <table>
        <thead>
          <tr>
            <th style="width:28px">STT</th>
            <th style="text-align:left;min-width:135px">Họ và tên / SĐT</th>
            <th>Lương<br>ngày</th>
            <th>Tổng<br>công</th>
            <th>Tăng ca<br>(Giờ/Tiền)</th>
            <th>Thưởng /<br>Phụ cấp / Phạt</th>
            <th>Tổng lương<br>(Gross)</th>
            <th>Đã ứng<br>trước</th>
            <th>Thực lĩnh<br>còn nhận</th>
            <th style="text-align:left">TK Ngân hàng /<br>Hình thức nhận</th>
            ${showQrInSheet ? '<th style="width:74px">Mã VietQR<br>Chuyển khoản</th>' : ''}
            <th style="min-width:130px">Ký nhận<br>(Ghi rõ họ tên)</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
        <tfoot>
          <tr style="background:#f1f5f9;font-weight:800">
            <td colspan="3" style="text-align:right">TỔNG CỘNG (${rows.length} người):</td>
            <td>${fmtNum(sumField('work_days'))}</td>
            <td>${fmtNum(sumField('ot_hours'))}h</td>
            <td style="text-align:right">${fmtMoney(sumField('bonus_total') + sumField('allowance_total') - sumField('penalty_total'))}</td>
            <td style="text-align:right">${fmtMoney(sumField('gross'))}</td>
            <td style="text-align:right">${fmtMoney(sumField('advance_total'))}</td>
            <td style="text-align:right;font-size:12px">${fmtMoney(totalNet)}</td>
            <td colspan="${showQrInSheet ? 3 : 2}"></td>
          </tr>
        </tfoot>
      </table>
      <div class="words">
        💵 <b>Tổng số tiền thực lĩnh thanh toán (bằng chữ):</b> <i>${docSoTienVN(totalNet)} (${fmtMoney(totalNet)}).</i>
      </div>
      <div class="signs">
        <div>NGƯỜI LẬP BIỂU<p>(Ký, ghi rõ họ tên)</p></div>
        <div>THỦ QUỸ / KẾ TOÁN CHI TRẢ<p>(Ký, ghi rõ họ tên)</p></div>
        <div>CHỈ HUY TRƯỞNG / GIÁM ĐỐC<p>(Ký, đóng dấu xác nhận)</p></div>
      </div>
      <script>window.onload = () => setTimeout(() => window.print(), 350);</script>
      </body></html>`;

    openPrintWindowOrFrame(`Bảng thanh toán lương T${month.slice(5)}/${month.slice(0, 4)}`, html);
  };

  const openBulkPayModal = () => {
    const unpaidRows = getFilteredRows().filter((r) => !r.paid && r.net > 0);
    if (!unpaidRows.length) {
      return toast('Tất cả nhân viên có lương trong danh sách lọc đều đã được thanh toán!');
    }
    const totalBulk = unpaidRows.reduce((s, r) => s + r.net, 0);
    const methodSeg = h('div', { class: 'seg' },
      [['transfer', '🏦 Chuyển khoản Ngân hàng'], ['cash', '💵 Tiền mặt trực tiếp']].map(([v, l]) =>
        h('label', {}, h('input', { type: 'radio', name: 'bulk_pay_method', value: v, checked: v === 'transfer' }), l)));
    const noteIn = h('input', {
      placeholder: 'Ghi chú quyết toán chung (vd: Đã tất toán lương đợt cuối tháng)…',
      maxlength: 250,
    });
    let close;
    close = openModal(`✅ Quyết toán hàng loạt (${unpaidRows.length} nhân viên)`, h('div', {},
      h('div', { class: 'okbox', style: 'margin-bottom:12px' },
        `Sắp đánh dấu ĐÃ TRẢ LƯƠNG cho `, h('b', {}, `${unpaidRows.length} nhân viên`),
        ` chưa thanh toán trong danh sách đang xem.`,
        h('div', { class: 'mt', style: 'font-size:15px' }, `Tổng số tiền: `, h('b', {}, fmtMoney(totalBulk))),
        h('div', { class: 'small muted' }, docSoTienVN(totalBulk))),
      field('Hình thức chi trả', methodSeg),
      field('Ghi chú quyết toán', noteIn),
      actionBtn(`💸 Xác nhận đã trả cho ${unpaidRows.length} người`, 'btn-ok btn-block mt', async () => {
        const method = methodSeg.querySelector('input:checked').value;
        const items = unpaidRows.map((r) => ({ user_id: r.user.id, amount: Math.max(0, r.net) }));
        const res = await api('/payroll/paid-bulk', {
          method: 'POST',
          body: { month, items, method, note: noteIn.value },
        });
        toast(`✅ Đã xác nhận trả lương cho ${res.count} nhân viên!`);
        close();
        reload();
      })));
  };

  const renderInner = () => {
    const rows = getFilteredRows();
    const totalNet = rows.reduce((s, r) => s + r.net, 0);
    const unpaidCount = rows.filter((r) => !r.paid && r.net > 0).length;

    const filterSel = h('select', {
      style: 'max-width:250px',
      onchange: (e) => { filterMode = e.target.value; renderInner(); },
    },
    h('option', { value: 'all', selected: filterMode === 'all' }, `👥 Tất cả nhân viên (${data.rows.length})`),
    h('option', { value: 'unpaid', selected: filterMode === 'unpaid' }, `⏳ Chưa thanh toán (${data.rows.filter((r) => !r.paid && r.net > 0).length})`),
    h('option', { value: 'bank', selected: filterMode === 'bank' }, `🏦 Có TK Ngân hàng VietQR (${data.rows.filter((r) => r.user.bank_bin && r.user.bank_account).length})`),
    h('option', { value: 'cash', selected: filterMode === 'cash' }, `💵 Nhận Tiền mặt / Chưa có STK (${data.rows.filter((r) => !(r.user.bank_bin && r.user.bank_account)).length})`));

    const qrCheck = h('input', {
      type: 'checkbox',
      checked: showQrInSheet,
      onchange: (e) => { showQrInSheet = e.target.checked; renderInner(); },
    });

    const headerCard = h('div', { class: 'card' },
      h('div', { class: 'row between wrap', style: 'margin-bottom:10px' },
        h('div', {},
          h('h2', { style: 'margin:0' }, `🧾 Bảng Thanh Toán Lương & Ký Nhận – Tháng ${month.slice(5)}/${month.slice(0, 4)}`),
          h('div', { class: 'small muted' },
            `Tổng thực lĩnh danh sách đang chọn (${rows.length} người): `,
            h('strong', { style: 'color:var(--primary)' }, fmtMoney(totalNet)),
            ` · `, h('i', {}, docSoTienVN(totalNet)))),
        h('div', { class: 'row wrap' },
          h('button', {
            class: 'btn-sm ' + (subMode === 'sheet' ? 'btn-primary' : ''),
            onclick: () => { subMode = 'sheet'; renderInner(); },
          }, '🧾 Bảng Ký nhận A4'),
          h('button', {
            class: 'btn-sm ' + (subMode === 'qrbatch' ? 'btn-primary' : ''),
            onclick: () => { subMode = 'qrbatch'; renderInner(); },
          }, '🏧 Lưới Quét VietQR Liên hoàn'))),
      h('div', { class: 'row between wrap', style: 'gap:10px;padding-top:8px;border-top:1px solid var(--border)' },
        h('div', { class: 'row wrap' },
          filterSel,
          h('label', { class: 'row small', style: 'cursor:pointer;gap:6px' },
            qrCheck, h('span', {}, 'Kèm cột mã VietQR trên bảng & bản in'))),
        h('div', { class: 'row wrap' },
          unpaidCount > 0
            ? h('button', { class: 'btn-sm btn-ok', onclick: openBulkPayModal }, `✅ Trả lương hàng loạt (${unpaidCount})`)
            : null,
          h('button', { class: 'btn-sm btn-primary', onclick: printPaymentSheetA4 }, '🖨️ In / Xuất PDF Bảng Ký Nhận (A4)'))));

    if (!rows.length) {
      box.replaceChildren(headerCard, h('div', { class: 'card empty' }, 'Không có nhân viên nào khớp bộ lọc hiện tại.'));
      return;
    }

    if (subMode === 'qrbatch') {
      const qrCards = rows.map((r, idx) => {
        const u = r.user;
        const qrUrl = buildQrUrl(r, 'compact2');
        const memo = stripVN(`Thanh toan luong T${month.slice(5)}/${month.slice(0, 4)} ${u.name}`);
        return h('div', { class: 'qr-batch-card' + (r.paid ? ' is-paid' : '') },
          h('div', {},
            h('div', { class: 'row between' },
              h('strong', {}, `${idx + 1}. ${u.name}`),
              r.paid
                ? h('span', { class: 'badge b-approved' }, r.paid.method === 'cash' ? '💵 Đã trả TM' : '🏦 Đã CK')
                : h('span', { class: 'badge b-pending' }, '⏳ Chưa trả')),
            h('div', { class: 'small muted' }, `${u.phone} · ${fmtNum(r.work_days)} công${r.ot_hours ? ` (+${fmtNum(r.ot_hours)}h TC)` : ''}`),
            h('div', { style: 'font-size:19px;font-weight:800;color:var(--primary);margin:6px 0' }, fmtMoney(r.net)),
            u.bank_bin && u.bank_account
              ? h('div', { class: 'small' },
                  h('strong', {}, `${u.bank_name || u.bank_bin} • ${u.bank_account}`),
                  h('div', { class: 'muted' }, u.bank_holder || stripVN(u.name)))
              : h('div', { class: 'warnbox', style: 'margin:8px 0;padding:8px;font-size:12px' },
                  '⚠️ Chưa cập nhật STK ngân hàng.')),
          qrUrl
            ? h('div', { class: 'qr-batch-img-wrap' },
                h('img', { class: 'qr-batch-img', src: qrUrl, alt: 'VietQR ' + u.name, loading: 'lazy' }))
            : null,
          h('div', { class: 'row wrap', style: 'gap:6px;margin-top:8px' },
            u.bank_account
              ? h('button', { class: 'btn-sm grow', onclick: () => copyText(u.bank_account, 'STK ' + u.name) }, '📋 Copy STK')
              : h('button', { class: 'btn-sm grow', onclick: () => editUser(u, reload) }, '+ Nhập STK NH'),
            !r.paid && r.net > 0
              ? actionBtn('✅ Đã chuyển xong', 'btn-sm btn-ok grow', async () => {
                  await api('/payroll/paid', {
                    method: 'POST',
                    body: {
                      month,
                      user_id: u.id,
                      paid: true,
                      method: u.bank_account ? 'transfer' : 'cash',
                      amount: Math.max(0, r.net),
                      note: u.bank_account ? `Quét VietQR (${memo})` : 'Trả tiền mặt',
                    },
                  });
                  toast(`💸 Đã xác nhận trả lương cho ${u.name}`);
                  reload();
                })
              : h('button', { class: 'btn-sm grow', onclick: () => openPayConfirmModal(r, month, reload) }, '✎ Chi tiết TT')));
      });

      box.replaceChildren(
        headerCard,
        h('div', { class: 'card' },
          h('div', { class: 'small muted' }, '📱 Mở ứng dụng Ngân hàng trên điện thoại và quét lần lượt từng thẻ VietQR bên dưới. Quét xong người nào bấm "✅ Đã chuyển xong" ngay bên dưới thẻ đó!'),
          h('div', { class: 'qr-batch-grid' }, qrCards)),
      );
      return;
    }

    // Chế độ Bảng Thanh toán & Ký nhận chuẩn A4 trên màn hình
    const tableCard = h('div', { class: 'card' },
      h('div', { class: 'table-wrap' },
        h('table', {},
          h('thead', {},
            h('tr', {},
              h('th', {}, 'STT'),
              h('th', {}, 'Họ và tên / SĐT'),
              h('th', { class: 'num' }, 'Công (+TC)'),
              h('th', { class: 'num' }, 'Tổng lương'),
              h('th', { class: 'num' }, 'Đã ứng'),
              h('th', { class: 'num' }, 'Thực lĩnh'),
              h('th', {}, 'TK Ngân hàng'),
              showQrInSheet ? h('th', { style: 'text-align:center' }, 'Mã VietQR') : null,
              h('th', { style: 'text-align:center' }, 'Ký nhận / Quyết toán'))),
          h('tbody', {},
            rows.map((r, idx) => {
              const u = r.user;
              const qrUrl = showQrInSheet ? buildQrUrl(r, 'qr_only') : '';
              return h('tr', {},
                h('td', {}, idx + 1),
                h('td', {},
                  h('strong', {}, u.name),
                  h('div', { class: 'small muted' }, `${u.phone} · ${fmtMoney(u.daily_wage)}/ngày`)),
                h('td', { class: 'num' },
                  h('strong', {}, fmtNum(r.work_days)),
                  r.ot_hours ? h('div', { class: 'small muted' }, `+${fmtNum(r.ot_hours)}h TC`) : null),
                h('td', { class: 'num' }, fmtMoney(r.gross)),
                h('td', { class: 'num' }, r.advance_total ? fmtMoney(r.advance_total) : '–'),
                h('td', { class: 'num' }, h('strong', { style: 'color:var(--primary);font-size:15px' }, fmtMoney(r.net))),
                h('td', {},
                  u.bank_bin && u.bank_account
                    ? h('div', { class: 'small' },
                        h('strong', {}, `${u.bank_name || u.bank_bin} • ${u.bank_account}`),
                        h('div', { class: 'muted' }, u.bank_holder || stripVN(u.name)))
                    : h('button', { class: 'btn-sm', onclick: () => editUser(u, reload) }, '+ Thêm STK')),
                showQrInSheet
                  ? h('td', { style: 'text-align:center' },
                      qrUrl
                        ? h('img', {
                            src: qrUrl,
                            alt: 'QR',
                            style: 'width:62px;height:62px;border-radius:6px;border:1px solid #e2e8f0;background:#fff;padding:2px;cursor:pointer',
                            title: 'Bấm để phóng to mã VietQR',
                            onclick: () => openVietQRModal(r, month, reload),
                          })
                        : h('span', { class: 'small muted' }, '–'))
                  : null,
                h('td', { style: 'text-align:center' },
                  r.paid
                    ? h('div', {
                        class: 'sign-cell-box',
                        style: 'border-color:#10b981;background:var(--ok-bg);color:#047857;cursor:pointer;flex-direction:column',
                        onclick: () => openPayConfirmModal(r, month, reload),
                      },
                      h('strong', {}, r.paid.method === 'cash' ? '✓ Đã ký nhận TM' : '✓ Đã chuyển khoản'),
                      h('span', { style: 'font-size:10px' }, fmtDateTime(r.paid.paid_at).split(' · ')[1]))
                    : h('button', {
                        class: 'btn-sm btn-ok',
                        onclick: () => openPayConfirmModal(r, month, reload),
                      }, '✍️ Ký nhận / Trả')));
            }))),
      h('div', { class: 'okbox mt', style: 'font-size:13px' },
        '💵 ', h('b', {}, 'Tổng số tiền thực lĩnh bằng chữ: '), h('i', {}, `${docSoTienVN(totalNet)} (${fmtMoney(totalNet)}).`))));

    box.replaceChildren(headerCard, tableCard);
  };

  renderInner();
}

// ----- Bảng chấm công Ma trận (Ngày 1 → 31 chuẩn kế toán & In A4 Ngang) -----
function renderAttendanceMatrix(box, data, month, reload) {
  const days = data.days;
  const dayNums = Array.from({ length: days }, (_, i) => i + 1);
  const wdNames = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  const dayMeta = dayNums.map((d) => {
    const dateStr = `${month}-${pad(d)}`;
    const dow = new Date(dateStr + 'T12:00:00').getDay();
    return { d, dateStr, wd: wdNames[dow], isSun: dow === 0 };
  });

  const dailyTotals = dayMeta.map((dm) =>
    data.rows.reduce((s, r) => {
      const cell = r.by_day?.[dm.dateStr];
      if (!cell || cell.status !== 'approved') return s;
      return s + (cell.day_type === 'full' ? 1 : cell.day_type === 'half' ? 0.5 : 0);
    }, 0)
  );

  const printMatrixA4 = () => {
    const rowsHtml = data.rows.map((r, idx) => {
      const cells = dayMeta.map((dm) => {
        const c = r.by_day?.[dm.dateStr];
        let sym = '';
        if (c) {
          if (c.status === 'pending') sym = '?';
          else if (c.status === 'approved') sym = c.day_type === 'full' ? 'X' : c.day_type === 'half' ? '1/2' : 'P';
        }
        const ot = c && c.status === 'approved' && c.ot_hours ? `<div style="font-size:8px;color:#4f46e5">+${c.ot_hours}h</div>` : '';
        return `<td style="background:${dm.isSun ? '#fef3c7' : '#fff'};font-weight:700">${sym}${ot}</td>`;
      }).join('');
      return `<tr>
        <td>${idx + 1}</td>
        <td style="text-align:left;font-weight:700;white-space:nowrap">${r.user.name}</td>
        ${cells}
        <td style="font-weight:800">${fmtNum(r.work_days)}</td>
        <td>${fmtNum(r.ot_hours)}</td>
        <td style="text-align:right;font-weight:700">${fmtMoney(r.net)}</td>
        <td>${r.paid ? 'Đã trả' : ''}</td>
      </tr>`;
    }).join('');

    const totalCells = dailyTotals.map((v, i) =>
      `<td style="background:${dayMeta[i].isSun ? '#fde68a' : '#f1f5f9'};font-weight:700">${v ? fmtNum(v) : ''}</td>`
    ).join('');

    const sum = (k) => data.rows.reduce((s, r) => s + r[k], 0);
    const now = new Date();
    const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8">
      <title>Bang-cham-cong-${month}</title>
      <style>
        @page { size: A4 landscape; margin: 10mm; }
        body { font-family: Arial, sans-serif; color: #0f172a; margin: 0; font-size: 11px; }
        h1 { margin: 4px 0 2px; font-size: 18px; text-transform: uppercase; text-align: center; }
        .sub { text-align: center; color: #475569; margin-bottom: 10px; font-size: 12px; }
        table { width: 100%; border-collapse: collapse; table-layout: auto; }
        th, td { border: 1px solid #334155; padding: 4px 3px; text-align: center; font-size: 10px; }
        th { background: #e2e8f0; font-weight: 700; }
        .legend { margin-top: 8px; font-size: 10.5px; color: #334155; display: flex; justify-content: space-between; }
        .signs { display: flex; justify-content: space-around; margin-top: 22px; text-align: center; font-weight: 700; }
        .signs div p { font-weight: 400; font-style: italic; font-size: 10px; margin-top: 2px; color: #475569; }
      </style></head><body>
      <div style="font-weight:700;font-size:12px">${BRAND.app} (${BRAND.team})</div>
      <h1>BẢNG CHẤM CÔNG & QUYẾT TOÁN LƯƠNG THÁNG ${month.slice(5)}/${month.slice(0, 4)}</h1>
      <div class="sub">Từ ngày 01/${month.slice(5)}/${month.slice(0, 4)} đến ngày ${pad(days)}/${month.slice(5)}/${month.slice(0, 4)}</div>
      <table>
        <thead>
          <tr>
            <th rowspan="2">TT</th>
            <th rowspan="2" style="text-align:left;min-width:130px">Họ và tên</th>
            ${dayMeta.map((dm) => `<th style="background:${dm.isSun ? '#fde68a' : '#e2e8f0'}">${pad(dm.d)}</th>`).join('')}
            <th rowspan="2">Tổng<br>công</th>
            <th rowspan="2">TC<br>(giờ)</th>
            <th rowspan="2">Thực lĩnh<br>(VNĐ)</th>
            <th rowspan="2">Ký<br>nhận</th>
          </tr>
          <tr>
            ${dayMeta.map((dm) => `<th style="background:${dm.isSun ? '#fde68a' : '#f1f5f9'};font-size:9px">${dm.wd}</th>`).join('')}
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
        <tfoot>
          <tr style="background:#f1f5f9;font-weight:800">
            <td colspan="2" style="text-align:right">Tổng cộng:</td>
            ${totalCells}
            <td>${fmtNum(sum('work_days'))}</td>
            <td>${fmtNum(sum('ot_hours'))}</td>
            <td style="text-align:right">${fmtMoney(sum('net'))}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
      <div class="legend">
        <span><b>Ký hiệu:</b> <b>X</b> = Đủ ngày công (1.0) · <b>1/2</b> = Nửa ngày (0.5) · <b>P</b> = Nghỉ (0) · <b>+nh</b> = Giờ tăng ca · <b>?</b> = Chờ duyệt</span>
        <span>In ngày ${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}</span>
      </div>
      <div class="signs">
        <div>NGƯỜI CHẤM CÔNG<p>(Ký, ghi rõ họ tên)</p></div>
        <div>KẾ TOÁN / ĐỘI TRƯỞNG<p>(Ký, ghi rõ họ tên)</p></div>
        <div>GIÁM ĐỐC / CHỦ ĐẦU TƯ<p>(Ký, đóng dấu)</p></div>
      </div>
      <script>window.onload = () => setTimeout(() => window.print(), 250);</script>
      </body></html>`;
    openPrintWindowOrFrame(`Bảng chấm công T${month.slice(5)}/${month.slice(0, 4)}`, html);
  };

  box.replaceChildren(
    h('div', { class: 'card' },
      h('div', { class: 'row between wrap', style: 'margin-bottom:10px' },
        h('div', {},
          h('h2', { style: 'margin:0' }, `📑 Bảng Chấm Công Ma Trận – Tháng ${month.slice(5)}/${month.slice(0, 4)}`),
          h('div', { class: 'small muted' }, 'Chuẩn sổ chấm công kế toán: X = Cả ngày (1.0) · 1/2 = Nửa ngày (0.5) · P = Nghỉ · +nh = Giờ tăng ca · Cột vàng = Chủ nhật')),
        h('button', { class: 'btn-primary btn-sm', onclick: printMatrixA4 }, '🖨️ In / Xuất PDF Chuẩn Kế toán (A4 Ngang)')),
      data.rows.length
        ? h('div', { class: 'matrix-wrap' },
          h('table', { class: 'matrix-table' },
            h('thead', {},
              h('tr', {},
                h('th', { class: 'sticky-col', rowspan: 2 }, 'Nhân viên'),
                dayMeta.map((dm) => h('th', { class: dm.isSun ? 'col-sun' : '' }, pad(dm.d))),
                h('th', { rowspan: 2 }, 'Tổng công'),
                h('th', { rowspan: 2 }, 'Tăng ca'),
                h('th', { rowspan: 2 }, 'Thực lĩnh'),
                h('th', { rowspan: 2 }, 'TT')),
              h('tr', {},
                dayMeta.map((dm) => h('th', { class: dm.isSun ? 'col-sun' : '', style: 'font-size:10px;font-weight:600' }, dm.wd)))),
            h('tbody', {},
              data.rows.map((r) => h('tr', {},
                h('td', {
                  class: 'sticky-col',
                  style: 'cursor:pointer',
                  onclick: () => payrollDetail(r, month, reload),
                },
                h('strong', {}, r.user.name),
                h('div', { class: 'small muted', style: 'font-size:11px' }, `${fmtMoney(r.user.daily_wage)}/ngày`)),
                dayMeta.map((dm) => {
                  const c = r.by_day?.[dm.dateStr];
                  let mark = '·';
                  let cls = 'mx-mark muted';
                  let tip = `${r.user.name} · ${fmtDate(dm.dateStr)}: Chưa có báo công`;
                  if (c) {
                    if (c.status === 'pending') {
                      mark = '?';
                      cls = 'mx-mark mx-pending';
                      tip = `${r.user.name} · ${fmtDate(dm.dateStr)}: Chờ duyệt (${TYPE[c.day_type]})`;
                    } else if (c.status === 'rejected') {
                      mark = '✕';
                      cls = 'mx-mark minus';
                      tip = `${r.user.name} · ${fmtDate(dm.dateStr)}: Từ chối`;
                    } else if (c.day_type === 'full') {
                      mark = 'X';
                      cls = 'mx-mark mx-full';
                      tip = `${r.user.name} · ${fmtDate(dm.dateStr)}: Cả ngày${c.site_name ? ' @ ' + c.site_name : ''}${c.check_in ? ` (${c.check_in}-${c.check_out})` : ''}`;
                    } else if (c.day_type === 'half') {
                      mark = '1/2';
                      cls = 'mx-mark mx-half';
                      tip = `${r.user.name} · ${fmtDate(dm.dateStr)}: Nửa ngày${c.site_name ? ' @ ' + c.site_name : ''}`;
                    } else {
                      mark = 'P';
                      cls = 'mx-mark mx-off';
                      tip = `${r.user.name} · ${fmtDate(dm.dateStr)}: Nghỉ${c.note ? ' (' + c.note + ')' : ''}`;
                    }
                  }
                  return h('td', {
                    class: 'mx-cell' + (dm.isSun ? ' col-sun' : ''),
                    title: tip,
                    onclick: () => {
                      if (c) toast(tip);
                      else payrollDetail(r, month, reload);
                    },
                  },
                  h('span', { class: cls }, mark),
                  c && c.status === 'approved' && c.ot_hours ? h('span', { class: 'mx-ot' }, `+${fmtNum(c.ot_hours)}h`) : null);
                }),
                h('td', { style: 'font-weight:800;color:var(--primary)' }, fmtNum(r.work_days)),
                h('td', {}, r.ot_hours ? `${fmtNum(r.ot_hours)}h` : '–'),
                h('td', { style: 'font-weight:700;text-align:right' }, fmtMoney(r.net)),
                h('td', {},
                  r.paid
                    ? h('span', { class: 'badge b-approved', style: 'cursor:pointer', onclick: () => openPayConfirmModal(r, month, reload) }, '✓')
                    : h('button', { class: 'btn-sm btn-primary', style: 'padding:3px 7px;font-size:11px', onclick: () => openVietQRModal(r, month, reload) }, '🏧 QR'))))),
            h('tfoot', {},
              h('tr', {},
                h('td', { class: 'sticky-col' }, 'Tổng công / ngày'),
                dailyTotals.map((v, i) => h('td', { class: dayMeta[i].isSun ? 'col-sun' : '' }, v ? fmtNum(v) : '')),
                h('td', {}, fmtNum(data.rows.reduce((s, r) => s + r.work_days, 0))),
                h('td', {}, `${fmtNum(data.rows.reduce((s, r) => s + r.ot_hours, 0))}h`),
                h('td', { style: 'text-align:right' }, fmtMoney(data.rows.reduce((s, r) => s + r.net, 0))),
                h('td', {}, '')))))
        : h('div', { class: 'empty' }, 'Chưa có nhân viên nào trong bảng công')));
}

// ----- Biểu đồ (SVG thuần, không cần thư viện) -----
function shortMoney(n) {
  if (n >= 1e9) return fmtNum(n / 1e9) + ' tỷ';
  if (n >= 1e6) return fmtNum(Math.round(n / 1e5) / 10) + 'tr';
  if (n >= 1e3) return Math.round(n / 1e3) + 'k';
  return String(Math.round(n));
}
function barChart(items, { fmt = fmtNum, height = 180, highlightLast = true, showValues = true } = {}) {
  const NS = 'http://www.w3.org/2000/svg';
  const el = (t, a) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); return e; };
  const W = 600, top = 26, bottom = 28, H = height;
  const max = Math.max(1, ...items.map((i) => i.value));
  const n = items.length, gap = n > 15 ? 3 : 14, bw = (W - gap * (n + 1)) / n;
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img' });
  const defs = el('defs', {});
  const lg = el('linearGradient', { id: 'cg', x1: 0, y1: 0, x2: 0, y2: 1 });
  lg.append(el('stop', { offset: 0, 'stop-color': '#6366f1' }), el('stop', { offset: 1, 'stop-color': '#2563eb' }));
  defs.append(lg); svg.append(defs);
  for (let i = 0; i <= 3; i++) {
    const y = top + (H - top - bottom) * (i / 3);
    svg.append(el('line', { x1: 0, x2: W, y1: y, y2: y, class: 'grid' }));
  }
  items.forEach((it, i) => {
    const x = gap + i * (bw + gap);
    const bh = Math.max(it.value ? 3 : 0, (H - top - bottom) * (it.value / max));
    const y = H - bottom - bh;
    const last = highlightLast && i === n - 1;
    const r = el('rect', { x, y, width: bw, height: bh, rx: Math.min(8, bw / 3), fill: last ? 'url(#cg)' : 'currentColor', class: last ? 'bar hl' : 'bar' });
    const title = el('title', {}); title.textContent = `${it.label}: ${fmt(it.value)}`; r.append(title);
    svg.append(r);
    if (showValues && it.value) {
      const t = el('text', { x: x + bw / 2, y: y - 6, 'text-anchor': 'middle', class: 'val' }); t.textContent = fmt(it.value); svg.append(t);
    }
    if (it.label) {
      const t = el('text', { x: x + bw / 2, y: H - 8, 'text-anchor': 'middle', class: 'lbl' }); t.textContent = it.label; svg.append(t);
    }
  });
  return svg;
}
function hBars(items, fmt = fmtNum) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return h('div', { class: 'hbars' }, items.map((it) => h('div', { class: 'hbar' },
    h('div', { class: 'row between small' }, h('span', {}, it.label), h('strong', {}, fmt(it.value))),
    h('div', { class: 'hbar-track' }, h('div', { class: 'hbar-fill', style: `width:${(it.value / max) * 100}%` })))));
}
async function renderCharts(box, month, data) {
  box.replaceChildren(h('div', { class: 'card empty' }, 'Đang tải thống kê…'));
  const s = await api(`/stats/monthly?month=${month}&months=6`);
  const ml = (k) => `T${Number(k.slice(5))}`;
  const daily = [];
  const dmap = Object.fromEntries(s.daily.map((d) => [d.work_date, d.days]));
  for (let d = 1; d <= s.days; d++) {
    daily.push({ label: d % 5 === 0 || d === 1 ? String(d) : '', value: dmap[`${month}-${pad(d)}`] || 0 });
  }
  const cur = s.series[s.series.length - 1], prev = s.series[s.series.length - 2];
  const diff = prev && prev.gross ? Math.round(((cur.gross - prev.gross) / prev.gross) * 100) : null;

  const t = data?.totals;
  const structItems = t ? [
    { label: '👷 Tiền công ngày', value: t.wage_total || 0 },
    { label: '⏱ Tiền tăng ca', value: t.ot_total || 0 },
    { label: '🎉 Thưởng & Phụ cấp', value: (t.bonus_total || 0) + (t.allowance_total || 0) },
    { label: '💵 Đã ứng trước', value: t.advance_total || 0 },
  ].filter((x) => x.value > 0) : [];

  const topEarners = data?.rows
    ? [...data.rows].filter((r) => r.gross > 0).sort((a, b) => b.gross - a.gross).slice(0, 8)
    : [];

  box.replaceChildren(
    structItems.length ? h('div', { class: 'card' },
      h('h2', {}, `📊 Cơ cấu Quỹ lương tháng ${Number(month.slice(5))}/${month.slice(0, 4)}`),
      hBars(structItems, fmtMoney)) : null,
    topEarners.length ? h('div', { class: 'card' },
      h('h2', {}, `🏆 Xếp hạng Thu nhập nhân viên tháng ${Number(month.slice(5))}`),
      hBars(topEarners.map((r) => ({ label: `${r.user.name} (${fmtNum(r.work_days)} công)`, value: r.gross })), fmtMoney)) : null,
    h('div', { class: 'card' },
      h('div', { class: 'row between' }, h('h2', { style: 'margin:0' }, '💰 Tổng lương 6 tháng'),
        diff != null ? h('span', { class: 'badge ' + (diff >= 0 ? 'b-approved' : 'b-rejected') }, `${diff >= 0 ? '▲' : '▼'} ${Math.abs(diff)}% so với tháng trước`) : null),
      barChart(s.series.map((x) => ({ label: ml(x.month), value: x.gross })), { fmt: shortMoney })),
    h('div', { class: 'card' }, h('h2', {}, '📅 Tổng số công 6 tháng'),
      barChart(s.series.map((x) => ({ label: ml(x.month), value: x.work_days })))),
    h('div', { class: 'card' }, h('h2', {}, `👷 Số công từng ngày – tháng ${Number(month.slice(5))}`),
      barChart(daily, { height: 150, highlightLast: false, showValues: false }),
      h('div', { class: 'small muted center' }, 'Rê / chạm vào cột để xem số công của ngày')),
    h('div', { class: 'card' }, h('h2', {}, '🏗️ Công theo công trình'),
      s.by_site.length ? hBars(s.by_site.map((x) => ({ label: x.name, value: x.days })), (v) => fmtNum(v) + ' công')
        : h('div', { class: 'empty' }, 'Chưa có dữ liệu')),
    h('div', { class: 'card' }, h('h2', {}, '⏱ Giờ tăng ca 6 tháng'),
      barChart(s.series.map((x) => ({ label: ml(x.month), value: x.ot_hours })), { fmt: (v) => fmtNum(v) + 'h' })));
}

function payrollDetail(r, month, reload) {
  let close;
  const reloadAll = async () => {
    close();
    reload();
    const fresh = (await api(`/payroll?month=${month}&user_id=${r.user.id}`)).rows[0];
    payrollDetail(fresh, month, reload);
  };
  const reports = [...r.reports].reverse();
  const isPaid = !!r.paid;
  close = openModal(r.user.name + ' – tháng ' + month.slice(5) + '/' + month.slice(0, 4), h('div', {},
    salaryCard(r, month),
    h('div', { class: 'row wrap mt' },
      h('button', {
        class: 'btn-primary grow',
        onclick: () => openVietQRModal(r, month, reloadAll),
      }, '🏧 Mã QR Chuyển khoản Lương'),
      isPaid
        ? actionBtn('↺ Bỏ đánh dấu đã trả', 'grow', async () => {
            if (!confirmBox('Bỏ trạng thái đã trả lương?')) return;
            await api('/payroll/paid', { method: 'POST', body: { month, user_id: r.user.id, paid: false } });
            toast('Đã bỏ đánh dấu');
            reloadAll();
          })
        : h('button', {
            class: 'btn-ok grow',
            onclick: () => openPayConfirmModal(r, month, reloadAll),
          }, '✍️ Xác nhận ĐÃ TRẢ LƯƠNG')),
    h('div', { class: 'mt' },
      h('div', { class: 'row between', style: 'margin-bottom:6px' }, h('h3', { style: 'margin:0' }, 'Thưởng / phụ cấp / phạt'),
        h('button', { class: 'btn-sm btn-primary', onclick: () => adjustmentModal([r.user], r.user.id, reloadAll, month) }, '+ Thêm')),
      r.adjustments.length ? r.adjustments.map((j) => adjustmentItem(j, async () => {
        if (!confirmBox(`Xóa ${KIND[j.kind].toLowerCase()} ${fmtMoney(j.amount)}?`)) return;
        await api('/adjustments/' + j.id, { method: 'DELETE' }); toast('Đã xóa'); reloadAll();
      })) : h('div', { class: 'small muted' }, 'Chưa có')),
    h('div', { class: 'card mt', style: 'padding:0;box-shadow:none' }, h('h3', {}, 'Báo công trong tháng'),
      reports.length ? reports.map((x) => reviewItem({ ...x, user_name: fmtDate(x.work_date) }, reloadAll)) : h('div', { class: 'empty' }, 'Không có')),
    r.advances.length ? h('div', { class: 'mt' }, h('h3', {}, 'Khoản ứng đã duyệt'), r.advances.map((a) => advanceItem(a))) : null));
}

/** Form thêm thưởng / phụ cấp / phạt. */
function adjustmentModal(users, fixedUserId, onDone, month) {
  const who = h('select', { disabled: !!fixedUserId }, h('option', { value: '' }, '— Chọn nhân viên —'),
    users.map((u) => h('option', { value: u.id, selected: u.id === fixedUserId }, u.name)));
  const kindSeg = h('div', { class: 'seg' }, [['bonus', '🎉 Thưởng'], ['allowance', '💰 Phụ cấp'], ['penalty', '⚠️ Phạt']].map(([v, l]) =>
    h('label', {}, h('input', { type: 'radio', name: 'adj_kind', value: v, checked: v === 'bonus' }), l)));
  const amount = moneyInput();
  // Mặc định ghi vào ngày hôm nay, hoặc ngày cuối của tháng đang xem nếu là tháng cũ
  let def = localDate();
  if (month && month !== thisMonth()) def = `${month}-${pad(new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate())}`;
  const date = h('input', { type: 'date', value: def });
  const reason = h('input', { placeholder: 'Vd: Làm tốt / Phụ cấp xăng xe / Đi trễ…', maxlength: 500 });
  let close;
  close = openModal('Thưởng / Phụ cấp / Phạt', h('div', {},
    field('Nhân viên', who), field('Loại', kindSeg),
    h('div', { class: 'grid2' }, field('Số tiền', amount), field('Tính vào ngày', date, 'Cộng/trừ vào lương tháng của ngày này')),
    field('Lý do', reason),
    actionBtn('Lưu', 'btn-primary btn-block', async () => {
      if (!who.value) throw new Error('Chọn nhân viên');
      if (!amount.getValue()) throw new Error('Nhập số tiền');
      const kind = kindSeg.querySelector('input:checked').value;
      await api('/adjustments', { method: 'POST', body: { user_id: Number(who.value), kind, amount: amount.getValue(), adj_date: date.value, reason: reason.value } });
      toast(`Đã ghi ${KIND[kind].toLowerCase()}`); close(); onDone();
    })));
}

// ================= QUẢN LÝ: Ứng tiền =================
async function viewAdminAdvances(box, month = thisMonth()) {
  const [pending, list, users] = await Promise.all([
    api('/advances?status=pending'), api('/advances?month=' + month), api('/users')]);
  await refreshStats();
  const reload = () => viewAdminAdvances(box, month);
  const review = async (a, status) => {
    let note = '';
    if (status === 'rejected') { note = window.prompt('Lý do từ chối:', ''); if (note == null) return; }
    await api(`/advances/${a.id}/review`, { method: 'POST', body: { status, note } });
    toast(status === 'approved' ? 'Đã duyệt ứng tiền' : 'Đã từ chối'); reload();
  };
  const del = async (a) => {
    if (!confirmBox('Xóa khoản ứng này?')) return;
    await api('/advances/' + a.id, { method: 'DELETE' }); toast('Đã xóa'); reload();
  };

  // Form ghi khoản ứng trực tiếp
  const workers = users.filter((u) => u.role === 'worker' && u.active);
  const who = h('select', {}, h('option', { value: '' }, '— Chọn nhân viên —'), workers.map((u) => h('option', { value: u.id }, u.name)));
  const amount = moneyInput();
  const date = h('input', { type: 'date', value: localDate() });
  const reason = h('input', { placeholder: 'Ghi chú', maxlength: 500 });

  box.replaceChildren(
    h('div', { class: 'card' }, h('h2', {}, `Chờ duyệt (${pending.length})`),
      pending.length ? pending.map((a) => advanceItem(a, { showName: true, actions: [
        actionBtn('✓ Duyệt', 'btn-ok btn-sm', () => review(a, 'approved')),
        actionBtn('✕ Từ chối', 'btn-bad btn-sm', () => review(a, 'rejected'))] })) : h('div', { class: 'empty' }, 'Không có yêu cầu nào')),
    h('details', { class: 'card' }, h('summary', {}, h('strong', {}, '+ Ghi khoản ứng cho nhân viên')),
      h('div', { class: 'mt' }, field('Nhân viên', who), h('div', { class: 'grid2' }, field('Số tiền', amount), field('Ngày ứng', date)),
        field('Ghi chú', reason),
        actionBtn('Lưu khoản ứng', 'btn-primary btn-block', async () => {
          if (!who.value) throw new Error('Chọn nhân viên');
          if (!amount.getValue()) throw new Error('Nhập số tiền');
          await api('/advances', { method: 'POST', body: { user_id: Number(who.value), amount: amount.getValue(), adv_date: date.value, reason: reason.value } });
          toast('Đã ghi khoản ứng'); reload();
        }))),
    h('div', { class: 'card' },
      h('div', { class: 'row between', style: 'margin-bottom:10px' }, h('h2', { style: 'margin:0' }, 'Theo tháng'), monthPicker(month, (m) => viewAdminAdvances(box, m))),
      h('div', { class: 'small muted', style: 'margin-bottom:8px' },
        'Tổng đã duyệt: ', h('strong', {}, fmtMoney(list.filter((a) => a.status === 'approved').reduce((s, a) => s + a.amount, 0)))),
      list.length ? list.map((a) => advanceItem(a, { showName: true, actions: [h('button', { class: 'btn-sm btn-bad', onclick: () => del(a).catch(fail) }, 'Xóa')] }))
        : h('div', { class: 'empty' }, 'Không có khoản ứng nào')));
}

// ================= QUẢN LÝ: Nhân sự (nhân viên + công trình + chi phí + nhật ký) =================
async function viewStaff(box, tab = 'users', costMonth = '') {
  const tabs = h('div', { class: 'tabs' },
    h('button', { class: tab === 'users' ? 'on' : '', onclick: () => viewStaff(box, 'users') }, '👷 Nhân viên'),
    h('button', { class: tab === 'sites' ? 'on' : '', onclick: () => viewStaff(box, 'sites') }, '🏗️ Công trình & Chi phí'),
    h('button', { class: tab === 'logs' ? 'on' : '', onclick: () => viewStaff(box, 'logs') }, '📜 Nhật ký'));
  const content = h('div', {});
  box.replaceChildren(tabs, content);
  if (tab === 'users') {
    const users = await api('/users');
    content.append(h('div', { class: 'card' },
      h('div', { class: 'row between', style: 'margin-bottom:10px' }, h('h2', { style: 'margin:0' }, `Nhân viên (${users.length})`),
        h('button', { class: 'btn-primary btn-sm', onclick: () => editUser(null, () => viewStaff(box, 'users')) }, '+ Thêm')),
      users.map((u) => h('div', { class: 'item row between', style: 'cursor:pointer', onclick: () => editUser(u, () => viewStaff(box, 'users')) },
        h('div', { class: 'avatar sm' }, initials(u.name)),
        h('div', { class: 'grow' },
          h('strong', {}, u.name), u.role === 'admin' ? h('span', { class: 'badge b-approved', style: 'margin-left:6px' }, 'Quản lý') : null,
          !u.active ? h('span', { class: 'badge b-off', style: 'margin-left:6px' }, 'Đã khóa') : null,
          u.bank_account ? h('span', { class: 'badge b-pending', style: 'margin-left:6px' }, `🏧 ${u.bank_name || u.bank_bin} • ${u.bank_account}`) : null,
          h('div', { class: 'small muted' }, u.phone + (u.role === 'worker' ? ` · ${fmtMoney(u.daily_wage)}/ngày · TC ${fmtMoney(u.ot_rate)}/giờ` : ''))),
        h('span', { class: 'muted' }, '›')))));
  } else if (tab === 'sites') {
    const costData = await api('/sites/costs' + (costMonth ? '?month=' + costMonth : ''));
    const sites = costData.rows;
    const sum = (k) => sites.reduce((s, x) => s + x[k], 0);
    const reloadSites = () => viewStaff(box, 'sites', costMonth);
    content.append(
      h('div', { class: 'card' },
        h('div', { class: 'row between wrap' },
          h('div', { class: 'row wrap' },
            h('button', { class: 'btn-sm ' + (!costMonth ? 'btn-primary' : ''), onclick: () => viewStaff(box, 'sites', '') }, 'Tất cả thời gian'),
            monthPicker(costMonth || thisMonth(), (m) => viewStaff(box, 'sites', m))),
          h('div', { class: 'row wrap' },
            sites.length ? h('button', { class: 'btn-sm', onclick: () => siteExpenseModal(sites.map((x) => x.site), null, reloadSites) }, '+ Chi phí vật tư/khác') : null,
            h('button', { class: 'btn-primary btn-sm', onclick: () => editSite(null, reloadSites) }, '+ Thêm công trình')))),
      h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('div', { class: 'n', style: 'font-size:18px' }, fmtMoney(sum('wage_cost') + sum('ot_cost'))), h('div', { class: 'l' }, `Tiền công & TC (${fmtNum(sum('work_days'))} công)`)),
        h('div', { class: 'stat' }, h('div', { class: 'n', style: 'font-size:18px' }, fmtMoney(sum('expense_cost'))), h('div', { class: 'l' }, 'Chi phí vật tư / khác')),
        h('div', { class: 'stat' }, h('div', { class: 'n', style: 'font-size:18px' }, fmtMoney(sum('total_cost'))), h('div', { class: 'l' }, 'Tổng chi phí công trình'))),
      h('div', { class: 'card' },
        h('div', { class: 'small muted', style: 'margin-bottom:8px' }, 'Bấm vào công trình để xem chi tiết chi phí, ghi thêm vật tư hoặc sửa tên'),
        sites.length ? sites.map((x) => h('div', { class: 'item', style: 'cursor:pointer', onclick: () => siteCostDetail(x, reloadSites) },
          h('div', { class: 'row between' },
            h('div', {}, h('strong', {}, x.site.name), !x.site.active ? h('span', { class: 'badge b-off', style: 'margin-left:6px' }, 'Đã xong') : null),
            h('strong', { style: 'color:var(--primary)' }, fmtMoney(x.total_cost))),
          x.site.address ? h('div', { class: 'small muted' }, '📍 ' + x.site.address) : null,
          h('div', { class: 'small muted mt', style: 'margin-top:4px' },
            `👷 ${fmtNum(x.work_days)} công${x.ot_hours ? ` (+${fmtNum(x.ot_hours)}h TC)` : ''}: ${fmtMoney(x.wage_cost + x.ot_cost)} · 🧱 Vật tư/khác: ${fmtMoney(x.expense_cost)}`)))
          : h('div', { class: 'empty' }, 'Chưa có công trình nào. Bấm "+ Thêm công trình".')));
  } else {
    await renderLogs(content);
  }
}

function siteCostDetail(x, reload) {
  let close;
  close = openModal(x.site.name, h('div', {},
    h('div', { class: 'kv' }, h('span', {}, 'Số công đã duyệt'), h('strong', {}, `${fmtNum(x.work_days)} công (${fmtNum(x.ot_hours)}h TC)`)),
    h('div', { class: 'kv' }, h('span', {}, 'Tiền công thợ'), h('span', {}, fmtMoney(x.wage_cost))),
    h('div', { class: 'kv' }, h('span', {}, 'Tiền tăng ca'), h('span', {}, fmtMoney(x.ot_cost))),
    h('div', { class: 'kv' }, h('span', {}, 'Chi phí vật tư / khác'), h('span', {}, fmtMoney(x.expense_cost))),
    h('div', { class: 'kv total' }, h('span', {}, 'Tổng chi phí'), h('span', {}, fmtMoney(x.total_cost))),
    h('div', { class: 'row wrap mt' },
      h('button', { class: 'btn-primary btn-sm', onclick: () => { close(); siteExpenseModal([x.site], x.site.id, reload); } }, '+ Ghi chi phí vật tư/khác'),
      h('button', { class: 'btn-sm', onclick: () => { close(); editSite(x.site, reload); } }, '✎ Sửa thông tin công trình')),
    h('div', { class: 'mt' },
      h('h3', {}, `Khoản chi vật tư / khác (${x.expenses.length})`),
      x.expenses.length ? x.expenses.map((e) => h('div', { class: 'item row between' },
        h('div', {},
          h('strong', {}, fmtMoney(e.amount)), ' · ', e.title,
          h('div', { class: 'small muted' }, fmtDate(e.exp_date))),
        actionBtn('Xóa', 'btn-sm btn-bad', async () => {
          if (!confirmBox(`Xóa khoản chi "${e.title}" (${fmtMoney(e.amount)})?`)) return;
          await api('/site-expenses/' + e.id, { method: 'DELETE' });
          toast('Đã xóa'); close(); reload();
        }))) : h('div', { class: 'small muted' }, 'Chưa có khoản chi vật tư/khác nào'))));
}

function siteExpenseModal(sites, fixedSiteId, onDone) {
  const site = h('select', { disabled: !!fixedSiteId }, h('option', { value: '' }, '— Chọn công trình —'),
    sites.map((s) => h('option', { value: s.id, selected: s.id === fixedSiteId }, s.name)));
  const title = h('input', { placeholder: 'Vd: Mua 20 bao xi măng, Thuê giàn giáo, Ăn trưa…', maxlength: 300 });
  const amount = moneyInput();
  const date = h('input', { type: 'date', value: localDate() });
  let close;
  close = openModal('Ghi chi phí công trình', h('div', {},
    field('Công trình', site),
    field('Nội dung khoản chi', title),
    h('div', { class: 'grid2' }, field('Số tiền (VNĐ)', amount), field('Ngày chi', date)),
    actionBtn('Lưu chi phí', 'btn-primary btn-block', async () => {
      if (!site.value) throw new Error('Chọn công trình');
      if (!title.value.trim()) throw new Error('Nhập nội dung khoản chi');
      if (!amount.getValue()) throw new Error('Nhập số tiền');
      await api('/site-expenses', { method: 'POST', body: { site_id: Number(site.value), title: title.value, amount: amount.getValue(), exp_date: date.value } });
      toast('✅ Đã lưu chi phí công trình'); close(); onDone();
    })));
}

// ----- Nhật ký thao tác -----
const LOG_IC = {
  'report.approved': '✅', 'report.rejected': '❌', 'report.pending': '↺', 'report.update': '✏️', 'report.delete': '🗑',
  'advance.approved': '💵', 'advance.rejected': '🚫', 'advance.create': '💵', 'advance.delete': '🗑',
  'adjustment.create': '🎁', 'adjustment.delete': '🗑', 'user.create': '👤', 'user.update': '👤',
  'site.create': '🏗️', 'site.update': '🏗️', 'expense.create': '🧱', 'expense.delete': '🗑',
  'payroll.lock': '🔒', 'payroll.unlock': '🔓', 'payroll.paid': '💸', 'payroll.unpaid': '↺',
  'backup.create': '💾', 'backup.delete': '🗑', 'backup.restore': '♻️', 'settings.reminder': '⏰', 'push.remind': '📣',
  'settings.config': '⚙️', 'push.broadcast': '📡', 'security.logout_all': '🚫', 'security.revoke_session': '🚪',
  'security.unblock': '🔓', 'security.impersonate': '🕵️', 'maintenance.vacuum': '⚡', 'maintenance.orphan_photos': '🧹', 'maintenance.old_logs': '🧹',
};
const LOG_FILTERS = [
  ['', 'Tất cả'], ['report', 'Báo công'], ['advance', 'Ứng tiền'], ['adjustment', 'Thưởng/phạt'],
  ['payroll', 'Chốt sổ & Trả lương'], ['site', 'Công trình & Chi phí'], ['user', 'Nhân viên'], ['settings', 'Hệ thống & Bảo mật'],
];
function fmtDateTime(utc) {
  const d = new Date(utc.replace(' ', 'T') + 'Z');
  return `${pad(d.getHours())}:${pad(d.getMinutes())} · ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}
async function renderLogs(box, type = '') {
  const list = h('div', {});
  const more = h('button', { class: 'btn-block mt hidden' }, 'Xem thêm');
  let lastId = null;
  async function load() {
    const q = new URLSearchParams({ limit: 50 });
    if (type) q.set('type', type);
    if (lastId) q.set('before', lastId);
    const rows = await api('/logs?' + q);
    if (!rows.length && !lastId) list.append(h('div', { class: 'empty' }, 'Chưa có thao tác nào'));
    let day = list.dataset.day || '';
    for (const l of rows) {
      const dt = fmtDateTime(l.created_at);
      const d = dt.split(' · ')[1];
      if (d !== day) { list.append(h('div', { class: 'log-day' }, d)); day = d; }
      list.append(h('div', { class: 'log' },
        h('div', { class: 'log-ic' }, LOG_IC[l.action] || '•'),
        h('div', { class: 'grow' },
          h('div', {}, l.detail),
          h('div', { class: 'small muted' }, `${dt.split(' · ')[0]} · ${l.user_name || 'Hệ thống'}`))));
    }
    list.dataset.day = day;
    if (rows.length) lastId = rows[rows.length - 1].id;
    more.classList.toggle('hidden', rows.length < 50);
  }
  more.addEventListener('click', () => { more.disabled = true; load().catch(fail).finally(() => (more.disabled = false)); });
  box.replaceChildren(h('div', { class: 'card' },
    h('div', { class: 'row between wrap', style: 'margin-bottom:10px' }, h('h2', { style: 'margin:0' }, 'Nhật ký thao tác'),
      h('select', { style: 'max-width:170px', onchange: (e) => renderLogs(box, e.target.value).catch(fail) },
        LOG_FILTERS.map(([v, l]) => h('option', { value: v, selected: v === type }, l)))),
    h('div', { class: 'small muted', style: 'margin-bottom:10px' }, 'Ghi lại ai duyệt, sửa, xóa, thưởng/phạt… và lúc nào.'),
    list, more));
  await load();
}

function editUser(u, reload) {
  const isNew = !u;
  const name = h('input', { value: u?.name || '', placeholder: 'Họ tên' });
  const phone = h('input', { type: 'tel', value: u?.phone || '', placeholder: 'Số điện thoại (dùng để đăng nhập)' });
  const pass = h('input', { type: 'text', autocomplete: 'off', placeholder: isNew ? 'Mật khẩu ban đầu' : 'Để trống nếu không đổi' });
  const wage = moneyInput({ value: u?.daily_wage ?? '' });
  const otRate = moneyInput({ value: u?.ot_rate ?? '' });
  const role = h('select', {}, h('option', { value: 'worker', selected: u?.role !== 'admin' }, 'Nhân viên'), h('option', { value: 'admin', selected: u?.role === 'admin' }, 'Quản lý'));
  const active = h('input', { type: 'checkbox', checked: u ? u.active : true });
  const bankSel = h('select', {},
    h('option', { value: '' }, '— Chọn ngân hàng nhận lương (tùy chọn) —'),
    BANKS.map((b) => h('option', { value: b.bin, selected: b.bin === (u?.bank_bin || '') }, `${b.short} – ${b.name}`)));
  const bankAcc = h('input', { value: u?.bank_account || '', placeholder: 'Số tài khoản ngân hàng', maxlength: 40 });
  const bankHolder = h('input', { value: u?.bank_holder || '', placeholder: 'Tên chủ TK (IN HOA KHÔNG DẤU)', maxlength: 80 });
  let close;
  close = openModal(isNew ? 'Thêm nhân viên' : 'Sửa nhân viên', h('div', {},
    field('Họ tên', name), field('Số điện thoại', phone),
    field(isNew ? 'Mật khẩu' : 'Đặt lại mật khẩu', pass, 'Tối thiểu 4 ký tự. Gửi mật khẩu này cho nhân viên để đăng nhập.'),
    h('div', { class: 'grid2' }, field('Lương 1 ngày công', wage), field('Tiền 1 giờ tăng ca', otRate)),
    field('Vai trò', role),
    h('div', { style: 'border-top:1px dashed var(--border);margin:12px 0;padding-top:10px' },
      h('div', { class: 'small muted', style: 'margin-bottom:6px;font-weight:700' }, '🏧 THÔNG TIN NGÂN HÀNG NHẬN LƯƠNG (VIETQR)'),
      field('Ngân hàng', bankSel),
      h('div', { class: 'grid2' },
        field('Số tài khoản', bankAcc),
        field('Chủ tài khoản', bankHolder))),
    h('label', { class: 'f row' }, active, h('span', { style: 'margin:0' }, 'Đang làm việc (bỏ chọn để khóa tài khoản)')),
    actionBtn(isNew ? 'Tạo tài khoản' : 'Lưu', 'btn-primary btn-block', async () => {
      const bObj = bankByBin(bankSel.value);
      const body = {
        name: name.value,
        phone: phone.value,
        daily_wage: wage.getValue(),
        ot_rate: otRate.getValue(),
        role: role.value,
        active: active.checked,
        bank_bin: bankSel.value,
        bank_name: bObj ? bObj.short : '',
        bank_account: bankAcc.value.trim(),
        bank_holder: stripVN(bankHolder.value || name.value),
      };
      if (pass.value) body.password = pass.value;
      if (isNew) await api('/users', { method: 'POST', body });
      else await api('/users/' + u.id, { method: 'PUT', body });
      toast(isNew ? `Đã tạo tài khoản. Đăng nhập: ${phone.value} / ${pass.value}` : 'Đã lưu');
      close(); reload();
    }),
    !isNew ? h('div', { class: 'small muted mt' }, 'Đổi mức lương chỉ áp dụng cho các báo công được duyệt sau thời điểm đổi.') : null));
}

function editSite(s, reload) {
  const isNew = !s;
  const name = h('input', { value: s?.name || '', placeholder: 'Ví dụ: Nhà anh Tuấn – Q.7' });
  const addr = h('input', { value: s?.address || '', placeholder: 'Địa chỉ (không bắt buộc)' });
  const active = h('input', { type: 'checkbox', checked: s ? !!s.active : true });
  let close;
  close = openModal(isNew ? 'Thêm công trình' : 'Sửa công trình', h('div', {},
    field('Tên công trình', name), field('Địa chỉ', addr),
    h('label', { class: 'f row' }, active, h('span', { style: 'margin:0' }, 'Đang thi công (bỏ chọn để ẩn khỏi danh sách báo công)')),
    actionBtn('Lưu', 'btn-primary btn-block', async () => {
      const body = { name: name.value, address: addr.value, active: active.checked };
      if (isNew) await api('/sites', { method: 'POST', body });
      else await api('/sites/' + s.id, { method: 'PUT', body });
      await loadSites(); toast('Đã lưu'); close(); reload();
    })));
}

// ================= QUẢN TRỊ WEBSITE (STANDALONE WEBMASTER PORTAL) =================
const WEBADMIN_NAV = [
  { id: 'overview', icon: '📊', label: 'Tổng quan & Máy chủ', sub: 'RAM, CPU, lưu trữ & bảo trì CSDL' },
  { id: 'users', icon: '👥', label: 'Tài khoản Hệ thống', sub: 'Quản lý, cấp lại mật khẩu & phân quyền' },
  { id: 'config', icon: '⚙️', label: 'Cấu hình Website', sub: 'Thương hiệu, quy tắc chấm công & bảo trì' },
  { id: 'security', icon: '🔐', label: 'Bảo mật & Admin', sub: 'Đổi mật khẩu Webmaster, mở khóa IP & phiên' },
  { id: 'comms', icon: '📣', label: 'Thông báo & Nhật ký', sub: 'Phát Push thông báo & lịch sử hệ thống' },
];

function exitAdminPortal() {
  if (location.pathname.startsWith('/admin')) {
    history.pushState(null, '', '/#/');
  } else {
    location.hash = '#/';
  }
  boot();
}

function goWebAdminTab(tab) {
  const target = '#/admin/' + tab;
  if (location.hash === target) routeWebAdmin();
  else location.hash = target;
}

async function routeWebAdmin() {
  stopPolling();
  if (state.webAdmin === null) {
    try {
      const r = await api('/webadmin/me');
      if (r.config) applySiteConfig(r.config);
      state.webAdmin = r.username ? { username: r.username } : false;
    } catch {
      state.webAdmin = false;
    }
  }
  if (!state.webAdmin) return renderWebAdminAuth();

  const m = location.hash.match(/^#\/?admin(?:\/([a-z0-9_-]+))?/i);
  const rawTab = m && m[1] ? m[1].toLowerCase() : 'overview';
  const validTabs = WEBADMIN_NAV.map((n) => n.id);
  const tab = validTabs.includes(rawTab) ? rawTab : 'overview';

  const box = h('div', {},
    h('div', { class: 'card' },
      h('div', { class: 'skel lg', style: 'width:45%;margin-bottom:14px' }),
      h('div', { class: 'skel', style: 'width:100%;margin-bottom:10px' }),
      h('div', { class: 'skel', style: 'width:80%' })));
  $app.replaceChildren(webAdminShell(tab, box));
  window.scrollTo(0, 0);
  try {
    await viewSystemAdmin(box, tab);
  } catch (e) {
    if (e.message && e.message.toLowerCase().includes('quản trị website')) {
      state.webAdmin = false;
      return renderWebAdminAuth();
    }
    box.replaceChildren(h('div', { class: 'errbox' }, e.message));
  }
}

function renderWebAdminAuth() {
  stopPolling();
  const userIn = h('input', {
    type: 'text',
    placeholder: 'Nhập tài khoản quản trị (mặc định: admin)',
    autocomplete: 'username',
    value: 'admin',
  });
  const passIn = h('input', {
    type: 'password',
    placeholder: 'Nhập mật khẩu quản trị web',
    autocomplete: 'current-password',
  });
  const eye = h('button', {
    type: 'button',
    class: 'eye',
    'aria-label': 'Hiện mật khẩu',
    onclick: () => {
      passIn.type = passIn.type === 'password' ? 'text' : 'password';
      eye.textContent = passIn.type === 'password' ? '👁' : '🙈';
    },
  }, '👁');
  const errBox = h('div', { class: 'errbox hidden' });
  const btn = h('button', { class: 'btn-primary btn-block', type: 'submit' }, '🔐 Đăng nhập Cổng Quản trị →');

  const form = h('form', {
    class: 'card auth-card',
    onsubmit: async (e) => {
      e.preventDefault();
      errBox.classList.add('hidden');
      const username = userIn.value.trim();
      const password = passIn.value;
      if (!username || !password) {
        errBox.textContent = 'Vui lòng nhập đầy đủ tài khoản và mật khẩu quản trị website';
        errBox.classList.remove('hidden');
        return;
      }
      btn.disabled = true;
      try {
        const r = await api('/webadmin/login', { method: 'POST', body: { username, password } });
        if (r.config) applySiteConfig(r.config);
        state.webAdmin = { username: r.username };
        toast('🛡️ Đăng nhập Quản trị Website thành công!');
        routeWebAdmin();
      } catch (ex) {
        errBox.textContent = ex.message;
        errBox.classList.remove('hidden');
      } finally {
        btn.disabled = false;
      }
    },
  },
  h('h2', {}, '🛡️ Đăng nhập Quản Trị Website'),
  errBox,
  h('div', { class: 'warnbox', style: 'margin-bottom:14px;font-size:12.5px' },
    '🔒 Cổng đăng nhập độc lập dành riêng cho ', h('b', {}, 'Người quản lý Website (Webmaster)'),
    '. Sử dụng tài khoản & mật khẩu quản trị riêng, không dùng chung với tài khoản SĐT chấm công.'),
  field('Tài khoản Quản trị Website', userIn),
  field('Mật khẩu Quản trị Website', h('div', { class: 'pw' }, passIn, eye)),
  btn,
  !navigator.userAgent.includes('TBTWebAdminAPK')
    ? h('a', {
        href: '/download/TBT-QuanTriWeb.apk',
        download: 'TBT-QuanTriWeb-v2.0.0.apk',
        class: 'btn btn-ok btn-block mt',
        style: 'text-decoration:none',
      }, '📱 Tải ứng dụng Android (.APK) cho Webmaster')
    : null,
  h('button', {
    type: 'button',
    class: 'btn-ghost btn-block mt',
    onclick: exitAdminPortal,
  }, '← Quay về trang Chấm công chính'));

  $app.replaceChildren(
    h('div', { class: 'auth-bg' },
      h('div', { class: 'auth-wrap' },
        h('div', { class: 'auth-hero' },
          h('div', { class: 'brand-mark lg', style: 'background:linear-gradient(135deg,#6366f1,#4f46e5)' }, '🛡️'),
          h('h1', {}, 'Quản Trị Website'),
          h('p', { class: 'sub' }, `${BRAND.app} · Hệ thống điều hành độc lập dành riêng cho Người quản lý Website`),
          h('div', { class: 'auth-features' },
            h('div', { class: 'auth-feat' },
              h('div', { class: 'auth-feat-ic' }, '👥'),
              h('div', {}, h('strong', {}, 'Quản lý toàn bộ Tài khoản & Mật khẩu'), h('span', {}, 'Cấp lại mật khẩu 1 chạm cho Quản lý đội / Nhân viên, phân quyền hoặc mở khóa đăng nhập.'))),
            h('div', { class: 'auth-feat' },
              h('div', { class: 'auth-feat-ic' }, '⚙️'),
              h('div', {}, h('strong', {}, 'Cấu hình Thương hiệu & Vận hành'), h('span', {}, 'Tùy chỉnh tên web, thông báo toàn hệ thống, số ngày báo bù, chế độ bảo trì.'))),
            h('div', { class: 'auth-feat' },
              h('div', { class: 'auth-feat-ic' }, '🗄️'),
              h('div', {}, h('strong', {}, 'Giám sát Máy chủ & Sao lưu CSDL'), h('span', {}, 'Theo dõi RAM, dung lượng đĩa, nén tối ưu SQLite, dọn ảnh rác và tải bản sao lưu.'))))),
        h('div', { class: 'auth' }, form, credit())))
  );
}

function webAdminShell(activeTab, content) {
  const curNav = WEBADMIN_NAV.find((n) => n.id === activeTab) || WEBADMIN_NAV[0];

  const doLogoutWebAdmin = async () => {
    if (!confirmBox('Đăng xuất khỏi Cổng Quản trị Website?')) return;
    await api('/webadmin/logout', { method: 'POST' });
    state.webAdmin = false;
    toast('Đã đăng xuất khỏi Quản trị Website');
    renderWebAdminAuth();
  };

  const themeBtn = h('button', {
    type: 'button',
    class: 'icon-btn',
    title: 'Đổi chế độ Sáng / Tối',
    onclick: () => {
      const next = isDarkNow() ? 'light' : 'dark';
      setTheme(next);
      themeBtn.textContent = isDarkNow() ? '☀️' : '🌙';
    },
  }, isDarkNow() ? '☀️' : '🌙');

  const sidebar = h('aside', { class: 'sidebar' },
    h('div', { class: 'sidebar-brand', style: 'cursor:pointer', onclick: () => goWebAdminTab('overview') },
      h('div', { class: 'brand-mark', style: 'background:linear-gradient(135deg,#6366f1,#4f46e5)' }, '🛡️'),
      h('div', {},
        h('h2', {}, 'Quản Trị Web'),
        h('p', {}, `${BRAND.app} · v${BRAND.version}`))),
    h('nav', { class: 'sidebar-nav' },
      WEBADMIN_NAV.map((n) => h('a', {
        href: '#/admin/' + n.id,
        class: activeTab === n.id ? 'active' : '',
      },
      h('span', { class: 'ic' }, n.icon),
      h('span', {}, n.label))),
      h('a', {
        href: '#/',
        onclick: (e) => { e.preventDefault(); exitAdminPortal(); },
        style: 'margin-top:10px;border-top:1px solid var(--border);padding-top:12px',
      },
      h('span', { class: 'ic' }, '🏠'),
      h('span', {}, 'Trang Chấm công chính'))),
    h('div', { class: 'sidebar-foot' },
      h('div', { class: 'sidebar-user' },
        h('div', { class: 'avatar sm' }, 'AD'),
        h('div', { class: 'grow', style: 'min-width:0' },
          h('strong', {}, state.webAdmin?.username || 'admin'),
          h('span', {}, '🛡️ Webmaster')),
        h('button', {
          type: 'button',
          class: 'btn-ghost btn-sm',
          title: 'Đăng xuất Quản trị Website',
          onclick: doLogoutWebAdmin,
        }, '🚪'))));

  const workspace = h('div', { class: 'workspace' },
    h('header', { class: 'topbar' },
      h('div', { class: 'topbar-in' },
        h('div', { class: 'brand-mark', style: 'background:linear-gradient(135deg,#6366f1,#4f46e5)' }, '🛡️'),
        h('div', { class: 'grow' },
          h('div', { class: 'hello' }, `Webmaster (${state.webAdmin?.username || 'admin'}) · Cổng Quản trị Độc lập`),
          h('h1', {}, `${curNav.icon} ${curNav.label}`)),
        h('button', {
          type: 'button',
          class: 'btn-ghost btn-sm',
          onclick: exitAdminPortal,
          title: 'Quay về trang Chấm công chính',
        }, '🏠 Chấm công'),
        h('div', { class: 'clock-pill', title: 'Giờ hệ thống trực tiếp' },
          h('span', { class: 'live-clock' }, fmtClock())),
        themeBtn,
        h('button', {
          type: 'button',
          class: 'btn-bad btn-sm',
          onclick: doLogoutWebAdmin,
          title: 'Đăng xuất khỏi Quản trị Website',
        }, '🚪 Thoát'))),
    h('main', { class: 'fade-in' }, content, credit()),
    h('nav', { class: 'bottom' },
      WEBADMIN_NAV.map((n) => h('a', {
        href: '#/admin/' + n.id,
        class: activeTab === n.id ? 'active' : '',
      },
      h('span', { class: 'ic' }, n.icon),
      h('span', { class: 'lb' }, n.label.split(' ').slice(0, 2).join(' '))))));

  return h('div', { class: 'app-layout' }, sidebar, workspace);
}

function quickResetUserPasswordModal(u, reload) {
  const passIn = h('input', {
    type: 'text',
    placeholder: 'Nhập mật khẩu mới (ít nhất 4 ký tự)',
    value: '123456',
  });
  let close;
  close = openModal(`🔑 Đặt lại mật khẩu: ${u.name}`, h('div', {},
    h('div', { class: 'okbox', style: 'margin-bottom:12px' },
      `Tài khoản: `, h('b', {}, u.name), ` · SĐT đăng nhập: `, h('b', {}, u.phone),
      h('div', { class: 'small muted' }, `Vai trò: ${u.role === 'admin' ? '👑 Quản lý đội' : '👷 Nhân viên'}`)),
    field('Mật khẩu mới cấp cho tài khoản này', passIn, 'Sau khi lưu, người dùng có thể đăng nhập ngay bằng SĐT và mật khẩu mới này.'),
    actionBtn('💾 Lưu mật khẩu mới & Mở khóa đăng nhập', 'btn-primary btn-block mt', async () => {
      const newPass = passIn.value.trim();
      if (newPass.length < 4) throw new Error('Mật khẩu phải có ít nhất 4 ký tự');
      await api('/users/' + u.id, {
        method: 'PUT',
        body: {
          name: u.name,
          phone: u.phone,
          daily_wage: u.daily_wage,
          ot_rate: u.ot_rate,
          role: u.role,
          active: true,
          password: newPass,
        },
      });
      await api('/admin/unblock-logins', { method: 'POST' });
      toast(`✅ Đã đặt lại mật khẩu cho ${u.name} (${u.phone}) thành: ${newPass}`);
      close();
      reload();
    })));
}

function fmtBytes(n) {
  if (!n || n <= 0) return '0 KB';
  if (n >= 1048576) return (n / 1048576).toFixed(2) + ' MB';
  return Math.max(1, Math.round(n / 1024)) + ' KB';
}
function fmtUptime(sec) {
  const d = Math.floor(sec / 86400);
  const hr = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (d > 0) return `${d}d ${hr}h ${m}m`;
  if (hr > 0) return `${hr}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}

async function viewSystemAdmin(box, tab = 'overview') {
  const ov = await api('/admin/overview');
  applySiteConfig(ov.config);
  const { server, storage, counts, config } = ov;
  const totalStorage = (storage.db_bytes + storage.wal_bytes + storage.upload_bytes + storage.backup_bytes) || 1;
  const reload = () => viewSystemAdmin(box, tab);

  const hero = h('div', { class: 'admin-hero' },
    h('div', { class: 'admin-hero-in' },
      h('div', {},
        h('div', { class: 'status-pill' + (config.maintenance_mode ? ' maint' : '') },
          h('span', { class: 'status-dot' }),
          config.maintenance_mode ? 'ĐANG BẬT CHẾ ĐỘ BẢO TRÌ' : 'HỆ THỐNG HOẠT ĐỘNG ỔN ĐỊNH'),
        h('h2', {}, '🛡️ Trung tâm Quản trị Website & Hệ thống'),
        h('div', { class: 'admin-hero-sub' }, `${BRAND.app} · v${BRAND.version} · Webmaster: ${ov.webadmin?.username || state.webAdmin?.username || 'admin'} · Múi giờ ${server.tz}`)),
      h('div', { class: 'row wrap' },
        !navigator.userAgent.includes('TBTWebAdminAPK')
          ? h('a', {
              href: '/download/TBT-QuanTriWeb.apk',
              download: 'TBT-QuanTriWeb-v2.0.0.apk',
              class: 'btn btn-sm btn-ok',
              style: 'text-decoration:none',
            }, '📱 Tải App Android (.APK)')
          : h('span', { class: 'badge b-approved' }, '📱 Đang dùng App Android'),
        actionBtn('🔄 Làm mới số liệu', 'btn-sm', reload))),
    h('div', { class: 'server-pills' },
      h('span', { class: 'srv-pill' }, '⏱ Uptime: ', h('b', {}, fmtUptime(server.uptime_sec))),
      h('span', { class: 'srv-pill' }, '🧠 RAM tiến trình: ', h('b', {}, fmtBytes(server.rss_bytes))),
      h('span', { class: 'srv-pill' }, '⚙️ Runtime: ', h('b', {}, `Node ${server.node} · ${server.platform}`)),
      h('span', { class: 'srv-pill' }, '🗄️ Lưu trữ: ', h('b', {}, fmtBytes(totalStorage)))));

  const tabs = h('div', { class: 'tabs' },
    h('button', { class: tab === 'overview' ? 'on' : '', onclick: () => goWebAdminTab('overview') }, '📊 Tổng quan & Máy chủ'),
    h('button', { class: tab === 'users' ? 'on' : '', onclick: () => goWebAdminTab('users') }, `👥 Tài khoản Hệ thống (${counts.users_total})`),
    h('button', { class: tab === 'config' ? 'on' : '', onclick: () => goWebAdminTab('config') }, '⚙️ Cấu hình Website'),
    h('button', { class: tab === 'security' ? 'on' : '', onclick: () => goWebAdminTab('security') }, `🔐 Bảo mật & Admin (${counts.sessions_active})`),
    h('button', { class: tab === 'comms' ? 'on' : '', onclick: () => goWebAdminTab('comms') }, '📣 Thông báo & Nhật ký'));

  const content = h('div', {});
  box.replaceChildren(hero, tabs, content);

  if (tab === 'overview') {
    const dbBytes = storage.db_bytes + storage.wal_bytes;
    const dbPct = Math.max(2, Math.round((dbBytes / totalStorage) * 100));
    const phPct = Math.max(2, Math.round((storage.upload_bytes / totalStorage) * 100));
    const bkPct = Math.max(2, 100 - dbPct - phPct);

    const kpis = h('div', { class: 'kpi-grid' },
      h('div', { class: 'kpi-card', style: 'cursor:pointer', onclick: () => goWebAdminTab('users') },
        h('div', { class: 'kpi-top' }, h('span', {}, 'TÀI KHOẢN HỆ THỐNG'), h('div', { class: 'kpi-ic' }, '👥')),
        h('div', { class: 'kpi-val' }, counts.users_total),
        h('div', { class: 'kpi-sub' }, `${counts.workers_active} thợ · ${counts.admins_active} quản lý · Bấm để quản lý`)),
      h('div', { class: 'kpi-card' },
        h('div', { class: 'kpi-top' }, h('span', {}, 'BẢN GHI BÁO CÔNG'), h('div', { class: 'kpi-ic' }, '📋')),
        h('div', { class: 'kpi-val' }, counts.reports_total),
        h('div', { class: 'kpi-sub' }, `${counts.reports_approved} duyệt · ${counts.reports_pending} chờ · ${counts.reports_rejected} từ chối`)),
      h('div', { class: 'kpi-card', style: 'cursor:pointer', onclick: () => goWebAdminTab('security') },
        h('div', { class: 'kpi-top' }, h('span', {}, 'PHIÊN & THÔNG BÁO'), h('div', { class: 'kpi-ic' }, '🔐')),
        h('div', { class: 'kpi-val' }, `${counts.sessions_active} / ${counts.push_users_total}`),
        h('div', { class: 'kpi-sub' }, `${counts.sessions_active} phiên đăng nhập · ${counts.push_subs_total} thiết bị Push`)),
      h('div', { class: 'kpi-card' },
        h('div', { class: 'kpi-top' }, h('span', {}, 'CÔNG TRÌNH & SỔ'), h('div', { class: 'kpi-ic' }, '🏗️')),
        h('div', { class: 'kpi-val' }, `${counts.sites_active}/${counts.sites_total}`),
        h('div', { class: 'kpi-sub' }, `${counts.locked_months} tháng đã chốt · ${counts.audit_logs_total} nhật ký`)));

    const storageCard = h('div', { class: 'card' },
      h('div', { class: 'row between wrap' },
        h('h2', { style: 'margin:0' }, '💽 Phân bổ Dung lượng Lưu trữ trên Máy chủ'),
        h('strong', { style: 'font-family:var(--mono);color:var(--primary)' }, fmtBytes(totalStorage))),
      h('div', { class: 'storage-bar' },
        h('div', { class: 'st-seg db', style: `width:${dbPct}%`, title: 'Cơ sở dữ liệu SQLite' }),
        h('div', { class: 'st-seg ph', style: `width:${phPct}%`, title: 'Ảnh chụp báo công' }),
        h('div', { class: 'st-seg bk', style: `width:${bkPct}%`, title: 'Các bản sao lưu' })),
      h('div', { class: 'storage-legend' },
        h('span', {}, h('i', { style: 'background:#3b82f6' }), `CSDL SQLite + WAL: ${fmtBytes(dbBytes)}`),
        h('span', {}, h('i', { style: 'background:#8b5cf6' }), `Ảnh báo công (${storage.upload_files} ảnh): ${fmtBytes(storage.upload_bytes)}`),
        h('span', {}, h('i', { style: 'background:#10b981' }), `Sao lưu (${storage.backup_files} bản): ${fmtBytes(storage.backup_bytes)}`)));

    const maintCard = h('div', { class: 'card' },
      h('h2', {}, '🛠️ Công cụ Bảo trì & Tối ưu Máy chủ'),
      h('div', { class: 'small muted', style: 'margin-bottom:12px' }, 'Thực hiện dọn dẹp tài nguyên thừa và chống phân mảnh cơ sở dữ liệu.'),
      h('div', { class: 'item row between' },
        h('div', {},
          h('strong', {}, '⚡ Tối ưu & Nén CSDL (VACUUM & ANALYZE)'),
          h('div', { class: 'small muted' }, `Hiện tại: ${fmtBytes(dbBytes)} · Sắp xếp lại chỉ mục và thu hồi vùng trống`)),
        actionBtn('Chạy tối ưu', 'btn-sm btn-primary', async () => {
          const r = await api('/admin/maintenance/cleanup', { method: 'POST', body: { action: 'vacuum' } });
          toast(r.message); reload();
        })),
      h('div', { class: 'item row between' },
        h('div', {},
          h('strong', {}, '🧹 Dọn ảnh rác (Orphaned Photos)'),
          h('div', { class: 'small muted' }, storage.orphan_photos ? `Phát hiện ${storage.orphan_photos} file ảnh không gắn với báo công nào` : 'Không có ảnh thừa nào trên đĩa')),
        actionBtn(`Dọn ảnh (${storage.orphan_photos})`, 'btn-sm', async () => {
          const r = await api('/admin/maintenance/cleanup', { method: 'POST', body: { action: 'orphan_photos' } });
          toast(r.message); reload();
        })),
      h('div', { class: 'item row between' },
        h('div', {},
          h('strong', {}, '🔑 Dọn phiên đăng nhập đã hết hạn'),
          h('div', { class: 'small muted' }, 'Xóa các token phiên cũ không còn hiệu lực trong bảng sessions')),
        actionBtn('Dọn phiên', 'btn-sm', async () => {
          const r = await api('/admin/maintenance/cleanup', { method: 'POST', body: { action: 'expired_sessions' } });
          toast(r.message); reload();
        })),
      h('div', { class: 'item row between' },
        h('div', {},
          h('strong', {}, '📜 Dọn nhật ký cũ (> 90 ngày)'),
          h('div', { class: 'small muted' }, `Tổng hiện có: ${counts.audit_logs_total} dòng nhật ký thao tác`)),
        actionBtn('Dọn nhật ký cũ', 'btn-sm', async () => {
          if (!confirmBox('Xóa các dòng nhật ký thao tác cũ hơn 90 ngày?')) return;
          const r = await api('/admin/maintenance/cleanup', { method: 'POST', body: { action: 'old_logs' } });
          toast(r.message); reload();
        })));

    const backupBox = h('div', { class: 'card' }, h('div', { class: 'empty' }, 'Đang tải danh sách sao lưu…'));
    renderBackupCard(backupBox, true);

    const analytics = ov.analytics || { daily_14d: [], top_workers: [], site_costs: [] };
    const chart14dCard = h('div', { class: 'card' },
      h('div', { class: 'row between wrap' },
        h('h2', { style: 'margin:0' }, '📈 Xu hướng Báo công 14 ngày gần nhất'),
        h('span', { class: 'small muted' }, 'Tổng số công được duyệt mỗi ngày trên toàn hệ thống')),
      analytics.daily_14d.length
        ? barChart(analytics.daily_14d.map((d) => ({
            label: d.date.slice(8) + '/' + d.date.slice(5, 7),
            value: d.work_days,
          })), { height: 155, highlightLast: true })
        : h('div', { class: 'empty' }, 'Chưa có dữ liệu 14 ngày gần nhất'));

    const topWorkersCard = h('div', { class: 'card' },
      h('h2', {}, '🏆 Top Nhân viên Chuyên cần (30 ngày qua)'),
      analytics.top_workers.length
        ? hBars(analytics.top_workers.map((w) => ({
            label: `${w.name} (${w.phone})${w.ot_hours ? ` · +${fmtNum(w.ot_hours)}h TC` : ''}`,
            value: w.work_days,
          })), (v) => fmtNum(v) + ' công')
        : h('div', { class: 'empty' }, 'Chưa có dữ liệu báo công trong 30 ngày qua'));

    const topSitesCard = h('div', { class: 'card' },
      h('h2', {}, '🏗️ Phân bổ Chi phí Công & Vật tư theo Công trình'),
      analytics.site_costs.length
        ? hBars(analytics.site_costs.map((s) => ({
            label: `${s.name} (${fmtNum(s.work_days)} công)`,
            value: s.total_cost,
          })), fmtMoney)
        : h('div', { class: 'empty' }, 'Chưa có chi phí công trình nào'));

    const locksCard = h('div', { class: 'card' },
      h('h2', {}, `🔒 Quản lý Chốt sổ Tháng (${ov.locked_months_list.length})`),
      ov.locked_months_list.length
        ? ov.locked_months_list.map((m) => h('div', { class: 'item row between' },
          h('div', {},
            h('strong', {}, `Tháng ${m.month.slice(5)}/${m.month.slice(0, 4)}`),
            h('div', { class: 'small muted' }, `Chốt lúc ${fmtDateTime(m.locked_at)} bởi ${m.locked_by_name || 'Quản lý'}${m.note ? ' · ' + m.note : ''}`)),
          actionBtn('🔓 Mở khóa', 'btn-sm', async () => {
            if (!confirmBox(`Mở khóa sổ tháng ${m.month}?`)) return;
            await api('/payroll/lock', { method: 'POST', body: { month: m.month, locked: false } });
            toast('🔓 Đã mở khóa tháng ' + m.month); reload();
          })))
        : h('div', { class: 'small muted' }, 'Chưa có tháng nào đang khóa sổ. Bạn có thể chốt sổ trong mục Bảng lương.'));

    content.append(
      kpis,
      chart14dCard,
      h('div', { class: 'admin-grid2' }, topWorkersCard, topSitesCard),
      storageCard,
      h('div', { class: 'admin-grid2' }, maintCard, h('div', {}, backupBox, locksCard)),
    );
  } else if (tab === 'users') {
    const users = await api('/users');
    const reloadUsers = () => viewSystemAdmin(box, 'users');

    const usersCard = h('div', { class: 'card' },
      h('div', { class: 'row between wrap', style: 'margin-bottom:12px' },
        h('div', {},
          h('h2', { style: 'margin:0' }, `👥 Toàn bộ Tài khoản trên Website (${users.length})`),
          h('div', { class: 'small muted' }, 'Quản lý tất cả tài khoản Quản lý đội và Nhân viên. Bấm "🕵️ Vào thử TK" để đăng nhập trực tiếp vào giao diện của họ mà không cần mật khẩu.')),
        h('button', { class: 'btn-primary btn-sm', onclick: () => editUser(null, reloadUsers) }, '+ Tạo tài khoản mới')),
      users.length
        ? users.map((u) => h('div', { class: 'item row between wrap' },
          h('div', { class: 'row', style: 'gap:12px' },
            h('div', { class: 'avatar sm' }, initials(u.name)),
            h('div', {},
              h('div', { class: 'row wrap', style: 'gap:6px' },
                h('strong', {}, u.name),
                h('span', { class: 'badge ' + (u.role === 'admin' ? 'b-approved' : 'b-off') },
                  u.role === 'admin' ? '👑 Quản lý đội' : '👷 Nhân viên'),
                !u.active ? h('span', { class: 'badge b-rejected' }, '🔒 Đã khóa') : h('span', { class: 'badge b-pending' }, '🟢 Hoạt động'),
                u.bank_account ? h('span', { class: 'badge b-approved' }, `🏧 ${u.bank_name || u.bank_bin} • ${u.bank_account}`) : null),
              h('div', { class: 'small muted' },
                `SĐT đăng nhập: `, h('b', {}, u.phone),
                ` · Lương: ${fmtMoney(u.daily_wage)}/ngày · TC: ${fmtMoney(u.ot_rate)}/h`))),
          h('div', { class: 'row wrap', style: 'gap:6px' },
            actionBtn('🕵️ Vào thử TK', 'btn-sm btn-ok', async () => {
              const r = await api('/admin/impersonate/' + u.id, { method: 'POST' });
              state.user = r.user;
              state.isWebAdmin = true;
              toast(`🕵️ Đang vào thử với tư cách: ${u.name} (${u.role === 'admin' ? 'Quản lý' : 'Nhân viên'})`);
              exitAdminPortal();
            }),
            h('button', {
              class: 'btn-sm btn-primary',
              onclick: () => quickResetUserPasswordModal(u, reloadUsers),
            }, '🔑 Đặt lại mật khẩu'),
            h('button', {
              class: 'btn-sm',
              onclick: () => editUser(u, reloadUsers),
            }, '✏️ Sửa / Ngân hàng'),
            actionBtn('🗑️ Xóa', 'btn-sm btn-bad', async () => {
              if (!confirmBox(`Xóa vĩnh viễn tài khoản "${u.name}" (${u.phone}) cùng dữ liệu liên quan?`)) return;
              await api('/admin/users/' + u.id, { method: 'DELETE' });
              toast(`Đã xóa tài khoản ${u.name}`);
              reloadUsers();
            }))))
        : h('div', { class: 'empty' }, 'Chưa có tài khoản nào trong hệ thống'));

    content.append(usersCard);
  } else if (tab === 'config') {
    const siteTitle = h('input', { value: config.site_title || '', maxlength: 80 });
    const siteSlogan = h('input', { value: config.site_slogan || '', maxlength: 160 });
    const brandTeam = h('input', { value: config.brand_team || '', maxlength: 20 });
    const brandDev = h('input', { value: config.brand_dev || '', maxlength: 80 });
    const brandDevLink = h('input', { value: config.brand_dev_link || '', placeholder: 'https://zalo.me/... hoặc để trống', maxlength: 300 });
    const sysBanner = h('textarea', { value: config.system_banner || '', placeholder: 'Để trống nếu không muốn hiện thông báo. Vd: Thứ 7 tuần này toàn đội tập trung lúc 6h30 tại công trình Q.7!', maxlength: 500 });

    const backdateDays = h('input', { type: 'number', min: 0, max: 30, value: config.backdate_days ?? 3 });
    const defIn = h('input', { type: 'time', value: config.default_check_in || '07:00' });
    const defOut = h('input', { type: 'time', value: config.default_check_out || '17:00' });
    const reqPhoto = h('input', { type: 'checkbox', checked: !!config.require_photo });
    const reqGps = h('input', { type: 'checkbox', checked: !!config.require_gps });
    const maintMode = h('input', { type: 'checkbox', checked: !!config.maintenance_mode });

    const saveBtn = actionBtn('💾 Lưu toàn bộ cấu hình Website', 'btn-primary btn-block mt', async () => {
      const updated = await api('/admin/config', {
        method: 'PUT',
        body: {
          site_title: siteTitle.value,
          site_slogan: siteSlogan.value,
          brand_team: brandTeam.value,
          brand_dev: brandDev.value,
          brand_dev_link: brandDevLink.value,
          system_banner: sysBanner.value,
          backdate_days: Number(backdateDays.value || 0),
          default_check_in: defIn.value,
          default_check_out: defOut.value,
          require_photo: reqPhoto.checked,
          require_gps: reqGps.checked,
          maintenance_mode: maintMode.checked,
        },
      });
      applySiteConfig(updated);
      if (state.me) state.me.backdate_days = updated.backdate_days;
      toast('✅ Đã lưu và áp dụng cấu hình Website tức thì!');
      routeWebAdmin();
    });

    content.append(
      h('div', { class: 'admin-grid2' },
        h('div', { class: 'card' },
          h('h2', {}, '🌐 Thương hiệu & Thông báo Website'),
          field('Tên Website / Ứng dụng', siteTitle),
          field('Khẩu hiệu (Slogan)', siteSlogan),
          h('div', { class: 'grid2' },
            field('Chữ viết tắt Logo', brandTeam, 'Tối đa 3–4 ký tự (vd: TBT)'),
            field('Tên Quản trị / Đơn vị phát triển', brandDev)),
          field('Liên kết hỗ trợ (Zalo / Facebook / Website)', brandDevLink),
          field('📢 Thông báo toàn hệ thống (hiển thị đầu trang mọi nhân viên)', sysBanner)),
        h('div', { class: 'card' },
          h('h2', {}, '📋 Quy tắc Chấm công & Vận hành'),
          field('Số ngày cho phép báo công bù tối đa (0–30 ngày)', backdateDays, 'Đặt 0 nếu chỉ cho phép báo công đúng trong ngày hôm đó'),
          h('div', { class: 'grid2' },
            field('Giờ vào ca mặc định', defIn),
            field('Giờ tan ca mặc định', defOut)),
          h('div', { class: 'mt' },
            h('label', { class: 'switch-row' },
              h('div', {}, h('strong', {}, '📸 Bắt buộc chụp ảnh tại công trình'), h('span', {}, 'Nhân viên phải chụp ảnh mới gửi được báo công đi làm')),
              reqPhoto),
            h('label', { class: 'switch-row' },
              h('div', {}, h('strong', {}, '📍 Bắt buộc lấy tọa độ GPS'), h('span', {}, 'Yêu cầu bật định vị vị trí khi gửi báo công')),
              reqGps),
            h('label', { class: 'switch-row' },
              h('div', {}, h('strong', {}, '🚧 Chế độ Bảo trì hệ thống'), h('span', {}, 'Tạm ngưng nhân viên gửi báo công mới (Quản lý vẫn thao tác bình thường)')),
              maintMode)),
          saveBtn)));
  } else if (tab === 'security') {
    const secData = await api('/admin/sessions');
    const reloadSec = () => viewSystemAdmin(box, 'security');

    const newAdminUser = h('input', { value: state.webAdmin?.username || ov.webadmin?.username || 'admin', maxlength: 40 });
    const curAdminPass = h('input', { type: 'password', placeholder: 'Nhập mật khẩu Quản trị Website hiện tại' });
    const newAdminPass = h('input', { type: 'password', placeholder: 'Nhập mật khẩu mới (để trống nếu chỉ đổi tên tài khoản)' });

    const credsCard = h('div', { class: 'card' },
      h('h2', {}, '🔑 Tài khoản & Mật khẩu Quản trị Website (Webmaster)'),
      h('div', { class: 'small muted', style: 'margin-bottom:12px' },
        'Đây là tài khoản độc lập dùng riêng để đăng nhập vào Cổng Quản trị Website (/admin).'),
      h('div', { class: 'grid2' },
        field('Tên tài khoản Quản trị Website', newAdminUser),
        field('Mật khẩu hiện tại (bắt buộc để xác nhận)', curAdminPass)),
      field('Mật khẩu Quản trị Website mới', newAdminPass, 'Tối thiểu 4 ký tự. Hãy ghi nhớ kỹ sau khi thay đổi.'),
      actionBtn('💾 Cập nhật Tài khoản / Mật khẩu Quản trị Web', 'btn-primary', async () => {
        if (!curAdminPass.value) throw new Error('Vui lòng nhập mật khẩu Quản trị Website hiện tại');
        const r = await api('/admin/credentials', {
          method: 'PUT',
          body: {
            current_password: curAdminPass.value,
            new_username: newAdminUser.value.trim(),
            new_password: newAdminPass.value,
          },
        });
        state.webAdmin = { username: r.username };
        toast('✅ Đã cập nhật thông tin đăng nhập Quản trị Website!');
        routeWebAdmin();
      }));

    const lockoutsCard = h('div', { class: 'card' },
      h('div', { class: 'row between wrap' },
        h('h2', { style: 'margin:0' }, '🛡️ Chống dò mật khẩu (Brute-force Protection)'),
        actionBtn('🔓 Mở khóa tất cả IP/SĐT', 'btn-sm', async () => {
          await api('/admin/unblock-logins', { method: 'POST' });
          toast('🔓 Đã xóa toàn bộ bộ đếm khóa đăng nhập sai'); reloadSec();
        })),
      h('div', { class: 'small muted mt' }, 'Hệ thống tự động khóa tạm thời 15 phút nếu một IP nhập sai mật khẩu quá 10 lần liên tiếp.'),
      secData.lockouts.length
        ? h('div', { class: 'mt' }, secData.lockouts.map((lk) => h('div', { class: 'item row between' },
          h('div', {},
            h('strong', {}, `Tài khoản/SĐT: ${lk.phone || '(trống)'} · IP: ${lk.ip}`),
            h('div', { class: 'small muted' }, `Đã nhập sai ${lk.count}/10 lần`)),
          lk.locked ? h('span', { class: 'badge b-rejected' }, '🔒 Đang bị chặn') : h('span', { class: 'badge b-pending' }, 'Cảnh báo'))))
        : h('div', { class: 'okbox mt', style: 'margin-bottom:0' }, '✓ Không có địa chỉ IP hay số điện thoại nào đang bị khóa đăng nhập.'));

    const sessionsCard = h('div', { class: 'card' },
      h('div', { class: 'row between wrap', style: 'margin-bottom:10px' },
        h('h2', { style: 'margin:0' }, `💻 Thiết bị & Phiên đang đăng nhập (${secData.sessions.length})`),
        secData.sessions.length > 0 ? actionBtn('🚫 Đăng xuất toàn bộ phiên người dùng', 'btn-bad btn-sm', async () => {
          if (!confirmBox('Đăng xuất toàn bộ các thiết bị đang đăng nhập trên ứng dụng chấm công?')) return;
          const r = await api('/admin/sessions/all-others', { method: 'DELETE' });
          toast(`Đã đăng xuất ${r.removed} phiên thiết bị`); reloadSec();
        }) : null),
      secData.sessions.length
        ? secData.sessions.map((s) => {
          const expDate = new Date(s.expires_at);
          return h('div', { class: 'item row between' },
            h('div', { class: 'row', style: 'gap:12px' },
              h('div', { class: 'avatar sm' }, initials(s.user_name)),
              h('div', {},
                h('div', { class: 'row wrap', style: 'gap:6px' },
                  h('strong', {}, s.user_name),
                  h('span', { class: 'badge ' + (s.user_role === 'admin' ? 'b-approved' : 'b-off') }, s.user_role === 'admin' ? '👑 Quản lý' : '👷 Nhân viên')),
                h('div', { class: 'small muted' },
                  `SĐT: ${s.user_phone} · Mã phiên #${s.sid.slice(0, 6)} · Hết hạn: ${pad(expDate.getDate())}/${pad(expDate.getMonth() + 1)}/${expDate.getFullYear()}`))),
            actionBtn('🚪 Thu hồi', 'btn-sm btn-bad', async () => {
              if (!confirmBox(`Thu hồi phiên đăng nhập của ${s.user_name}?`)) return;
              await api('/admin/sessions/' + s.sid, { method: 'DELETE' });
              toast('Đã thu hồi phiên đăng nhập'); reloadSec();
            }));
        })
        : h('div', { class: 'empty' }, 'Không có phiên người dùng nào đang hoạt động'));

    content.append(credsCard, lockoutsCard, sessionsCard);
  } else if (tab === 'comms') {
    const users = await api('/users');
    const targetSel = h('select', {},
      h('option', { value: 'all' }, '📢 Tất cả tài khoản đang hoạt động'),
      h('option', { value: 'not_reported' }, '⏳ Chỉ những nhân viên chưa báo công hôm nay'),
      users.filter((u) => u.active).map((u) => h('option', { value: String(u.id) }, `👤 Cá nhân: ${u.name} (${u.phone})`)));
    const titleIn = h('input', { value: `📢 Thông báo từ ${BRAND.app}`, maxlength: 100 });
    const bodyIn = h('textarea', { placeholder: 'Nhập nội dung thông báo đẩy muốn gửi tới điện thoại nhân viên…', maxlength: 300 });

    const broadcastCard = h('div', { class: 'card' },
      h('h2', {}, '📡 Phát Thông báo Đẩy (Web Push Broadcast)'),
      h('div', { class: 'small muted', style: 'margin-bottom:12px' },
        `Hiện có ${counts.push_users_total} người dùng (${counts.push_subs_total} thiết bị) đã bật nhận thông báo đẩy.`),
      field('Đối tượng nhận', targetSel),
      field('Tiêu đề thông báo', titleIn),
      field('Nội dung thông báo', bodyIn),
      actionBtn('🚀 Phát thông báo ngay', 'btn-primary btn-block', async () => {
        if (!bodyIn.value.trim()) throw new Error('Vui lòng nhập nội dung thông báo');
        const r = await api('/admin/broadcast', {
          method: 'POST',
          body: { target: targetSel.value, title: titleIn.value, body: bodyIn.value },
        });
        toast(`📣 Đã phát thông báo tới ${r.sent}/${r.total_targets} người (có bật thông báo)!`);
        bodyIn.value = '';
      }));

    const reminderBox = h('div', { class: 'card' }, h('div', { class: 'empty' }, 'Đang tải…'));
    renderReminderCard(reminderBox);

    const logsBox = h('div', {});
    renderLogs(logsBox);

    content.append(h('div', { class: 'admin-grid2' }, h('div', {}, broadcastCard, reminderBox), logsBox));
  }
}

// ================= Khởi động =================
boot();
