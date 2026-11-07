// Xuất bảng công / lương tháng ra file Excel
const ExcelJS = require('exceljs');
const { computePayroll, computeSiteCosts } = require('./payroll');

const MONEY = '#,##0';
const DAY_LABEL = { full: 'X', half: '½', off: 'N' };
const STATUS_LABEL = { pending: 'Chờ duyệt', approved: 'Đã duyệt', rejected: 'Từ chối' };
const TYPE_LABEL = { full: 'Cả ngày', half: 'Nửa ngày', off: 'Nghỉ' };

function styleHeader(row) {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  row.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
  });
}

async function buildWorkbook(month) {
  const data = computePayroll(month);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'TBT Báo Công';

  // 1) Bảng lương
  const s1 = wb.addWorksheet('Bảng lương');
  s1.addRow([`NHÓM TBT – BẢNG LƯƠNG THÁNG ${month.slice(5)}/${month.slice(0, 4)}`]).font = { bold: true, size: 14 };
  s1.addRow([]);
  s1.columns = [
    { width: 5 }, { width: 24 }, { width: 14 }, { width: 10 }, { width: 13 }, { width: 14 },
    { width: 10 }, { width: 13 }, { width: 14 }, { width: 13 }, { width: 13 }, { width: 13 },
    { width: 15 }, { width: 13 }, { width: 15 }, { width: 14 },
  ];
  styleHeader(s1.addRow(['STT', 'Họ tên', 'SĐT', 'Số công', 'Lương/ngày', 'Tiền công',
    'Giờ TC', 'Tiền/giờ TC', 'Tiền tăng ca', 'Phụ cấp', 'Thưởng', 'Phạt', 'Tổng lương', 'Đã ứng', 'Thực lĩnh', 'Thanh toán']));
  data.rows.forEach((r, i) => {
    s1.addRow([i + 1, r.user.name, r.user.phone, r.work_days, r.user.daily_wage, r.wage_amount,
      r.ot_hours, r.user.ot_rate, r.ot_amount, r.allowance_total, r.bonus_total, r.penalty_total,
      r.gross, r.advance_total, r.net, r.paid ? 'Đã trả' : 'Chưa trả']);
  });
  const sum = (k) => data.rows.reduce((s, r) => s + r[k], 0);
  const total = s1.addRow(['', 'TỔNG CỘNG', '', sum('work_days'), '', sum('wage_amount'), sum('ot_hours'), '',
    sum('ot_amount'), sum('allowance_total'), sum('bonus_total'), sum('penalty_total'),
    sum('gross'), sum('advance_total'), sum('net'), '']);
  total.font = { bold: true };
  [5, 6, 8, 9, 10, 11, 12, 13, 14, 15].forEach((c) => (s1.getColumn(c).numFmt = MONEY));
  s1.views = [{ state: 'frozen', ySplit: 3 }];

  // 2) Bảng chấm công dạng lưới
  const s2 = wb.addWorksheet('Bảng chấm công');
  s2.addRow([`BẢNG CHẤM CÔNG THÁNG ${month.slice(5)}/${month.slice(0, 4)}  (X: cả ngày, ½: nửa ngày, N: nghỉ, ?: chờ duyệt)`]).font = { bold: true };
  const head = ['Họ tên'];
  for (let d = 1; d <= data.days; d++) head.push(d);
  head.push('Tổng công', 'Giờ TC');
  styleHeader(s2.addRow(head));
  s2.getColumn(1).width = 24;
  for (let d = 2; d <= data.days + 1; d++) s2.getColumn(d).width = 4;
  s2.getColumn(data.days + 2).width = 10;
  s2.getColumn(data.days + 3).width = 8;
  for (const r of data.rows) {
    const line = [r.user.name];
    for (let d = 1; d <= data.days; d++) {
      const key = `${month}-${String(d).padStart(2, '0')}`;
      const x = r.by_day[key];
      if (!x || x.status === 'rejected') line.push('');
      else if (x.status === 'pending') line.push('?');
      else line.push(DAY_LABEL[x.day_type]);
    }
    line.push(r.work_days, r.ot_hours);
    const row = s2.addRow(line);
    row.alignment = { horizontal: 'center' };
    row.getCell(1).alignment = { horizontal: 'left' };
  }
  s2.views = [{ state: 'frozen', xSplit: 1, ySplit: 2 }];

  // 3) Chi tiết báo công
  const s3 = wb.addWorksheet('Chi tiết báo công');
  s3.columns = [
    { header: 'Ngày', width: 12 }, { header: 'Họ tên', width: 22 }, { header: 'Công trình', width: 22 },
    { header: 'Loại', width: 10 }, { header: 'Giờ vào', width: 9 }, { header: 'Giờ ra', width: 9 },
    { header: 'Giờ TC', width: 8 }, { header: 'Ghi chú', width: 36 }, { header: 'Trạng thái', width: 12 },
    { header: 'Vị trí (Google Maps)', width: 40 },
  ];
  styleHeader(s3.getRow(1));
  const all = data.rows.flatMap((r) => r.reports.map((x) => ({ ...x, user_name: r.user.name })));
  all.sort((a, b) => a.work_date.localeCompare(b.work_date) || a.user_name.localeCompare(b.user_name));
  for (const x of all) {
    const map = x.lat != null ? `https://maps.google.com/?q=${x.lat},${x.lng}` : '';
    const row = s3.addRow([x.work_date, x.user_name, x.site_name || '', TYPE_LABEL[x.day_type],
      x.check_in || '', x.check_out || '', x.ot_hours, x.note, STATUS_LABEL[x.status], map]);
    if (map) row.getCell(10).value = { text: map, hyperlink: map };
  }

  // 4) Ứng tiền
  const s4 = wb.addWorksheet('Ứng tiền');
  s4.columns = [
    { header: 'Ngày', width: 12 }, { header: 'Họ tên', width: 22 },
    { header: 'Số tiền', width: 14, style: { numFmt: MONEY } }, { header: 'Lý do', width: 40 },
  ];
  styleHeader(s4.getRow(1));
  for (const r of data.rows) for (const a of r.advances) s4.addRow([a.adv_date, r.user.name, a.amount, a.reason]);

  // 5) Thưởng / phụ cấp / phạt
  const KIND = { bonus: 'Thưởng', allowance: 'Phụ cấp', penalty: 'Phạt' };
  const s5 = wb.addWorksheet('Thưởng - Phạt');
  s5.columns = [
    { header: 'Ngày', width: 12 }, { header: 'Họ tên', width: 22 }, { header: 'Loại', width: 10 },
    { header: 'Số tiền', width: 14, style: { numFmt: MONEY } }, { header: 'Lý do', width: 40 },
  ];
  styleHeader(s5.getRow(1));
  for (const r of data.rows) {
    for (const j of r.adjustments) {
      const row = s5.addRow([j.adj_date, r.user.name, KIND[j.kind], j.kind === 'penalty' ? -j.amount : j.amount, j.reason]);
      if (j.kind === 'penalty') row.getCell(4).font = { color: { argb: 'FFDC2626' } };
    }
  }

  // 6) Chi phí theo công trình
  const siteCosts = computeSiteCosts(month);
  const s6 = wb.addWorksheet('Chi phí công trình');
  s6.columns = [
    { header: 'Công trình', width: 26 }, { header: 'Số công', width: 10 }, { header: 'Giờ TC', width: 10 },
    { header: 'Tiền công thợ', width: 15, style: { numFmt: MONEY } },
    { header: 'Tiền tăng ca', width: 15, style: { numFmt: MONEY } },
    { header: 'Vật tư / khác', width: 15, style: { numFmt: MONEY } },
    { header: 'Tổng chi phí', width: 16, style: { numFmt: MONEY } },
  ];
  styleHeader(s6.getRow(1));
  for (const x of siteCosts.rows) {
    s6.addRow([x.site.name, x.work_days, x.ot_hours, x.wage_cost, x.ot_cost, x.expense_cost, x.total_cost]);
  }

  return wb;
}

module.exports = { buildWorkbook };
