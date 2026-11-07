// Ứng dụng Báo Công - server chính
process.env.TZ = process.env.TZ || 'Asia/Ho_Chi_Minh';

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const express = require('express');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const { db, tx, DATA_DIR, getSetting, setSetting } = require('./src/db');
const { computePayroll, computeSiteCosts, monthlyStats } = require('./src/payroll');
const { buildWorkbook } = require('./src/export');
const push = require('./src/push');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const SESSION_DAYS = 30;
const BACKDATE_DAYS = Number(process.env.BACKDATE_DAYS || 3); // nhân viên được báo bù tối đa mấy ngày trước
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const app = express();
app.set('trust proxy', process.env.TRUST_PROXY === '0' ? false : 'loopback');
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

// ---------- Tiện ích ----------
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg) => new HttpError(400, msg);
const wrap = (fn) => (req, res, next) => {
  try {
    const r = fn(req, res, next);
    if (r && typeof r.catch === 'function') r.catch(next);
  } catch (e) { next(e); }
};

function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + n);
  return localDate(d);
}
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s));
const isTime = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const normPhone = (s) => String(s || '').replace(/[^\d+]/g, '');
const str = (s, max = 500) => String(s ?? '').trim().slice(0, max);
function money(v, field) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1e10) throw bad(`${field} không hợp lệ`);
  return Math.round(n);
}
function publicUser(u) {
  return {
    id: u.id,
    name: u.name,
    phone: u.phone,
    role: u.role,
    daily_wage: u.daily_wage,
    ot_rate: u.ot_rate,
    active: !!u.active,
    bank_bin: u.bank_bin || '',
    bank_name: u.bank_name || '',
    bank_account: u.bank_account || '',
    bank_holder: u.bank_holder || '',
  };
}

/** Ghi nhật ký thao tác (ai làm gì, lúc nào). Không bao giờ làm hỏng thao tác chính. */
function audit(req, action, targetType, targetId, detail = '') {
  try {
    db.prepare('INSERT INTO audit_logs (user_id, action, target_type, target_id, detail) VALUES (?, ?, ?, ?, ?)')
      .run(req.user?.id ?? null, action, targetType, targetId ?? null, String(detail).slice(0, 1000));
  } catch (e) { console.warn('audit lỗi:', e.message); }
}
const vnd = (n) => Math.round(n).toLocaleString('vi-VN') + 'đ';
const TYPE_VN = { full: 'cả ngày', half: 'nửa ngày', off: 'nghỉ' };
const KIND_VN = { bonus: 'Thưởng', allowance: 'Phụ cấp', penalty: 'Phạt' };
const nameOf = (id) => db.prepare('SELECT name FROM users WHERE id = ?').get(id)?.name || `#${id}`;

/** Chặn thêm/sửa/xóa dữ liệu của tháng đã chốt sổ. */
function assertMonthUnlocked(dateOrMonth) {
  const m = String(dateOrMonth || '').slice(0, 7);
  if (!m) return;
  const lk = db.prepare('SELECT 1 FROM month_locks WHERE month = ?').get(m);
  if (lk) throw bad(`Tháng ${m.slice(5)}/${m.slice(0, 4)} đã chốt sổ, không thể thêm/sửa/xóa. Quản lý có thể mở khóa trong Bảng công.`);
}

/** Tạo bản sao lưu SQLite an toàn (VACUUM INTO) và giữ tối đa 15 bản gần nhất. */
function createBackup(prefix = 'baocong') {
  const now = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  const name = `${prefix}-${stamp}.db`;
  const dest = path.join(BACKUP_DIR, name);
  fs.rmSync(dest, { force: true });
  db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  const files = fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.db')).sort().reverse();
  for (const old of files.slice(15)) fs.rmSync(path.join(BACKUP_DIR, old), { force: true });
  return { name, size: fs.statSync(dest).size, created_at: now.toISOString() };
}

// ---------- Phiên đăng nhập ----------
function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function createSession(res, req, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const exp = Date.now() + SESSION_DAYS * 864e5;
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, exp);
  const secure = req.secure || process.env.COOKIE_SECURE === '1';
  res.setHeader('Set-Cookie',
    `sid=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure ? '; Secure' : ''}`);
}

// ---------- Tài khoản & Phiên riêng cho Quản trị Website (Webmaster) ----------
function getWebAdminUser() {
  return getSetting('webadmin_user', process.env.WEBADMIN_USER || 'admin');
}
function getWebAdminPassHash() {
  let h = getSetting('webadmin_pass_hash', '');
  if (!h) {
    h = bcrypt.hashSync(String(process.env.WEBADMIN_PASS || 'admin123'), 10);
    setSetting('webadmin_pass_hash', h);
  }
  return h;
}
function createWebAdminSession(res, req, username) {
  const token = crypto.randomBytes(32).toString('hex');
  const exp = Date.now() + 7 * 864e5; // phiên Quản trị Web có hiệu lực 7 ngày
  db.prepare('INSERT INTO webadmin_sessions (token, username, expires_at) VALUES (?, ?, ?)').run(token, username, exp);
  const secure = req.secure || process.env.COOKIE_SECURE === '1';
  res.setHeader('Set-Cookie',
    `wa_sid=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${7 * 86400}${secure ? '; Secure' : ''}`);
}
function getWebAdminFromReq(req) {
  const token = parseCookies(req).wa_sid;
  if (!token) return null;
  const row = db.prepare('SELECT * FROM webadmin_sessions WHERE token = ? AND expires_at > ?').get(token, Date.now());
  return row ? { username: row.username, token: row.token } : null;
}
function webAdminOnly(req, res, next) {
  const wa = req.webAdmin || getWebAdminFromReq(req);
  if (!wa) return next(new HttpError(401, 'Vui lòng đăng nhập tài khoản Quản trị Website'));
  req.webAdmin = wa;
  next();
}

function auth(req, res, next) {
  const wa = getWebAdminFromReq(req);
  if (wa) req.webAdmin = wa;
  const token = parseCookies(req).sid;
  if (token) {
    const row = db.prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > ? AND u.active = 1`
    ).get(token, Date.now());
    if (row) { req.user = row; req.token = token; return next(); }
  }
  if (wa) {
    req.user = { id: null, name: `Webmaster (${wa.username})`, phone: 'webadmin', role: 'admin', active: 1 };
    return next();
  }
  next(new HttpError(401, 'Vui lòng đăng nhập'));
}
function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin' && !req.webAdmin) return next(new HttpError(403, 'Chỉ quản lý mới được thực hiện'));
  next();
}

// Chống dò mật khẩu: tối đa 10 lần sai / 15 phút cho mỗi IP + SĐT
const loginFails = new Map();
function checkLoginLimit(key) {
  const now = Date.now();
  const e = loginFails.get(key);
  if (e && e.until > now && e.count >= 10) throw new HttpError(429, 'Sai quá nhiều lần, thử lại sau 15 phút');
}
function recordLoginFail(key) {
  const now = Date.now();
  const e = loginFails.get(key);
  if (!e || e.until < now) loginFails.set(key, { count: 1, until: now + 15 * 60e3 });
  else e.count++;
}

// ---------- Tải ảnh ----------
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.jpg`),
  }),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp|heic|heif)$/.test(file.mimetype)) cb(null, true);
    else cb(bad('File phải là ảnh'));
  },
});
function removePhoto(name) {
  if (name && /^[\w.-]+$/.test(name)) fs.rm(path.join(UPLOAD_DIR, name), { force: true }, () => {});
}

function getSiteConfig() {
  return {
    site_title: getSetting('site_title', 'TBT Báo Công'),
    site_slogan: getSetting('site_slogan', 'Hệ thống Quản lý Chấm công · Duyệt công · Tính lương Chuyên nghiệp'),
    brand_team: getSetting('brand_team', 'TBT'),
    brand_dev: getSetting('brand_dev', 'Tên Dev'),
    brand_dev_link: getSetting('brand_dev_link', ''),
    system_banner: getSetting('system_banner', ''),
    backdate_days: Math.min(30, Math.max(0, Number(getSetting('backdate_days', String(BACKDATE_DAYS))) || 0)),
    default_check_in: getSetting('default_check_in', '07:00'),
    default_check_out: getSetting('default_check_out', '17:00'),
    require_photo: getSetting('require_photo', '1') === '1',
    require_gps: getSetting('require_gps', '1') === '1',
    maintenance_mode: getSetting('maintenance_mode', '0') === '1',
  };
}

// =================== API ===================
const api = express.Router();

// Lần chạy đầu tiên: tạo tài khoản quản lý
api.get('/setup', (req, res) => {
  res.json({ needSetup: db.prepare('SELECT COUNT(*) AS c FROM users').get().c === 0, config: getSiteConfig() });
});
api.post('/setup', wrap((req, res) => {
  const { name, phone, password } = req.body || {};
  const user = tx(() => {
    if (db.prepare('SELECT COUNT(*) AS c FROM users').get().c > 0) throw new HttpError(403, 'Đã có tài khoản quản lý');
    if (!str(name) || normPhone(phone).length < 9) throw bad('Nhập họ tên và số điện thoại hợp lệ');
    if (String(password || '').length < 6) throw bad('Mật khẩu tối thiểu 6 ký tự');
    const r = db.prepare("INSERT INTO users (name, phone, password_hash, role) VALUES (?, ?, ?, 'admin')")
      .run(str(name, 100), normPhone(phone), bcrypt.hashSync(String(password), 10));
    return db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid);
  });
  createSession(res, req, user.id);
  res.json(publicUser(user));
}));

api.post('/login', wrap((req, res) => {
  const phone = normPhone(req.body?.phone);
  const key = `${req.ip}|${phone}`;
  checkLoginLimit(key);
  const u = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
  if (!u || !bcrypt.compareSync(String(req.body?.password || ''), u.password_hash)) {
    recordLoginFail(key);
    throw new HttpError(401, 'Sai số điện thoại hoặc mật khẩu');
  }
  if (!u.active) throw new HttpError(403, 'Tài khoản đã bị khóa');
  loginFails.delete(key);
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  createSession(res, req, u.id);
  res.json(publicUser(u));
}));

// ---------- Đăng nhập riêng cho Quản trị Website (Webmaster) ----------
api.get('/webadmin/me', (req, res) => {
  const wa = getWebAdminFromReq(req);
  if (!wa) return res.status(401).json({ error: 'Chưa đăng nhập Quản trị Website' });
  res.json({ username: wa.username, config: getSiteConfig() });
});

api.post('/webadmin/login', wrap((req, res) => {
  const username = str(req.body?.username, 60);
  const password = String(req.body?.password || '');
  const key = `${req.ip}|wa|${username.toLowerCase()}`;
  checkLoginLimit(key);
  const expectedUser = getWebAdminUser();
  const passHash = getWebAdminPassHash();
  if (!username || username.toLowerCase() !== expectedUser.toLowerCase() || !bcrypt.compareSync(password, passHash)) {
    recordLoginFail(key);
    throw new HttpError(401, 'Sai tên tài khoản hoặc mật khẩu Quản trị Website');
  }
  loginFails.delete(key);
  db.prepare('DELETE FROM webadmin_sessions WHERE expires_at < ?').run(Date.now());
  createWebAdminSession(res, req, expectedUser);
  audit({ user: null }, 'security.wa_login', 'settings', null, `Đăng nhập Cổng Quản trị Website (${expectedUser})`);
  res.json({ username: expectedUser, config: getSiteConfig() });
}));

api.post('/webadmin/logout', (req, res) => {
  const token = parseCookies(req).wa_sid;
  if (token) db.prepare('DELETE FROM webadmin_sessions WHERE token = ?').run(token);
  res.setHeader('Set-Cookie', 'wa_sid=; HttpOnly; Path=/; Max-Age=0');
  res.json({ ok: true });
});

api.use(auth);

api.post('/logout', (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(req.token);
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; Path=/; Max-Age=0');
  res.json({ ok: true });
});
api.get('/me', (req, res) => {
  const cfg = getSiteConfig();
  res.json({
    ...publicUser(req.user),
    is_webadmin: !!req.webAdmin,
    today: localDate(),
    backdate_days: cfg.backdate_days,
    config: cfg,
  });
});
api.put('/me/bank', wrap((req, res) => {
  if (!req.user?.id) throw bad('Không thể cập nhật ngân hàng cho tài khoản này');
  const b = req.body || {};
  const bank_bin = str(b.bank_bin, 20).replace(/\D/g, '');
  const bank_name = str(b.bank_name, 80);
  const bank_account = str(b.bank_account, 40).replace(/\s+/g, '');
  const bank_holder = str(b.bank_holder, 100).toUpperCase();
  db.prepare('UPDATE users SET bank_bin=?, bank_name=?, bank_account=?, bank_holder=? WHERE id=?')
    .run(bank_bin, bank_name, bank_account, bank_holder, req.user.id);
  audit(req, 'user.update', 'user', req.user.id, `${req.user.name} cập nhật TK ngân hàng: ${bank_name} ${bank_account}`);
  res.json(publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)));
}));
api.post('/me/password', wrap((req, res) => {
  const { old_password, new_password } = req.body || {};
  if (!bcrypt.compareSync(String(old_password || ''), req.user.password_hash)) throw bad('Mật khẩu cũ không đúng');
  if (String(new_password || '').length < 6) throw bad('Mật khẩu mới tối thiểu 6 ký tự');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(String(new_password), 10), req.user.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(req.user.id, req.token);
  res.json({ ok: true });
}));

// ---------- Công trình ----------
api.get('/sites', (req, res) => {
  const all = req.user.role === 'admin' && req.query.all === '1';
  res.json(db.prepare(`SELECT * FROM sites ${all ? '' : 'WHERE active = 1'} ORDER BY active DESC, name`).all());
});
api.post('/sites', adminOnly, wrap((req, res) => {
  const name = str(req.body?.name, 120);
  if (!name) throw bad('Nhập tên công trình');
  const r = db.prepare('INSERT INTO sites (name, address) VALUES (?, ?)').run(name, str(req.body?.address, 300));
  audit(req, 'site.create', 'site', Number(r.lastInsertRowid), `Thêm công trình "${name}"`);
  res.json(db.prepare('SELECT * FROM sites WHERE id = ?').get(r.lastInsertRowid));
}));
api.put('/sites/:id', adminOnly, wrap((req, res) => {
  const s = db.prepare('SELECT * FROM sites WHERE id = ?').get(req.params.id);
  if (!s) throw new HttpError(404, 'Không tìm thấy công trình');
  const b = req.body || {};
  const name = b.name !== undefined ? str(b.name, 120) : s.name;
  if (!name) throw bad('Nhập tên công trình');
  db.prepare('UPDATE sites SET name = ?, address = ?, active = ? WHERE id = ?').run(
    name, b.address !== undefined ? str(b.address, 300) : s.address,
    b.active !== undefined ? (b.active ? 1 : 0) : s.active, s.id);
  audit(req, 'site.update', 'site', s.id, `Sửa công trình "${name}"${b.active !== undefined && !!b.active !== !!s.active ? (b.active ? ' (mở lại)' : ' (đánh dấu đã xong)') : ''}`);
  res.json(db.prepare('SELECT * FROM sites WHERE id = ?').get(s.id));
}));

// ---------- Nhân viên ----------
api.get('/users', adminOnly, (req, res) => {
  res.json(db.prepare('SELECT * FROM users ORDER BY role, active DESC, name').all().map(publicUser));
});
api.post('/users', adminOnly, wrap((req, res) => {
  const b = req.body || {};
  const name = str(b.name, 100), phone = normPhone(b.phone);
  if (!name || phone.length < 9) throw bad('Nhập họ tên và số điện thoại hợp lệ');
  if (String(b.password || '').length < 6) throw bad('Mật khẩu tối thiểu 6 ký tự');
  if (db.prepare('SELECT 1 FROM users WHERE phone = ?').get(phone)) throw bad('Số điện thoại đã tồn tại');
  const role = b.role === 'admin' ? 'admin' : 'worker';
  const bank_bin = str(b.bank_bin, 20).replace(/\D/g, '');
  const bank_name = str(b.bank_name, 80);
  const bank_account = str(b.bank_account, 40).replace(/\s+/g, '');
  const bank_holder = str(b.bank_holder, 100).toUpperCase();
  const r = db.prepare(
    'INSERT INTO users (name, phone, password_hash, role, daily_wage, ot_rate, bank_bin, bank_name, bank_account, bank_holder) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    name, phone, bcrypt.hashSync(String(b.password), 10), role,
    money(b.daily_wage || 0, 'Lương ngày'), money(b.ot_rate || 0, 'Tiền tăng ca'),
    bank_bin, bank_name, bank_account, bank_holder
  );
  audit(req, 'user.create', 'user', Number(r.lastInsertRowid), `Tạo tài khoản ${role === 'admin' ? 'quản lý' : 'nhân viên'} "${name}" (${phone})`);
  res.json(publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid)));
}));
api.put('/users/:id', adminOnly, wrap((req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) throw new HttpError(404, 'Không tìm thấy nhân viên');
  const b = req.body || {};
  const name = b.name !== undefined ? str(b.name, 100) : u.name;
  const phone = b.phone !== undefined ? normPhone(b.phone) : u.phone;
  if (!name || phone.length < 9) throw bad('Nhập họ tên và số điện thoại hợp lệ');
  if (phone !== u.phone && db.prepare('SELECT 1 FROM users WHERE phone = ?').get(phone)) throw bad('Số điện thoại đã tồn tại');
  const role = b.role !== undefined ? (b.role === 'admin' ? 'admin' : 'worker') : u.role;
  const active = b.active !== undefined ? (b.active ? 1 : 0) : u.active;
  if (!req.webAdmin && u.id === req.user.id && (role !== 'admin' || !active)) throw bad('Không thể tự hạ quyền hoặc khóa chính mình');
  const bank_bin = b.bank_bin !== undefined ? str(b.bank_bin, 20).replace(/\D/g, '') : (u.bank_bin || '');
  const bank_name = b.bank_name !== undefined ? str(b.bank_name, 80) : (u.bank_name || '');
  const bank_account = b.bank_account !== undefined ? str(b.bank_account, 40).replace(/\s+/g, '') : (u.bank_account || '');
  const bank_holder = b.bank_holder !== undefined ? str(b.bank_holder, 100).toUpperCase() : (u.bank_holder || '');
  tx(() => {
    db.prepare('UPDATE users SET name=?, phone=?, role=?, active=?, daily_wage=?, ot_rate=?, bank_bin=?, bank_name=?, bank_account=?, bank_holder=? WHERE id=?').run(
      name, phone, role, active,
      b.daily_wage !== undefined ? money(b.daily_wage, 'Lương ngày') : u.daily_wage,
      b.ot_rate !== undefined ? money(b.ot_rate, 'Tiền tăng ca') : u.ot_rate,
      bank_bin, bank_name, bank_account, bank_holder,
      u.id);
    if (b.password) {
      if (String(b.password).length < 4) throw bad('Mật khẩu tối thiểu 4 ký tự');
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(String(b.password), 10), u.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
    }
    if (!active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
  });
  const nu = db.prepare('SELECT * FROM users WHERE id = ?').get(u.id);
  const changes = [];
  if (nu.name !== u.name) changes.push(`tên "${u.name}" → "${nu.name}"`);
  if (nu.phone !== u.phone) changes.push(`SĐT ${u.phone} → ${nu.phone}`);
  if (nu.daily_wage !== u.daily_wage) changes.push(`lương ngày ${vnd(u.daily_wage)} → ${vnd(nu.daily_wage)}`);
  if (nu.ot_rate !== u.ot_rate) changes.push(`tiền TC ${vnd(u.ot_rate)} → ${vnd(nu.ot_rate)}`);
  if (nu.role !== u.role) changes.push(nu.role === 'admin' ? 'cấp quyền quản lý' : 'bỏ quyền quản lý');
  if (nu.active !== u.active) changes.push(nu.active ? 'mở khóa tài khoản' : 'khóa tài khoản');
  if (nu.bank_account !== (u.bank_account || '')) changes.push(`cập nhật STK ${nu.bank_name} ${nu.bank_account}`);
  if (b.password) changes.push('đặt lại mật khẩu');
  if (changes.length) audit(req, 'user.update', 'user', u.id, `${nu.name}: ${changes.join(', ')}`);
  res.json(publicUser(nu));
}));

// ---------- Báo công ----------
const REPORT_SELECT = `SELECT r.*, u.name AS user_name, u.phone AS user_phone, s.name AS site_name, rv.name AS reviewer_name
  FROM reports r JOIN users u ON u.id = r.user_id LEFT JOIN sites s ON s.id = r.site_id
  LEFT JOIN users rv ON rv.id = r.reviewed_by`;

function validateReportFields(b, { requireAll }) {
  const day_type = b.day_type;
  if (!['full', 'half', 'off'].includes(day_type)) throw bad('Chọn loại công');
  const working = day_type !== 'off';
  const site_id = b.site_id ? Number(b.site_id) : null;
  if (working && requireAll && !site_id) throw bad('Chọn công trình');
  if (site_id && !db.prepare('SELECT 1 FROM sites WHERE id = ?').get(site_id)) throw bad('Công trình không tồn tại');
  const check_in = b.check_in || null, check_out = b.check_out || null;
  if (working && requireAll && (!check_in || !check_out)) throw bad('Nhập giờ vào và giờ ra');
  if (check_in && !isTime(check_in)) throw bad('Giờ vào không hợp lệ');
  if (check_out && !isTime(check_out)) throw bad('Giờ ra không hợp lệ');
  const ot_hours = Number(b.ot_hours || 0);
  if (!Number.isFinite(ot_hours) || ot_hours < 0 || ot_hours > 16) throw bad('Số giờ tăng ca không hợp lệ (0–16)');
  return {
    day_type, site_id: working ? site_id : null,
    check_in: working ? check_in : null, check_out: working ? check_out : null,
    ot_hours: working ? Math.round(ot_hours * 4) / 4 : 0, note: str(b.note, 1000),
  };
}

// Nhân viên gửi báo công (multipart, kèm ảnh)
api.post('/reports', upload.single('photo'), wrap((req, res) => {
  const b = req.body || {};
  const photo = req.file?.filename || null;
  try {
    const cfg = getSiteConfig();
    if (cfg.maintenance_mode && req.user.role !== 'admin') {
      throw bad('Hệ thống đang tạm bảo trì theo cấu hình của Quản trị viên. Vui lòng thử lại sau.');
    }
    const f = validateReportFields(b, { requireAll: true });
    const today = localDate();
    const work_date = b.work_date || today;
    if (!isDate(work_date)) throw bad('Ngày không hợp lệ');
    const working = f.day_type !== 'off';
    if (working && work_date > today) throw bad('Không được báo công đi làm cho ngày tương lai (chỉ được xin nghỉ phép trước)');
    if (!working && work_date > addDays(today, 30)) throw bad('Chỉ được xin nghỉ phép trước tối đa 30 ngày');
    if (work_date < addDays(today, -cfg.backdate_days)) throw bad(`Chỉ được báo bù tối đa ${cfg.backdate_days} ngày trước. Liên hệ quản lý.`);
    if (!working && work_date > today && !f.note) throw bad('Vui lòng ghi lý do xin nghỉ phép');
    assertMonthUnlocked(work_date);
    const lat = b.lat !== undefined && b.lat !== '' ? Number(b.lat) : null;
    const lng = b.lng !== undefined && b.lng !== '' ? Number(b.lng) : null;
    const accuracy = b.accuracy ? Number(b.accuracy) : null;
    if (working) {
      if (cfg.require_photo && !photo) throw bad('Bắt buộc chụp ảnh khi báo công');
      if (cfg.require_gps && (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180))
        throw bad('Bắt buộc lấy vị trí GPS khi báo công');
    }

    const existing = db.prepare('SELECT * FROM reports WHERE user_id = ? AND work_date = ?').get(req.user.id, work_date);
    if (existing && existing.status === 'approved') throw bad('Ngày này đã được duyệt, không sửa được. Liên hệ quản lý.');
    let id;
    if (existing) {
      db.prepare(`UPDATE reports SET site_id=?, day_type=?, check_in=?, check_out=?, ot_hours=?, note=?, photo=?,
        lat=?, lng=?, accuracy=?, status='pending', review_note='', reviewed_by=NULL, reviewed_at=NULL,
        updated_at=datetime('now') WHERE id=?`).run(
        f.site_id, f.day_type, f.check_in, f.check_out, f.ot_hours, f.note, photo, lat, lng, accuracy, existing.id);
      removePhoto(existing.photo);
      id = existing.id;
    } else {
      id = db.prepare(`INSERT INTO reports (user_id, site_id, work_date, day_type, check_in, check_out, ot_hours, note,
        photo, lat, lng, accuracy) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        req.user.id, f.site_id, work_date, f.day_type, f.check_in, f.check_out, f.ot_hours, f.note,
        photo, lat, lng, accuracy).lastInsertRowid;
    }
    res.json(db.prepare(`${REPORT_SELECT} WHERE r.id = ?`).get(id));
  } catch (e) {
    removePhoto(photo);
    throw e;
  }
}));

api.get('/reports', wrap((req, res) => {
  const where = [], args = [];
  if (req.user.role !== 'admin') { where.push('r.user_id = ?'); args.push(req.user.id); }
  else if (req.query.user_id) { where.push('r.user_id = ?'); args.push(Number(req.query.user_id)); }
  if (req.query.month) {
    if (!/^\d{4}-\d{2}$/.test(req.query.month)) throw bad('Tháng không hợp lệ');
    where.push("substr(r.work_date, 1, 7) = ?"); args.push(req.query.month);
  }
  if (req.query.date) { where.push('r.work_date = ?'); args.push(String(req.query.date)); }
  if (req.query.status) { where.push('r.status = ?'); args.push(String(req.query.status)); }
  const sql = `${REPORT_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY r.work_date DESC, r.created_at DESC LIMIT 1000`;
  res.json(db.prepare(sql).all(...args));
}));

// Nhân viên xóa báo công chưa duyệt của mình
api.delete('/reports/:id', wrap((req, res) => {
  const r = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
  if (!r) throw new HttpError(404, 'Không tìm thấy');
  assertMonthUnlocked(r.work_date);
  const isAdmin = req.user.role === 'admin';
  if (!isAdmin && (r.user_id !== req.user.id || r.status === 'approved')) throw new HttpError(403, 'Không thể xóa');
  db.prepare('DELETE FROM reports WHERE id = ?').run(r.id);
  removePhoto(r.photo);
  audit(req, 'report.delete', 'report', r.id, `Xóa báo công ${r.work_date} của ${nameOf(r.user_id)} (${TYPE_VN[r.day_type]})`);
  res.json({ ok: true });
}));

// Quản lý sửa nội dung báo công (vd: chỉnh giờ tăng ca trước khi duyệt)
api.put('/reports/:id', adminOnly, wrap((req, res) => {
  const r = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
  if (!r) throw new HttpError(404, 'Không tìm thấy');
  assertMonthUnlocked(r.work_date);
  const f = validateReportFields({ ...r, ...req.body }, { requireAll: false });
  db.prepare(`UPDATE reports SET site_id=?, day_type=?, check_in=?, check_out=?, ot_hours=?, note=?, updated_at=datetime('now')
    WHERE id=?`).run(f.site_id, f.day_type, f.check_in, f.check_out, f.ot_hours, f.note, r.id);
  const ch = [];
  if (f.day_type !== r.day_type) ch.push(`loại công ${TYPE_VN[r.day_type]} → ${TYPE_VN[f.day_type]}`);
  if (f.ot_hours !== r.ot_hours) ch.push(`tăng ca ${r.ot_hours}h → ${f.ot_hours}h`);
  if (f.check_in !== r.check_in || f.check_out !== r.check_out) ch.push(`giờ ${r.check_in || '?'}–${r.check_out || '?'} → ${f.check_in || '?'}–${f.check_out || '?'}`);
  if (f.site_id !== r.site_id) ch.push('đổi công trình');
  if (f.note !== r.note) ch.push('sửa ghi chú');
  if (ch.length) audit(req, 'report.update', 'report', r.id, `Báo công ${r.work_date} của ${nameOf(r.user_id)}: ${ch.join(', ')}`);
  res.json(db.prepare(`${REPORT_SELECT} WHERE r.id = ?`).get(r.id));
}));

// Quản lý duyệt / từ chối (một hoặc nhiều báo công)
api.post('/reports/review', adminOnly, wrap((req, res) => {
  const { ids, status, note } = req.body || {};
  if (!Array.isArray(ids) || !ids.length) throw bad('Chưa chọn báo công');
  if (!['approved', 'rejected', 'pending'].includes(status)) throw bad('Trạng thái không hợp lệ');
  if (status === 'rejected' && !str(note)) throw bad('Nhập lý do từ chối');
  const done = tx(() => {
    const list = [];
    for (const id of ids) {
      const r = db.prepare('SELECT r.id, r.user_id, r.work_date, r.day_type, u.name, u.daily_wage, u.ot_rate FROM reports r JOIN users u ON u.id = r.user_id WHERE r.id = ?').get(Number(id));
      if (!r) continue;
      assertMonthUnlocked(r.work_date);
      const approved = status === 'approved';
      db.prepare(`UPDATE reports SET status=?, review_note=?, reviewed_by=?, reviewed_at=datetime('now'),
        wage_snapshot=?, ot_rate_snapshot=? WHERE id=?`).run(
        status, str(note, 500), status === 'pending' ? null : req.user.id,
        approved ? r.daily_wage : null, approved ? r.ot_rate : null, r.id);
      list.push(r);
    }
    return list;
  });
  const verb = { approved: 'Duyệt', rejected: 'Từ chối', pending: 'Bỏ duyệt' }[status];
  for (const r of done) {
    const label = r.day_type === 'off' ? 'đơn xin nghỉ' : 'báo công';
    audit(req, 'report.' + status, 'report', r.id, `${verb} ${label} ${r.work_date} của ${r.name}${note ? ` – lý do: ${str(note, 200)}` : ''}`);
    if (status !== 'pending') {
      const d = r.work_date.split('-').reverse().join('/');
      push.sendToUser(r.user_id, status === 'approved'
        ? { title: `✅ Đã duyệt ${label}`, body: `Ngày ${d} đã được duyệt.`, url: '/#/history', tag: 'rep-' + r.id }
        : { title: `❌ ${label === 'đơn xin nghỉ' ? 'Đơn xin nghỉ' : 'Báo công'} bị từ chối`, body: `Ngày ${d}: ${str(note, 120)}.`, url: '/#/report', tag: 'rep-' + r.id })
        .catch(() => {});
    }
  }
  res.json({ ok: true, count: done.length });
}));

// Xem ảnh báo công (chỉ quản lý hoặc chính người gửi)
api.get('/photos/:name', wrap((req, res) => {
  const name = req.params.name;
  if (!/^[\w.-]+$/.test(name)) throw new HttpError(404, 'Không tìm thấy');
  const r = db.prepare('SELECT user_id FROM reports WHERE photo = ?').get(name);
  if (!r || (req.user.role !== 'admin' && r.user_id !== req.user.id)) throw new HttpError(404, 'Không tìm thấy');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.sendFile(path.join(UPLOAD_DIR, name));
}));

// ---------- Ứng tiền ----------
const ADV_SELECT = `SELECT a.*, u.name AS user_name, rv.name AS reviewer_name FROM advances a
  JOIN users u ON u.id = a.user_id LEFT JOIN users rv ON rv.id = a.reviewed_by`;

api.get('/advances', wrap((req, res) => {
  const where = [], args = [];
  if (req.user.role !== 'admin') { where.push('a.user_id = ?'); args.push(req.user.id); }
  else if (req.query.user_id) { where.push('a.user_id = ?'); args.push(Number(req.query.user_id)); }
  if (req.query.month) { where.push('substr(a.adv_date, 1, 7) = ?'); args.push(String(req.query.month)); }
  if (req.query.status) { where.push('a.status = ?'); args.push(String(req.query.status)); }
  res.json(db.prepare(`${ADV_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY a.adv_date DESC, a.id DESC LIMIT 500`).all(...args));
}));

api.post('/advances', wrap((req, res) => {
  const b = req.body || {};
  const amount = money(b.amount, 'Số tiền');
  if (amount < 1000) throw bad('Số tiền tối thiểu 1.000đ');
  const isAdmin = req.user.role === 'admin';
  // Quản lý có thể ghi khoản ứng trực tiếp cho nhân viên (tự động duyệt)
  const userId = isAdmin && b.user_id ? Number(b.user_id) : req.user.id;
  if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(userId)) throw bad('Nhân viên không tồn tại');
  const adv_date = isAdmin && isDate(b.adv_date) ? b.adv_date : localDate();
  assertMonthUnlocked(adv_date);
  const direct = isAdmin && userId !== req.user.id;
  const r = db.prepare(`INSERT INTO advances (user_id, amount, reason, adv_date, status, reviewed_by, reviewed_at)
    VALUES (?, ?, ?, ?, ?, ?, ${direct ? "datetime('now')" : 'NULL'})`).run(
    userId, amount, str(b.reason, 500), adv_date, direct ? 'approved' : 'pending', direct ? req.user.id : null);
  if (direct) audit(req, 'advance.create', 'advance', Number(r.lastInsertRowid), `Ghi khoản ứng ${vnd(amount)} cho ${nameOf(userId)} (ngày ${adv_date})`);
  res.json(db.prepare(`${ADV_SELECT} WHERE a.id = ?`).get(r.lastInsertRowid));
}));

api.post('/advances/:id/review', adminOnly, wrap((req, res) => {
  const { status, note } = req.body || {};
  if (!['approved', 'rejected'].includes(status)) throw bad('Trạng thái không hợp lệ');
  const a = db.prepare('SELECT * FROM advances WHERE id = ?').get(req.params.id);
  if (!a) throw new HttpError(404, 'Không tìm thấy');
  assertMonthUnlocked(a.adv_date);
  db.prepare(`UPDATE advances SET status=?, review_note=?, reviewed_by=?, reviewed_at=datetime('now') WHERE id=?`)
    .run(status, str(note, 500), req.user.id, a.id);
  audit(req, 'advance.' + status, 'advance', a.id,
    `${status === 'approved' ? 'Duyệt' : 'Từ chối'} ứng ${vnd(a.amount)} của ${nameOf(a.user_id)}${note ? ` – ${str(note, 200)}` : ''}`);
  push.sendToUser(a.user_id, status === 'approved'
    ? { title: '💵 Đã duyệt ứng tiền', body: `Khoản ứng ${vnd(a.amount)} đã được duyệt.`, url: '/#/advance', tag: 'adv-' + a.id }
    : { title: '❌ Yêu cầu ứng tiền bị từ chối', body: `${vnd(a.amount)}${note ? ': ' + str(note, 100) : ''}`, url: '/#/advance', tag: 'adv-' + a.id })
    .catch(() => {});
  res.json(db.prepare(`${ADV_SELECT} WHERE a.id = ?`).get(a.id));
}));

api.delete('/advances/:id', wrap((req, res) => {
  const a = db.prepare('SELECT * FROM advances WHERE id = ?').get(req.params.id);
  if (!a) throw new HttpError(404, 'Không tìm thấy');
  assertMonthUnlocked(a.adv_date);
  if (req.user.role !== 'admin' && (a.user_id !== req.user.id || a.status !== 'pending')) throw new HttpError(403, 'Không thể xóa');
  db.prepare('DELETE FROM advances WHERE id = ?').run(a.id);
  if (req.user.role === 'admin') audit(req, 'advance.delete', 'advance', a.id, `Xóa khoản ứng ${vnd(a.amount)} của ${nameOf(a.user_id)} (ngày ${a.adv_date})`);
  res.json({ ok: true });
}));

// ---------- Thưởng / phụ cấp / phạt ----------
const ADJ_SELECT = `SELECT j.*, u.name AS user_name, c.name AS creator_name FROM adjustments j
  JOIN users u ON u.id = j.user_id LEFT JOIN users c ON c.id = j.created_by`;

api.get('/adjustments', wrap((req, res) => {
  const where = [], args = [];
  if (req.user.role !== 'admin') { where.push('j.user_id = ?'); args.push(req.user.id); }
  else if (req.query.user_id) { where.push('j.user_id = ?'); args.push(Number(req.query.user_id)); }
  if (req.query.month) { where.push('substr(j.adj_date, 1, 7) = ?'); args.push(String(req.query.month)); }
  res.json(db.prepare(`${ADJ_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY j.adj_date DESC, j.id DESC LIMIT 500`).all(...args));
}));

api.post('/adjustments', adminOnly, wrap((req, res) => {
  const b = req.body || {};
  if (!KIND_VN[b.kind]) throw bad('Chọn loại: thưởng / phụ cấp / phạt');
  const amount = money(b.amount, 'Số tiền');
  if (amount < 1000) throw bad('Số tiền tối thiểu 1.000đ');
  const userId = Number(b.user_id);
  if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(userId)) throw bad('Chọn nhân viên');
  const adj_date = isDate(b.adj_date) ? b.adj_date : localDate();
  assertMonthUnlocked(adj_date);
  const reason = str(b.reason, 500);
  if (b.kind === 'penalty' && !reason) throw bad('Nhập lý do phạt');
  const r = db.prepare('INSERT INTO adjustments (user_id, kind, amount, reason, adj_date, created_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run(userId, b.kind, amount, reason, adj_date, req.user.id);
  const name = nameOf(userId);
  audit(req, 'adjustment.create', 'adjustment', Number(r.lastInsertRowid),
    `${KIND_VN[b.kind]} ${vnd(amount)} cho ${name} (ngày ${adj_date})${reason ? ` – ${reason}` : ''}`);
  const sign = b.kind === 'penalty' ? '−' : '+';
  push.sendToUser(userId, {
    title: b.kind === 'penalty' ? '⚠️ Bạn bị trừ tiền' : b.kind === 'bonus' ? '🎉 Bạn được thưởng' : '💰 Bạn được phụ cấp',
    body: `${sign}${vnd(amount)}${reason ? ' · ' + reason : ''}`, url: '/#/salary', tag: 'adj-' + r.lastInsertRowid,
  }).catch(() => {});
  res.json(db.prepare(`${ADJ_SELECT} WHERE j.id = ?`).get(r.lastInsertRowid));
}));

api.delete('/adjustments/:id', adminOnly, wrap((req, res) => {
  const j = db.prepare('SELECT * FROM adjustments WHERE id = ?').get(req.params.id);
  if (!j) throw new HttpError(404, 'Không tìm thấy');
  assertMonthUnlocked(j.adj_date);
  db.prepare('DELETE FROM adjustments WHERE id = ?').run(j.id);
  audit(req, 'adjustment.delete', 'adjustment', j.id, `Xóa ${KIND_VN[j.kind].toLowerCase()} ${vnd(j.amount)} của ${nameOf(j.user_id)} (ngày ${j.adj_date})`);
  res.json({ ok: true });
}));

// ---------- Nhật ký thao tác ----------
api.get('/logs', adminOnly, wrap((req, res) => {
  const where = [], args = [];
  if (req.query.user_id) { where.push('l.user_id = ?'); args.push(Number(req.query.user_id)); }
  if (req.query.type) { where.push('l.target_type = ?'); args.push(String(req.query.type)); }
  if (req.query.before) { where.push('l.id < ?'); args.push(Number(req.query.before)); }
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  res.json(db.prepare(`SELECT l.*, u.name AS user_name FROM audit_logs l LEFT JOIN users u ON u.id = l.user_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY l.id DESC LIMIT ?`).all(...args, limit));
}));

// ---------- Lương & thống kê ----------
api.get('/payroll', wrap((req, res) => {
  const month = String(req.query.month || localDate().slice(0, 7));
  const userId = req.user.role === 'admin' ? (req.query.user_id ? Number(req.query.user_id) : undefined) : req.user.id;
  try { res.json(computePayroll(month, userId)); } catch (e) { throw bad(e.message); }
}));

// Chốt sổ / mở khóa tháng
api.post('/payroll/lock', adminOnly, wrap((req, res) => {
  const { month, locked, note } = req.body || {};
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month || ''))) throw bad('Tháng không hợp lệ');
  if (locked) {
    db.prepare(`INSERT INTO month_locks (month, locked_by, note) VALUES (?, ?, ?)
      ON CONFLICT(month) DO UPDATE SET locked_by=excluded.locked_by, locked_at=datetime('now'), note=excluded.note`)
      .run(month, req.user.id, str(note, 300));
    audit(req, 'payroll.lock', 'payroll', null, `Chốt sổ tháng ${month.slice(5)}/${month.slice(0, 4)}${note ? ' – ' + str(note, 200) : ''}`);
  } else {
    db.prepare('DELETE FROM month_locks WHERE month = ?').run(month);
    audit(req, 'payroll.unlock', 'payroll', null, `Mở khóa sổ tháng ${month.slice(5)}/${month.slice(0, 4)}`);
  }
  res.json({ ok: true, locked: !!locked });
}));

// Đánh dấu đã trả lương / bỏ đánh dấu cho một nhân viên
api.post('/payroll/paid', adminOnly, wrap((req, res) => {
  const { month, user_id, paid, note, method, amount } = req.body || {};
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month || ''))) throw bad('Tháng không hợp lệ');
  const uid = Number(user_id);
  if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(uid)) throw bad('Nhân viên không tồn tại');
  const uname = nameOf(uid);
  if (paid) {
    const payMethod = method === 'cash' ? 'cash' : 'transfer';
    const payAmount = amount !== undefined ? money(Math.max(0, Number(amount) || 0), 'Số tiền thanh toán') : 0;
    const methodLabel = payMethod === 'cash' ? 'Tiền mặt' : 'Chuyển khoản';
    db.prepare(`INSERT INTO payroll_paid (month, user_id, method, amount, paid_by, note) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(month, user_id) DO UPDATE SET method=excluded.method, amount=excluded.amount, paid_by=excluded.paid_by, paid_at=datetime('now'), note=excluded.note`)
      .run(month, uid, payMethod, payAmount, req.user.id, str(note, 300));
    audit(req, 'payroll.paid', 'payroll', uid,
      `Xác nhận ĐÃ TRẢ LƯƠNG tháng ${month.slice(5)}/${month.slice(0, 4)} cho ${uname} (${methodLabel}${payAmount ? ' · ' + vnd(payAmount) : ''}${note ? ' · ' + str(note, 200) : ''})`);
    push.sendToUser(uid, {
      title: '💸 Đã thanh toán lương',
      body: `Lương tháng ${month.slice(5)}/${month.slice(0, 4)} của bạn đã được quyết toán (${methodLabel}${payAmount ? ': ' + vnd(payAmount) : ''}).`,
      url: '/#/salary', tag: 'paid-' + month,
    }).catch(() => {});
  } else {
    db.prepare('DELETE FROM payroll_paid WHERE month = ? AND user_id = ?').run(month, uid);
    audit(req, 'payroll.unpaid', 'payroll', uid, `Bỏ đánh dấu đã trả lương tháng ${month.slice(5)}/${month.slice(0, 4)} của ${uname}`);
  }
  res.json({ ok: true, paid: !!paid });
}));

// Đánh dấu ĐÃ TRẢ LƯƠNG hàng loạt cho danh sách nhân viên
api.post('/payroll/paid-bulk', adminOnly, wrap((req, res) => {
  const { month, items, method, note } = req.body || {};
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month || ''))) throw bad('Tháng không hợp lệ');
  if (!Array.isArray(items) || !items.length) throw bad('Danh sách nhân viên trống');
  const payMethod = method === 'cash' ? 'cash' : 'transfer';
  const methodLabel = payMethod === 'cash' ? 'Tiền mặt' : 'Chuyển khoản';
  const cleanNote = str(note, 300);

  const stmt = db.prepare(`INSERT INTO payroll_paid (month, user_id, method, amount, paid_by, note) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(month, user_id) DO UPDATE SET method=excluded.method, amount=excluded.amount, paid_by=excluded.paid_by, paid_at=datetime('now'), note=excluded.note`);

  let count = 0;
  let totalPaid = 0;
  db.exec('BEGIN');
  try {
    for (const it of items) {
      const uid = Number(it.user_id);
      if (!uid) continue;
      const amt = Math.max(0, Math.round(Number(it.amount) || 0));
      stmt.run(month, uid, payMethod, amt, req.user.id, cleanNote);
      count++;
      totalPaid += amt;
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  audit(req, 'payroll.paid', 'payroll', null,
    `Thanh toán lương hàng loạt tháng ${month.slice(5)}/${month.slice(0, 4)} cho ${count} nhân viên (${methodLabel} · Tổng ${vnd(totalPaid)})`);

  for (const it of items) {
    const uid = Number(it.user_id);
    const amt = Math.max(0, Math.round(Number(it.amount) || 0));
    if (!uid) continue;
    push.sendToUser(uid, {
      title: '💸 Đã thanh toán lương',
      body: `Lương tháng ${month.slice(5)}/${month.slice(0, 4)} của bạn đã được quyết toán (${methodLabel}${amt ? ': ' + vnd(amt) : ''}).`,
      url: '/#/salary', tag: 'paid-' + month,
    }).catch(() => {});
  }

  res.json({ ok: true, count, total_amount: totalPaid });
}));

// ---------- Chi phí theo công trình ----------
api.get('/sites/costs', adminOnly, wrap((req, res) => {
  const month = req.query.month ? String(req.query.month) : null;
  try { res.json(computeSiteCosts(month)); } catch (e) { throw bad(e.message); }
}));

api.post('/site-expenses', adminOnly, wrap((req, res) => {
  const b = req.body || {};
  const siteId = Number(b.site_id);
  const site = db.prepare('SELECT * FROM sites WHERE id = ?').get(siteId);
  if (!site) throw bad('Chọn công trình');
  const title = str(b.title, 300);
  if (!title) throw bad('Nhập nội dung chi phí (vd: Mua xi măng, Ăn trưa...)');
  const amount = money(b.amount, 'Số tiền');
  if (amount < 1000) throw bad('Số tiền tối thiểu 1.000đ');
  const exp_date = isDate(b.exp_date) ? b.exp_date : localDate();
  assertMonthUnlocked(exp_date);
  const r = db.prepare('INSERT INTO site_expenses (site_id, amount, title, exp_date, created_by) VALUES (?, ?, ?, ?, ?)')
    .run(siteId, amount, title, exp_date, req.user.id);
  audit(req, 'expense.create', 'site', siteId, `Chi phí công trình "${site.name}": ${vnd(amount)} – ${title} (${exp_date})`);
  res.json(db.prepare('SELECT * FROM site_expenses WHERE id = ?').get(r.lastInsertRowid));
}));

api.delete('/site-expenses/:id', adminOnly, wrap((req, res) => {
  const e = db.prepare('SELECT * FROM site_expenses WHERE id = ?').get(req.params.id);
  if (!e) throw new HttpError(404, 'Không tìm thấy');
  assertMonthUnlocked(e.exp_date);
  const site = db.prepare('SELECT name FROM sites WHERE id = ?').get(e.site_id);
  db.prepare('DELETE FROM site_expenses WHERE id = ?').run(e.id);
  audit(req, 'expense.delete', 'site', e.site_id, `Xóa chi phí ${vnd(e.amount)} (${e.title}) khỏi "${site?.name || '#'}"`);
  res.json({ ok: true });
}));

// ---------- Sao lưu dữ liệu ----------
api.get('/backups', adminOnly, (req, res) => {
  const files = fs.readdirSync(BACKUP_DIR).filter((f) => /^[\w.-]+\.db$/.test(f)).sort().reverse();
  const list = files.map((name) => {
    const st = fs.statSync(path.join(BACKUP_DIR, name));
    return { name, size: st.size, created_at: st.mtime.toISOString() };
  });
  const dbPath = path.join(DATA_DIR, 'baocong.db');
  const dbSize = fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0;
  const photos = fs.readdirSync(UPLOAD_DIR).filter((f) => !f.startsWith('.')).length;
  res.json({ db_size: dbSize, photo_count: photos, backups: list });
});

api.post('/backups', adminOnly, wrap((req, res) => {
  const b = createBackup('manual');
  audit(req, 'backup.create', 'settings', null, `Tạo bản sao lưu dữ liệu (${b.name})`);
  res.json(b);
}));

api.get('/backups/:name', adminOnly, wrap((req, res) => {
  const name = req.params.name;
  if (!/^[\w.-]+\.db$/.test(name)) throw new HttpError(404, 'Không tìm thấy');
  const file = path.join(BACKUP_DIR, name);
  if (!fs.existsSync(file)) throw new HttpError(404, 'Không tìm thấy');
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.sendFile(file);
}));

api.delete('/backups/:name', adminOnly, wrap((req, res) => {
  const name = req.params.name;
  if (!/^[\w.-]+\.db$/.test(name)) throw new HttpError(404, 'Không tìm thấy');
  fs.rmSync(path.join(BACKUP_DIR, name), { force: true });
  audit(req, 'backup.delete', 'settings', null, `Xóa bản sao lưu ${name}`);
  res.json({ ok: true });
}));

api.get('/stats', adminOnly, (req, res) => {
  const today = localDate();
  res.json({
    today,
    pending_reports: db.prepare("SELECT COUNT(*) c FROM reports WHERE status='pending'").get().c,
    pending_advances: db.prepare("SELECT COUNT(*) c FROM advances WHERE status='pending'").get().c,
    workers: db.prepare("SELECT COUNT(*) c FROM users WHERE role='worker' AND active=1").get().c,
    reported_today: db.prepare('SELECT COUNT(*) c FROM reports WHERE work_date = ?').get(today).c,
    not_reported_today: db.prepare(`SELECT id, name, phone FROM users WHERE role='worker' AND active=1
      AND id NOT IN (SELECT user_id FROM reports WHERE work_date = ?) ORDER BY name`).all(today),
  });
});

api.get('/stats/monthly', adminOnly, wrap((req, res) => {
  const month = String(req.query.month || localDate().slice(0, 7));
  const months = Math.min(Math.max(Number(req.query.months) || 6, 1), 12);
  try { res.json(monthlyStats(month, months)); } catch (e) { throw bad(e.message); }
}));

api.get('/export', adminOnly, wrap(async (req, res) => {
  const month = String(req.query.month || '');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw bad('Tháng không hợp lệ');
  const wb = await buildWorkbook(month);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="bang-cong-${month}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}));

// ---------- Thông báo đẩy ----------
api.get('/push/key', (req, res) => res.json({ publicKey: push.publicKey, subscribed: push.isSubscribed(req.user.id) }));
api.post('/push/subscribe', wrap((req, res) => {
  try { push.subscribe(req.user.id, req.body); } catch (e) { throw bad(e.message); }
  res.json({ ok: true });
}));
api.post('/push/unsubscribe', wrap((req, res) => { push.unsubscribe(req.body?.endpoint); res.json({ ok: true }); }));
api.post('/push/test', wrap(async (req, res) => {
  await push.sendToUser(req.user.id, { title: 'TBT Báo Công 🔔', body: 'Thông báo đã hoạt động!', url: '/' });
  res.json({ ok: true });
}));
api.get('/settings/reminder', adminOnly, (req, res) => res.json({ enabled: push.getRemindEnabled(), time: push.getRemindTime() }));
api.put('/settings/reminder', adminOnly, wrap((req, res) => {
  const { enabled, time } = req.body || {};
  if (time !== undefined && !isTime(time)) throw bad('Giờ nhắc không hợp lệ');
  if (enabled !== undefined) setSetting('remind_enabled', enabled ? '1' : '0');
  if (time !== undefined) {
    setSetting('remind_time', time);
    // Đổi sang giờ muộn hơn hiện tại → cho phép nhắc lại trong hôm nay
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    if (time > hhmm) setSetting('remind_last', '');
  }
  audit(req, 'settings.reminder', 'settings', null, `Nhắc báo công: ${push.getRemindEnabled() ? 'bật lúc ' + push.getRemindTime() : 'tắt'}`);
  res.json({ enabled: push.getRemindEnabled(), time: push.getRemindTime() });
}));
api.post('/push/remind-now', adminOnly, wrap(async (req, res) => {
  const n = await push.runReminder();
  audit(req, 'push.remind', 'settings', null, `Gửi nhắc báo công thủ công tới ${n} người`);
  res.json({ ok: true, count: n });
}));

// ---------- Quản trị Website (Admin Control Center – yêu cầu đăng nhập tài khoản Webmaster riêng) ----------
api.get('/admin/overview', webAdminOnly, wrap((req, res) => {
  const dbPath = path.join(DATA_DIR, 'baocong.db');
  const walPath = path.join(DATA_DIR, 'baocong.db-wal');
  const dbBytes = fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0;
  const walBytes = fs.existsSync(walPath) ? fs.statSync(walPath).size : 0;

  const uploadList = fs.existsSync(UPLOAD_DIR) ? fs.readdirSync(UPLOAD_DIR).filter((f) => !f.startsWith('.')) : [];
  let uploadBytes = 0;
  for (const f of uploadList) {
    try { uploadBytes += fs.statSync(path.join(UPLOAD_DIR, f)).size; } catch { /* ignore */ }
  }
  const usedPhotos = new Set(db.prepare('SELECT photo FROM reports WHERE photo IS NOT NULL').all().map((r) => r.photo));
  const orphanPhotos = uploadList.filter((f) => !usedPhotos.has(f)).length;

  const backupList = fs.existsSync(BACKUP_DIR) ? fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.db')) : [];
  let backupBytes = 0;
  for (const f of backupList) {
    try { backupBytes += fs.statSync(path.join(BACKUP_DIR, f)).size; } catch { /* ignore */ }
  }

  const now = Date.now();
  let activeLockouts = 0;
  for (const [k, v] of loginFails.entries()) {
    if (v.until <= now) loginFails.delete(k);
    else if (v.count >= 10) activeLockouts++;
  }

  const mem = process.memoryUsage();
  const c = (sql, ...args) => db.prepare(sql).get(...args).c;

  // Thống kê biểu đồ 14 ngày gần nhất + Top nhân viên tháng này + Tỷ trọng công trình
  const today = localDate();
  const from14 = addDays(today, -13);
  const rep14 = db.prepare(`
    SELECT work_date,
           SUM(CASE day_type WHEN 'full' THEN 1 WHEN 'half' THEN 0.5 ELSE 0 END) AS days,
           SUM(ot_hours) AS ot,
           COUNT(DISTINCT user_id) AS workers
    FROM reports
    WHERE status = 'approved' AND work_date BETWEEN ? AND ?
    GROUP BY work_date
  `).all(from14, today);
  const rep14Map = Object.fromEntries(rep14.map((r) => [r.work_date, r]));
  const daily14d = [];
  for (let i = 13; i >= 0; i--) {
    const dStr = addDays(today, -i);
    const row = rep14Map[dStr];
    daily14d.push({
      date: dStr,
      label: `${dStr.slice(8, 10)}/${dStr.slice(5, 7)}`,
      work_days: row ? Number(row.days || 0) : 0,
      ot_hours: row ? Number(row.ot || 0) : 0,
      workers: row ? Number(row.workers || 0) : 0,
    });
  }

  const curMonth = today.slice(0, 7);
  const curPayroll = computePayroll(curMonth);
  const topWorkers = [...curPayroll.rows]
    .sort((a, b) => (b.work_days - a.work_days) || (b.ot_hours - a.ot_hours))
    .slice(0, 6)
    .map((r) => ({
      id: r.user.id,
      name: r.user.name,
      work_days: r.work_days,
      ot_hours: r.ot_hours,
      net: r.net,
      paid: !!r.paid,
    }));
  const siteCosts = computeSiteCosts(curMonth).rows
    .filter((s) => s.total_cost > 0 || s.work_days > 0)
    .sort((a, b) => b.total_cost - a.total_cost)
    .slice(0, 6)
    .map((s) => ({
      name: s.site.name,
      work_days: s.work_days,
      total_cost: s.total_cost,
    }));

  res.json({
    webadmin: { username: req.webAdmin.username },
    server: {
      node: process.version,
      platform: `${process.platform} (${process.arch})`,
      uptime_sec: Math.round(process.uptime()),
      rss_bytes: mem.rss,
      heap_bytes: mem.heapUsed,
      server_time: new Date().toISOString(),
      tz: process.env.TZ || 'Asia/Ho_Chi_Minh',
    },
    storage: {
      db_bytes: dbBytes,
      wal_bytes: walBytes,
      upload_files: uploadList.length,
      upload_bytes: uploadBytes,
      orphan_photos: orphanPhotos,
      backup_files: backupList.length,
      backup_bytes: backupBytes,
    },
    counts: {
      users_total: c('SELECT COUNT(*) c FROM users'),
      workers_active: c("SELECT COUNT(*) c FROM users WHERE role='worker' AND active=1"),
      admins_active: c("SELECT COUNT(*) c FROM users WHERE role='admin' AND active=1"),
      users_locked: c('SELECT COUNT(*) c FROM users WHERE active=0'),
      sites_total: c('SELECT COUNT(*) c FROM sites'),
      sites_active: c('SELECT COUNT(*) c FROM sites WHERE active=1'),
      reports_total: c('SELECT COUNT(*) c FROM reports'),
      reports_pending: c("SELECT COUNT(*) c FROM reports WHERE status='pending'"),
      reports_approved: c("SELECT COUNT(*) c FROM reports WHERE status='approved'"),
      reports_rejected: c("SELECT COUNT(*) c FROM reports WHERE status='rejected'"),
      advances_total: c('SELECT COUNT(*) c FROM advances'),
      advances_pending: c("SELECT COUNT(*) c FROM advances WHERE status='pending'"),
      adjustments_total: c('SELECT COUNT(*) c FROM adjustments'),
      expenses_total: c('SELECT COUNT(*) c FROM site_expenses'),
      audit_logs_total: c('SELECT COUNT(*) c FROM audit_logs'),
      sessions_active: c('SELECT COUNT(*) c FROM sessions WHERE expires_at > ?', now),
      push_subs_total: c('SELECT COUNT(*) c FROM push_subs'),
      push_users_total: c('SELECT COUNT(DISTINCT user_id) c FROM push_subs'),
      locked_months: c('SELECT COUNT(*) c FROM month_locks'),
      login_lockouts: activeLockouts,
    },
    analytics: {
      month: curMonth,
      daily_14d: daily14d,
      top_workers: topWorkers,
      site_costs: siteCosts,
    },
    locked_months_list: db.prepare(`SELECT m.*, u.name AS locked_by_name FROM month_locks m LEFT JOIN users u ON u.id = m.locked_by ORDER BY m.month DESC`).all(),
    config: getSiteConfig(),
    reminder: { enabled: push.getRemindEnabled(), time: push.getRemindTime() },
  });
}));

api.put('/admin/credentials', webAdminOnly, wrap((req, res) => {
  const { old_password, current_password, new_username, new_password } = req.body || {};
  const curPass = old_password ?? current_password ?? '';
  if (!bcrypt.compareSync(String(curPass), getWebAdminPassHash())) {
    throw bad('Mật khẩu Quản trị Website hiện tại không đúng');
  }
  const nextUser = str(new_username, 60) || getWebAdminUser();
  if (nextUser.length < 3) throw bad('Tên tài khoản Quản trị tối thiểu 3 ký tự');
  setSetting('webadmin_user', nextUser);
  if (new_password) {
    if (String(new_password).length < 4) throw bad('Mật khẩu mới tối thiểu 4 ký tự');
    setSetting('webadmin_pass_hash', bcrypt.hashSync(String(new_password), 10));
  }
  db.prepare('UPDATE webadmin_sessions SET username = ? WHERE token = ?').run(nextUser, req.webAdmin.token);
  db.prepare('DELETE FROM webadmin_sessions WHERE token != ?').run(req.webAdmin.token);
  audit(req, 'security.wa_creds', 'settings', null, `Đổi thông tin đăng nhập Quản trị Website (${nextUser})`);
  res.json({ ok: true, username: nextUser });
}));

// Đăng nhập thử (Impersonate) vào bất kỳ tài khoản Quản lý / Nhân viên nào
api.post('/admin/impersonate/:id', webAdminOnly, wrap((req, res) => {
  const uid = Number(req.params.id);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
  if (!u) throw new HttpError(404, 'Không tìm thấy tài khoản');
  createSession(res, req, u.id);
  audit(req, 'security.impersonate', 'user', u.id,
    `Webmaster (${req.webAdmin.username}) đăng nhập thử vào tài khoản "${u.name}" (${u.phone})`);
  res.json(publicUser(u));
}));

// Khôi phục dữ liệu từ file sao lưu .db và tải lên file sao lưu .db
function restoreSqliteBackupFile(filePath) {
  if (!fs.existsSync(filePath)) throw new HttpError(404, 'Không tìm thấy file sao lưu');
  const fd = fs.openSync(filePath, 'r');
  const magic = Buffer.alloc(16);
  fs.readSync(fd, magic, 0, 16, 0);
  fs.closeSync(fd);
  if (magic.toString('utf8', 0, 15) !== 'SQLite format 3') {
    throw bad('File không phải là cơ sở dữ liệu SQLite (.db) hợp lệ');
  }
  const { DatabaseSync } = require('node:sqlite');
  let checkDb;
  try {
    checkDb = new DatabaseSync(filePath, { readOnly: true });
    const chk = checkDb.prepare('PRAGMA integrity_check').get();
    if (!chk || chk.integrity_check !== 'ok') throw new Error('File CSDL bị lỗi cấu trúc');
    const hasUsers = checkDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
    if (!hasUsers) throw new Error('File CSDL không chứa bảng dữ liệu TBT Báo Công');
  } catch (e) {
    throw bad(e.message || 'File sao lưu không hợp lệ');
  } finally {
    try { checkDb?.close(); } catch { /* ignore */ }
  }

  // Tạo bản sao lưu an toàn trước khi khôi phục
  const preBackup = createBackup('pre-restore');
  const curWaUser = getWebAdminUser();
  const curWaHash = getWebAdminPassHash();
  const safePath = filePath.replace(/'/g, "''");

  db.exec(`ATTACH DATABASE '${safePath}' AS bk_src`);
  try {
    const srcTables = new Set(
      db.prepare("SELECT name FROM bk_src.sqlite_master WHERE type='table'").all().map((t) => t.name)
    );
    const tablesToRestore = [
      'users', 'sites', 'reports', 'advances', 'adjustments',
      'audit_logs', 'push_subs', 'settings', 'month_locks',
      'payroll_paid', 'site_expenses',
    ];
    db.exec('PRAGMA foreign_keys = OFF; BEGIN;');
    try {
      for (const tbl of tablesToRestore) {
        if (!srcTables.has(tbl)) continue;
        const dstCols = db.prepare(`PRAGMA main.table_info(${tbl})`).all().map((c) => c.name);
        const srcCols = new Set(db.prepare(`PRAGMA bk_src.table_info(${tbl})`).all().map((c) => c.name));
        const common = dstCols.filter((c) => srcCols.has(c));
        if (!common.length) continue;
        const colStr = common.join(', ');
        db.exec(`DELETE FROM main.${tbl}; INSERT INTO main.${tbl} (${colStr}) SELECT ${colStr} FROM bk_src.${tbl};`);
      }
      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    } finally {
      db.exec('PRAGMA foreign_keys = ON;');
    }
    setSetting('webadmin_user', curWaUser);
    setSetting('webadmin_pass_hash', curWaHash);
  } finally {
    try { db.exec('DETACH DATABASE bk_src'); } catch { /* ignore */ }
  }
  return preBackup;
}

const uploadBackup = multer({
  storage: multer.diskStorage({
    destination: BACKUP_DIR,
    filename: (req, file, cb) => {
      const now = new Date();
      const p = (n) => String(n).padStart(2, '0');
      const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
      cb(null, `upload-${stamp}.db`);
    },
  }),
  limits: { fileSize: 30 * 1024 * 1024, files: 1 },
});

api.post('/admin/backups/restore/:name', webAdminOnly, wrap((req, res) => {
  const name = req.params.name;
  if (!/^[\w.-]+\.db$/.test(name)) throw bad('Tên file sao lưu không hợp lệ');
  const filePath = path.join(BACKUP_DIR, name);
  const preBackup = restoreSqliteBackupFile(filePath);
  audit(req, 'backup.restore', 'settings', null, `Khôi phục dữ liệu từ bản sao lưu "${name}" (đã tự động lưu bản an toàn "${preBackup.name}")`);
  res.json({ ok: true, restored: name, pre_backup: preBackup.name });
}));

api.post('/admin/backups/upload', webAdminOnly, uploadBackup.single('backup'), wrap((req, res) => {
  if (!req.file) throw bad('Vui lòng chọn file sao lưu (.db)');
  const filePath = req.file.path;
  const restoreNow = req.body?.restore_now === '1' || req.body?.restore_now === 'true';
  try {
    if (restoreNow) {
      const preBackup = restoreSqliteBackupFile(filePath);
      audit(req, 'backup.restore', 'settings', null, `Tải lên & khôi phục dữ liệu từ file "${req.file.filename}"`);
      return res.json({ ok: true, uploaded: req.file.filename, restored: true, pre_backup: preBackup.name });
    }
    // Kiểm tra tính hợp lệ của file .db khi chỉ tải lên lưu trữ
    const { DatabaseSync } = require('node:sqlite');
    const checkDb = new DatabaseSync(filePath, { readOnly: true });
    const chk = checkDb.prepare('PRAGMA integrity_check').get();
    checkDb.close();
    if (!chk || chk.integrity_check !== 'ok') throw new Error('File .db không hợp lệ');
    audit(req, 'backup.upload', 'settings', null, `Tải lên file sao lưu "${req.file.filename}"`);
    res.json({ ok: true, uploaded: req.file.filename, restored: false });
  } catch (e) {
    fs.rmSync(filePath, { force: true });
    throw bad(e.message || 'File sao lưu không hợp lệ');
  }
}));

api.delete('/admin/users/:id', webAdminOnly, wrap((req, res) => {
  const uid = Number(req.params.id);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
  if (!u) throw new HttpError(404, 'Không tìm thấy tài khoản');
  const photos = db.prepare('SELECT photo FROM reports WHERE user_id = ? AND photo IS NOT NULL').all(uid).map((r) => r.photo);
  tx(() => {
    db.prepare('UPDATE reports SET reviewed_by = NULL WHERE reviewed_by = ?').run(uid);
    db.prepare('UPDATE advances SET reviewed_by = NULL WHERE reviewed_by = ?').run(uid);
    db.prepare('UPDATE adjustments SET created_by = NULL WHERE created_by = ?').run(uid);
    db.prepare('UPDATE audit_logs SET user_id = NULL WHERE user_id = ?').run(uid);
    db.prepare('UPDATE month_locks SET locked_by = NULL WHERE locked_by = ?').run(uid);
    db.prepare('UPDATE payroll_paid SET paid_by = NULL WHERE paid_by = ?').run(uid);
    db.prepare('UPDATE site_expenses SET created_by = NULL WHERE created_by = ?').run(uid);
    db.prepare('DELETE FROM reports WHERE user_id = ?').run(uid);
    db.prepare('DELETE FROM advances WHERE user_id = ?').run(uid);
    db.prepare('DELETE FROM adjustments WHERE user_id = ?').run(uid);
    db.prepare('DELETE FROM users WHERE id = ?').run(uid);
  });
  for (const p of photos) removePhoto(p);
  audit(req, 'user.delete', 'user', uid, `Xóa vĩnh viễn tài khoản "${u.name}" (${u.phone})`);
  res.json({ ok: true });
}));

api.put('/admin/config', webAdminOnly, wrap((req, res) => {
  const b = req.body || {};
  if (b.site_title !== undefined) setSetting('site_title', str(b.site_title, 80) || 'TBT Báo Công');
  if (b.site_slogan !== undefined) setSetting('site_slogan', str(b.site_slogan, 160));
  if (b.brand_team !== undefined) setSetting('brand_team', str(b.brand_team, 20) || 'TBT');
  if (b.brand_dev !== undefined) setSetting('brand_dev', str(b.brand_dev, 80) || 'Tên Dev');
  if (b.brand_dev_link !== undefined) setSetting('brand_dev_link', str(b.brand_dev_link, 300));
  if (b.system_banner !== undefined) setSetting('system_banner', str(b.system_banner, 500));
  if (b.backdate_days !== undefined) {
    const bd = Math.min(30, Math.max(0, Math.round(Number(b.backdate_days) || 0)));
    setSetting('backdate_days', String(bd));
  }
  if (b.default_check_in !== undefined) {
    if (!isTime(b.default_check_in)) throw bad('Giờ vào ca mặc định không hợp lệ');
    setSetting('default_check_in', b.default_check_in);
  }
  if (b.default_check_out !== undefined) {
    if (!isTime(b.default_check_out)) throw bad('Giờ tan ca mặc định không hợp lệ');
    setSetting('default_check_out', b.default_check_out);
  }
  if (b.require_photo !== undefined) setSetting('require_photo', b.require_photo ? '1' : '0');
  if (b.require_gps !== undefined) setSetting('require_gps', b.require_gps ? '1' : '0');
  if (b.maintenance_mode !== undefined) setSetting('maintenance_mode', b.maintenance_mode ? '1' : '0');
  audit(req, 'settings.config', 'settings', null, 'Cập nhật cấu hình hệ thống website');
  res.json(getSiteConfig());
}));

api.get('/admin/sessions', webAdminOnly, (req, res) => {
  const now = Date.now();
  const rows = db.prepare(`
    SELECT substr(s.token, 1, 12) AS sid, s.token = ? AS is_current, s.user_id, s.expires_at,
           u.name AS user_name, u.phone AS user_phone, u.role AS user_role, u.active AS user_active
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.expires_at > ?
    ORDER BY s.expires_at DESC
  `).all(req.token || '', now);
  const lockouts = [];
  for (const [k, v] of loginFails.entries()) {
    if (v.until > now && v.count >= 3) {
      const parts = k.split('|');
      lockouts.push({ key: k, ip: parts[0], phone: parts[parts.length - 1], count: v.count, locked: v.count >= 10, until: v.until });
    }
  }
  res.json({ sessions: rows, lockouts });
});

api.delete('/admin/sessions/:sid', webAdminOnly, wrap((req, res) => {
  const sid = req.params.sid;
  if (sid === 'all-others') {
    const r = db.prepare('DELETE FROM sessions WHERE token != ?').run(req.token || '');
    audit(req, 'security.logout_all', 'settings', null, `Đăng xuất toàn bộ ${r.changes} phiên thiết bị`);
    return res.json({ ok: true, removed: r.changes });
  }
  if (!/^[a-f0-9]{12}$/.test(sid)) throw bad('Mã phiên không hợp lệ');
  const r = db.prepare('DELETE FROM sessions WHERE substr(token, 1, 12) = ?').run(sid);
  audit(req, 'security.revoke_session', 'settings', null, `Thu hồi phiên đăng nhập #${sid.slice(0, 6)}`);
  res.json({ ok: true, removed: r.changes });
}));

api.post('/admin/unblock-logins', webAdminOnly, wrap((req, res) => {
  const n = loginFails.size;
  loginFails.clear();
  audit(req, 'security.unblock', 'settings', null, 'Xóa toàn bộ bộ đếm khóa đăng nhập sai');
  res.json({ ok: true, cleared: n });
}));

api.post('/admin/maintenance/cleanup', webAdminOnly, wrap((req, res) => {
  const action = req.body?.action;
  if (action === 'vacuum') {
    db.exec('ANALYZE; VACUUM;');
    audit(req, 'maintenance.vacuum', 'settings', null, 'Tối ưu hóa & nén cơ sở dữ liệu (VACUUM & ANALYZE)');
    return res.json({ ok: true, message: 'Đã tối ưu hóa và nén cơ sở dữ liệu thành công!' });
  }
  if (action === 'orphan_photos') {
    const used = new Set(db.prepare('SELECT photo FROM reports WHERE photo IS NOT NULL').all().map((r) => r.photo));
    const files = fs.existsSync(UPLOAD_DIR) ? fs.readdirSync(UPLOAD_DIR).filter((f) => !f.startsWith('.')) : [];
    let removed = 0, freed = 0;
    for (const f of files) {
      if (!used.has(f)) {
        const p = path.join(UPLOAD_DIR, f);
        try { freed += fs.statSync(p).size; fs.rmSync(p, { force: true }); removed++; } catch { /* ignore */ }
      }
    }
    audit(req, 'maintenance.orphan_photos', 'settings', null, `Dọn ${removed} ảnh rác (${Math.round(freed / 1024)} KB)`);
    return res.json({ ok: true, removed, freed, message: `Đã dọn ${removed} ảnh thừa, giải phóng ${Math.round(freed / 1024)} KB.` });
  }
  if (action === 'expired_sessions') {
    const r = db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
    db.prepare('DELETE FROM webadmin_sessions WHERE expires_at <= ?').run(Date.now());
    return res.json({ ok: true, removed: r.changes, message: `Đã dọn ${r.changes} phiên đăng nhập hết hạn.` });
  }
  if (action === 'old_logs') {
    const r = db.prepare("DELETE FROM audit_logs WHERE created_at < datetime('now', '-90 days')").run();
    audit(req, 'maintenance.old_logs', 'settings', null, `Dọn ${r.changes} nhật ký cũ hơn 90 ngày`);
    return res.json({ ok: true, removed: r.changes, message: `Đã dọn ${r.changes} dòng nhật ký cũ hơn 90 ngày.` });
  }
  throw bad('Thao tác bảo trì không hợp lệ');
}));

api.post('/admin/broadcast', webAdminOnly, wrap(async (req, res) => {
  const { title, body, target } = req.body || {};
  const t = str(title, 100) || '📢 Thông báo từ Quản lý';
  const b = str(body, 300);
  if (!b) throw bad('Nhập nội dung thông báo');
  let userIds = [];
  if (target === 'not_reported') {
    const today = localDate();
    userIds = db.prepare(`SELECT id FROM users WHERE role='worker' AND active=1 AND id NOT IN (SELECT user_id FROM reports WHERE work_date = ?)`).all(today).map((u) => u.id);
  } else if (target && target !== 'all' && /^\d+$/.test(String(target))) {
    userIds = [Number(target)];
  } else {
    userIds = db.prepare('SELECT id FROM users WHERE active=1').all().map((u) => u.id);
  }
  let sent = 0;
  for (const uid of userIds) {
    try {
      const n = await push.sendToUser(uid, { title: t, body: b, url: '/', tag: 'broadcast-' + Date.now() });
      if (n > 0) sent++;
    } catch { /* ignore */ }
  }
  audit(req, 'push.broadcast', 'settings', null, `Phát thông báo đẩy "${t}": "${b}" (${sent} người nhận)`);
  res.json({ ok: true, sent, total_targets: userIds.length });
}));

// Tải ứng dụng Android APK dành cho Webmaster
const WEBADMIN_APK_PATH = path.join(__dirname, 'android-webadmin', 'dist', 'TBT-QuanTriWeb-v2.0.0.apk');
function sendWebAdminApk(req, res) {
  if (!fs.existsSync(WEBADMIN_APK_PATH)) {
    return res.status(404).json({ error: 'Chưa tìm thấy bản dựng APK trên máy chủ' });
  }
  res.setHeader('Content-Type', 'application/vnd.android.package-archive');
  res.setHeader('Content-Disposition', 'attachment; filename="TBT-QuanTriWeb-v2.0.0.apk"');
  res.sendFile(WEBADMIN_APK_PATH);
}
api.get('/admin/download-apk', sendWebAdminApk);
app.get('/download/TBT-QuanTriWeb.apk', sendWebAdminApk);

app.use('/api', api);
app.use('/api', (req, res) => res.status(404).json({ error: 'Không tìm thấy' }));

// ---------- Giao diện ----------
// sw.js, index.html, app.js, style.css không cache để trình duyệt luôn nhận bản mới nhất
app.get(['/sw.js', '/', '/index.html', '/admin', '/app.js', '/style.css'], (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  next();
});
app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html', maxAge: 0 }));
app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ---------- Xử lý lỗi ----------
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Ảnh quá lớn (tối đa 8MB)' : 'Lỗi tải ảnh' });
  }
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Lỗi máy chủ, vui lòng thử lại' : err.message });
});

app.listen(PORT, HOST, () => {
  console.log(`✅ TBT Báo Công đang chạy tại http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`   Dữ liệu lưu tại: ${DATA_DIR}`);
  push.startScheduler();
  console.log(`   🔔 Nhắc báo công: ${push.getRemindEnabled() ? 'lúc ' + push.getRemindTime() : 'tắt'}`);
  // Tự động sao lưu mỗi ngày 1 bản
  const autoBackup = () => {
    const today = localDate();
    if (getSetting('backup_last') !== today) {
      try { createBackup('auto'); setSetting('backup_last', today); } catch (e) { console.warn('Auto backup lỗi:', e.message); }
    }
  };
  autoBackup();
  setInterval(autoBackup, 3600 * 1000).unref();
});
