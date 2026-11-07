// Kết nối và khởi tạo cơ sở dữ liệu SQLite (dùng node:sqlite có sẵn trong Node.js)
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'baocong.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  phone         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'worker' CHECK (role IN ('admin','worker')),
  daily_wage    INTEGER NOT NULL DEFAULT 0,   -- lương 1 ngày công (VNĐ)
  ot_rate       INTEGER NOT NULL DEFAULT 0,   -- tiền 1 giờ tăng ca (VNĐ)
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sites (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  address    TEXT NOT NULL DEFAULT '',
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  site_id     INTEGER REFERENCES sites(id),
  work_date   TEXT NOT NULL,                 -- YYYY-MM-DD
  day_type    TEXT NOT NULL CHECK (day_type IN ('full','half','off')),
  check_in    TEXT,                          -- HH:MM
  check_out   TEXT,
  ot_hours    REAL NOT NULL DEFAULT 0,
  note        TEXT NOT NULL DEFAULT '',
  photo       TEXT,
  lat         REAL,
  lng         REAL,
  accuracy    REAL,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  -- Mức lương được "chốt" lúc duyệt để đổi lương sau này không ảnh hưởng dữ liệu cũ
  wage_snapshot INTEGER,
  ot_rate_snapshot INTEGER,
  review_note TEXT NOT NULL DEFAULT '',
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, work_date)
);
CREATE INDEX IF NOT EXISTS idx_reports_date ON reports(work_date);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);

CREATE TABLE IF NOT EXISTS advances (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  amount      INTEGER NOT NULL CHECK (amount > 0),
  reason      TEXT NOT NULL DEFAULT '',
  adv_date    TEXT NOT NULL,                 -- YYYY-MM-DD, dùng để trừ vào lương tháng đó
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  review_note TEXT NOT NULL DEFAULT '',
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_adv_date ON advances(adv_date);

-- Thưởng / phụ cấp / phạt (cộng trừ vào lương tháng có adj_date)
CREATE TABLE IF NOT EXISTS adjustments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  kind       TEXT NOT NULL CHECK (kind IN ('bonus','allowance','penalty')),
  amount     INTEGER NOT NULL CHECK (amount > 0),
  reason     TEXT NOT NULL DEFAULT '',
  adj_date   TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_adj_date ON adjustments(adj_date);

-- Nhật ký thao tác: ai làm gì, lúc nào
CREATE TABLE IF NOT EXISTS audit_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER REFERENCES users(id),
  action      TEXT NOT NULL,
  target_type TEXT,
  target_id   INTEGER,
  detail      TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs(created_at);

-- Đăng ký nhận thông báo đẩy (Web Push)
CREATE TABLE IF NOT EXISTS push_subs (
  endpoint   TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Chốt sổ tháng (khóa sửa/xóa báo công, ứng tiền, thưởng/phạt trong tháng đã chốt)
CREATE TABLE IF NOT EXISTS month_locks (
  month     TEXT PRIMARY KEY,               -- YYYY-MM
  locked_by INTEGER REFERENCES users(id),
  locked_at TEXT NOT NULL DEFAULT (datetime('now')),
  note      TEXT NOT NULL DEFAULT ''
);

-- Trạng thái đã trả lương cho từng nhân viên theo tháng
CREATE TABLE IF NOT EXISTS payroll_paid (
  month   TEXT NOT NULL,                    -- YYYY-MM
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  method  TEXT NOT NULL DEFAULT 'transfer', -- 'transfer' | 'cash'
  amount  INTEGER NOT NULL DEFAULT 0,
  paid_by INTEGER REFERENCES users(id),
  paid_at TEXT NOT NULL DEFAULT (datetime('now')),
  note    TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (month, user_id)
);

-- Chi phí khác tại công trình (vật tư, ăn uống, vận chuyển...)
CREATE TABLE IF NOT EXISTS site_expenses (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id    INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  amount     INTEGER NOT NULL CHECK (amount > 0),
  title      TEXT NOT NULL,
  exp_date   TEXT NOT NULL,                 -- YYYY-MM-DD
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_site_exp_date ON site_expenses(exp_date);

-- Phiên đăng nhập riêng dành cho Quản trị viên Website (Webmaster)
CREATE TABLE IF NOT EXISTS webadmin_sessions (
  token      TEXT PRIMARY KEY,
  username   TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at INTEGER NOT NULL
);
`);

// Nâng cấp cột tự động (an toàn cho CSDL đã có dữ liệu)
function ensureColumn(table, col, def) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}
ensureColumn('users', 'bank_bin', "TEXT NOT NULL DEFAULT ''");
ensureColumn('users', 'bank_name', "TEXT NOT NULL DEFAULT ''");
ensureColumn('users', 'bank_account', "TEXT NOT NULL DEFAULT ''");
ensureColumn('users', 'bank_holder', "TEXT NOT NULL DEFAULT ''");
ensureColumn('payroll_paid', 'method', "TEXT NOT NULL DEFAULT 'transfer'");
ensureColumn('payroll_paid', 'amount', 'INTEGER NOT NULL DEFAULT 0');

/** Chạy một hàm trong transaction. */
function tx(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/** Đọc / ghi cài đặt dạng key-value. */
function getSetting(key, fallback = null) {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return r ? r.value : fallback;
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));
}

module.exports = { db, tx, DATA_DIR, getSetting, setSetting };
