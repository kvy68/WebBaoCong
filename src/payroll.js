// Tính bảng công và lương theo tháng
const { db } = require('./db');

const DAY_VALUE = { full: 1, half: 0.5, off: 0 };

/** Trả về [ngày đầu, ngày cuối, số ngày] của tháng dạng YYYY-MM-DD. */
function monthRange(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || '')) throw new Error('Tháng không hợp lệ (YYYY-MM)');
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [`${month}-01`, `${month}-${String(last).padStart(2, '0')}`, last];
}

/**
 * Tính lương tháng. Chỉ các báo công / ứng tiền ĐÃ DUYỆT mới được tính.
 *   earned = công × lương ngày + giờ TC × tiền/giờ TC
 *   gross  = earned + phụ cấp + thưởng − phạt
 *   net    = gross − đã ứng
 * @param {string} month YYYY-MM
 * @param {number} [userId] nếu có, chỉ tính cho một người
 */
function computePayroll(month, userId) {
  const [from, to, days] = monthRange(month);
  const users = userId
    ? db.prepare('SELECT * FROM users WHERE id = ?').all(userId)
    : db.prepare("SELECT * FROM users WHERE role = 'worker' ORDER BY active DESC, name").all();

  const repStmt = db.prepare(
    `SELECT r.*, s.name AS site_name FROM reports r LEFT JOIN sites s ON s.id = r.site_id
     WHERE r.user_id = ? AND r.work_date BETWEEN ? AND ? ORDER BY r.work_date`
  );
  const advStmt = db.prepare(
    `SELECT * FROM advances WHERE user_id = ? AND adv_date BETWEEN ? AND ? AND status = 'approved' ORDER BY adv_date`
  );
  const adjStmt = db.prepare(
    `SELECT * FROM adjustments WHERE user_id = ? AND adj_date BETWEEN ? AND ? ORDER BY adj_date, id`
  );
  const paidStmt = db.prepare(
    `SELECT p.*, u.name AS paid_by_name FROM payroll_paid p LEFT JOIN users u ON u.id = p.paid_by WHERE p.month = ? AND p.user_id = ?`
  );
  const lockRow = db.prepare(
    `SELECT l.*, u.name AS locked_by_name FROM month_locks l LEFT JOIN users u ON u.id = l.locked_by WHERE l.month = ?`
  ).get(month) || null;

  const rows = users.map((u) => {
    const reports = repStmt.all(u.id, from, to);
    const advances = advStmt.all(u.id, from, to);
    const adjustments = adjStmt.all(u.id, from, to);
    const paid = paidStmt.get(month, u.id) || null;
    let workDays = 0, otHours = 0, wageAmount = 0, otAmount = 0, pending = 0;
    const byDay = {};
    for (const r of reports) {
      byDay[r.work_date] = {
        id: r.id,
        day_type: r.day_type,
        status: r.status,
        ot_hours: r.ot_hours,
        site_name: r.site_name || '',
        check_in: r.check_in || '',
        check_out: r.check_out || '',
        note: r.note || '',
      };
      if (r.status === 'pending') pending++;
      if (r.status !== 'approved') continue;
      const v = DAY_VALUE[r.day_type];
      const wage = r.wage_snapshot ?? u.daily_wage;
      const rate = r.ot_rate_snapshot ?? u.ot_rate;
      workDays += v;
      otHours += r.ot_hours;
      wageAmount += v * wage;
      otAmount += r.ot_hours * rate;
    }
    const sumKind = (k) => adjustments.filter((a) => a.kind === k).reduce((s, a) => s + a.amount, 0);
    const bonus = sumKind('bonus'), allowance = sumKind('allowance'), penalty = sumKind('penalty');
    const advanceTotal = advances.reduce((s, a) => s + a.amount, 0);
    const earned = Math.round(wageAmount + otAmount);
    const gross = earned + bonus + allowance - penalty;
    return {
      user: {
        id: u.id,
        name: u.name,
        phone: u.phone,
        daily_wage: u.daily_wage,
        ot_rate: u.ot_rate,
        active: u.active,
        bank_bin: u.bank_bin || '',
        bank_name: u.bank_name || '',
        bank_account: u.bank_account || '',
        bank_holder: u.bank_holder || '',
      },
      work_days: workDays,
      ot_hours: Math.round(otHours * 100) / 100,
      wage_amount: Math.round(wageAmount),
      ot_amount: Math.round(otAmount),
      earned,
      bonus_total: bonus,
      allowance_total: allowance,
      penalty_total: penalty,
      gross,
      advance_total: advanceTotal,
      net: gross - advanceTotal,
      pending_reports: pending,
      by_day: byDay,
      advances,
      adjustments,
      reports,
      paid,
    };
  });
  return { month, from, to, days, locked: lockRow, rows };
}

/** Tính chi phí theo từng công trình (tất cả thời gian hoặc theo tháng YYYY-MM). */
function computeSiteCosts(month) {
  let repWhere = "r.status = 'approved' AND r.day_type != 'off'";
  let expWhere = '1=1';
  const repArgs = [], expArgs = [];
  if (month) {
    const [from, to] = monthRange(month);
    repWhere += ' AND r.work_date BETWEEN ? AND ?';
    repArgs.push(from, to);
    expWhere += ' AND e.exp_date BETWEEN ? AND ?';
    expArgs.push(from, to);
  }
  const sites = db.prepare('SELECT * FROM sites ORDER BY active DESC, name').all();
  const repRows = db.prepare(
    `SELECT r.site_id, r.day_type, r.ot_hours, r.wage_snapshot, r.ot_rate_snapshot, u.daily_wage, u.ot_rate
     FROM reports r JOIN users u ON u.id = r.user_id WHERE ${repWhere}`
  ).all(...repArgs);
  const expRows = db.prepare(
    `SELECT e.*, u.name AS creator_name FROM site_expenses e LEFT JOIN users u ON u.id = e.created_by
     WHERE ${expWhere} ORDER BY e.exp_date DESC, e.id DESC`
  ).all(...expArgs);

  const map = new Map();
  for (const s of sites) {
    map.set(s.id, {
      site: s,
      work_days: 0,
      ot_hours: 0,
      wage_cost: 0,
      ot_cost: 0,
      expense_cost: 0,
      total_cost: 0,
      expenses: [],
    });
  }
  for (const r of repRows) {
    if (!r.site_id || !map.has(r.site_id)) continue;
    const item = map.get(r.site_id);
    const v = DAY_VALUE[r.day_type] || 0;
    const wage = r.wage_snapshot ?? r.daily_wage;
    const rate = r.ot_rate_snapshot ?? r.ot_rate;
    item.work_days += v;
    item.ot_hours += r.ot_hours;
    item.wage_cost += v * wage;
    item.ot_cost += r.ot_hours * rate;
  }
  for (const e of expRows) {
    if (!map.has(e.site_id)) continue;
    const item = map.get(e.site_id);
    item.expense_cost += e.amount;
    item.expenses.push(e);
  }
  const rows = [...map.values()].map((x) => {
    x.ot_hours = Math.round(x.ot_hours * 100) / 100;
    x.wage_cost = Math.round(x.wage_cost);
    x.ot_cost = Math.round(x.ot_cost);
    x.total_cost = x.wage_cost + x.ot_cost + x.expense_cost;
    return x;
  });
  return { month: month || null, rows };
}

/** Thống kê tổng hợp N tháng gần nhất (tính đến tháng `until`) + điểm danh theo ngày của tháng `until`. */
function monthlyStats(until, months = 6) {
  const [y, m] = until.split('-').map(Number);
  const series = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const p = computePayroll(key);
    series.push({
      month: key,
      work_days: p.rows.reduce((s, r) => s + r.work_days, 0),
      ot_hours: p.rows.reduce((s, r) => s + r.ot_hours, 0),
      gross: p.rows.reduce((s, r) => s + r.gross, 0),
      advance: p.rows.reduce((s, r) => s + r.advance_total, 0),
    });
  }
  const [from, to, days] = monthRange(until);
  const daily = db.prepare(
    `SELECT work_date, SUM(CASE day_type WHEN 'full' THEN 1 WHEN 'half' THEN 0.5 ELSE 0 END) AS days, COUNT(*) AS n
     FROM reports WHERE status = 'approved' AND work_date BETWEEN ? AND ? GROUP BY work_date`
  ).all(from, to);
  const bySite = db.prepare(
    `SELECT COALESCE(s.name, '(Không rõ)') AS name,
       SUM(CASE r.day_type WHEN 'full' THEN 1 WHEN 'half' THEN 0.5 ELSE 0 END) AS days
     FROM reports r LEFT JOIN sites s ON s.id = r.site_id
     WHERE r.status = 'approved' AND r.day_type != 'off' AND r.work_date BETWEEN ? AND ?
     GROUP BY r.site_id ORDER BY days DESC LIMIT 8`
  ).all(from, to);
  return { series, daily, days, by_site: bySite };
}

module.exports = { computePayroll, computeSiteCosts, monthlyStats, monthRange, DAY_VALUE };
