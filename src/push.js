// Thông báo đẩy (Web Push): nhắc báo công, báo kết quả duyệt
const fs = require('node:fs');
const path = require('node:path');
const webpush = require('web-push');
const { db, DATA_DIR, getSetting, setSetting } = require('./db');

// Khoá VAPID được tạo một lần và lưu trong thư mục dữ liệu
const KEY_FILE = path.join(DATA_DIR, 'vapid.json');
let keys;
if (fs.existsSync(KEY_FILE)) keys = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));
else {
  keys = webpush.generateVAPIDKeys();
  fs.writeFileSync(KEY_FILE, JSON.stringify(keys), { mode: 0o600 });
}
webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@tbt.local', keys.publicKey, keys.privateKey);

const publicKey = keys.publicKey;

function subscribe(userId, sub) {
  if (!sub || typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) {
    throw new Error('Dữ liệu đăng ký không hợp lệ');
  }
  db.prepare(`INSERT INTO push_subs (endpoint, user_id, p256dh, auth) VALUES (?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`)
    .run(sub.endpoint.slice(0, 1000), userId, String(sub.keys.p256dh).slice(0, 200), String(sub.keys.auth).slice(0, 100));
}
function unsubscribe(endpoint) {
  db.prepare('DELETE FROM push_subs WHERE endpoint = ?').run(String(endpoint || ''));
}
const isSubscribed = (userId) => !!db.prepare('SELECT 1 FROM push_subs WHERE user_id = ?').get(userId);

/** Gửi thông báo tới mọi thiết bị của một người. Lỗi được bỏ qua (không làm hỏng thao tác chính). */
async function sendToUser(userId, payload) {
  const subs = db.prepare('SELECT * FROM push_subs WHERE user_id = ?').all(userId);
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload), { TTL: 6 * 3600 });
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) unsubscribe(s.endpoint); // thiết bị đã hủy đăng ký
      else console.warn('Push lỗi:', e.statusCode || e.message);
    }
  }));
}

// ----- Nhắc báo công hằng ngày -----
function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const getRemindTime = () => getSetting('remind_time', process.env.REMIND_AT || '17:00');
const getRemindEnabled = () => getSetting('remind_enabled', '1') === '1';

async function runReminder() {
  const today = localDate();
  const users = db.prepare(`SELECT u.id, u.name FROM users u WHERE u.role = 'worker' AND u.active = 1
    AND u.id NOT IN (SELECT user_id FROM reports WHERE work_date = ?)
    AND u.id IN (SELECT user_id FROM push_subs)`).all(today);
  for (const u of users) {
    await sendToUser(u.id, {
      title: 'TBT Báo Công ⏰',
      body: `${u.name.split(' ').pop()} ơi, hôm nay bạn chưa báo công. Bấm để báo ngay nhé!`,
      url: '/#/report', tag: 'remind-' + today,
    });
  }
  return users.length;
}

function startScheduler() {
  setInterval(() => {
    if (!getRemindEnabled()) return;
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const today = localDate(now);
    if (hhmm >= getRemindTime() && getSetting('remind_last') !== today) {
      setSetting('remind_last', today);
      runReminder().then((n) => n && console.log(`🔔 Đã nhắc ${n} người chưa báo công`)).catch(console.error);
    }
  }, 30 * 1000).unref();
}

module.exports = {
  publicKey, subscribe, unsubscribe, isSubscribed, sendToUser, runReminder, startScheduler,
  getRemindTime, getRemindEnabled,
};
