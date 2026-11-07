# 📋 TBT Báo Công

Web app báo công cho đội thợ / nhân viên: **báo công có ảnh + GPS → quản lý duyệt → tự tính lương tháng → xuất Excel**.

## Tính năng

**Nhân viên** (đăng nhập bằng SĐT + mật khẩu do quản lý cấp)
- Báo công hằng ngày: cả ngày / nửa ngày / nghỉ, chọn công trình, giờ vào – ra, giờ tăng ca, ghi chú
- **Bắt buộc chụp ảnh + GPS**; ảnh tự đóng dấu tên, giờ, tọa độ (chống gian lận dùng ảnh cũ)
- Báo bù tối đa 3 ngày trước (đổi bằng biến `BACKDATE_DAYS`)
- Xem lịch sử, trạng thái duyệt, lý do bị từ chối
- Xin ứng tiền, xem lương tháng tạm tính

**Quản lý**
- Duyệt / từ chối / sửa báo công (duyệt từng cái hoặc tất cả), xem ảnh và vị trí trên Google Maps
- Xem ai **chưa báo công hôm nay** (bấm gọi ngay)
- Duyệt ứng tiền, hoặc tự ghi khoản ứng cho nhân viên
- Bảng công tháng: số công, giờ TC, tổng lương, đã ứng, thực lĩnh
- **Xuất Excel**: Bảng lương · Bảng chấm công (lưới ngày) · Chi tiết báo công · Ứng tiền
- Quản lý nhân viên (lương ngày, tiền/giờ TC riêng từng người), công trình

**Cách tính lương:** `Thực lĩnh = Số công × Lương ngày + Giờ TC × Tiền/giờ TC + Phụ cấp + Thưởng − Phạt − Tiền đã ứng`
(chỉ tính báo công / khoản ứng **đã duyệt**; mức lương được chốt tại thời điểm duyệt).

### Mới trong v1.3
- 🔒 **Chốt sổ tháng & Đánh dấu "Đã trả lương"**: khóa tháng đã chốt không cho thêm/sửa/xóa nhầm; đánh dấu đã thanh toán lương cho từng người (hiển thị dấu `✓ ĐÃ THANH TOÁN` trên phiếu lương)
- 🏗️ **Chi phí theo công trình**: tự cộng tiền công thợ + tiền tăng ca + chi phí vật tư/khác theo từng công trình, xuất thêm sheet thứ 6 trong file Excel
- 💾 **Sao lưu dữ liệu tự động & trong app**: mỗi ngày tự sao lưu 1 bản SQLite (`data/backups/`, giữ 15 bản gần nhất); quản lý có thể bấm sao lưu và tải file `.db` ngay trong mục Tài khoản
- 🏖️ **Xin nghỉ phép trước**: nhân viên chọn `🏖 Xin nghỉ` có thể chọn ngày trước tối đa 30 ngày kèm lý do để quản lý duyệt
- 📶 **Lưu nháp khi mất sóng (Offline Queue)**: mất mạng hoặc sóng yếu vẫn chụp ảnh (đóng dấu giờ & GPS tại thời điểm chụp) và lưu vào máy; khi có mạng lại sẽ tự động gửi lên

### Mới trong v1.2
- 🎁 **Thưởng / phụ cấp / phạt** cộng trừ vào lương tháng (Bảng công → "Thưởng/Phạt", hoặc bấm vào tên nhân viên)
- 🧾 **Phiếu lương dạng ảnh**: gửi Zalo (nút Chia sẻ), tải về hoặc in
- 📅 **Lịch tháng** dạng ô ngày cho nhân viên (Lịch sử)
- 📈 **Biểu đồ thống kê**: lương & công 6 tháng, công từng ngày, công theo công trình, giờ tăng ca
- 🔔 **Thông báo đẩy**: nhắc báo công hằng ngày (giờ nhắc chỉnh trong Tài khoản), báo khi được duyệt / từ chối / thưởng / phạt
- 📜 **Nhật ký thao tác**: ai duyệt, sửa, xóa, thưởng/phạt, lúc nào (Nhân sự → Nhật ký)
- 🌙 **Chế độ tối** (Tài khoản → Giao diện: Tự động / Sáng / Tối)

> Thông báo đẩy cần **HTTPS**. Trên iPhone (iOS 16.4+) phải "Thêm vào MH chính" rồi mở từ đó mới bật được.

## Chạy thử trên máy

```bash
npm install
npm start          # mở http://localhost:3000
```

Lần đầu mở sẽ hiện màn hình **tạo tài khoản quản lý**.

> ⚠️ Trình duyệt điện thoại **chỉ cho lấy GPS khi trang chạy HTTPS** (hoặc `localhost`).
> Khi cho thợ dùng thật, phải cài lên VPS có tên miền + HTTPS như bên dưới.

## Cài lên VPS (Ubuntu/Debian)

1. **Mua tên miền**, trỏ bản ghi `A` (vd `baocong.tenmien.vn`) về IP của VPS.
2. Cài Node.js ≥ 22.13 và Caddy:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
   sudo apt install -y nodejs caddy
   ```
3. Copy code lên VPS và cài thư viện:
   ```bash
   sudo useradd -r -s /usr/sbin/nologin baocong
   sudo mkdir -p /opt/baocong && sudo chown $USER /opt/baocong
   # từ máy của bạn: scp -r server.js src public package*.json deploy user@IP:/opt/baocong/
   cd /opt/baocong && npm ci --omit=dev
   sudo chown -R baocong:baocong /opt/baocong
   ```
4. Chạy dịch vụ:
   ```bash
   sudo cp deploy/baocong.service /etc/systemd/system/
   sudo systemctl daemon-reload && sudo systemctl enable --now baocong
   ```
5. Bật HTTPS: sửa tên miền trong `deploy/Caddyfile`, rồi
   ```bash
   sudo cp deploy/Caddyfile /etc/caddy/Caddyfile && sudo systemctl reload caddy
   ```
6. Mở `https://baocong.tenmien.vn` → tạo tài khoản quản lý → thêm công trình → thêm nhân viên → gửi link + SĐT/mật khẩu cho thợ.
   Thợ mở link, bấm **"Thêm vào màn hình chính"** để dùng như app.

## Sao lưu

Toàn bộ dữ liệu nằm trong thư mục `data/` (`baocong.db` + `uploads/` chứa ảnh). Sao lưu định kỳ, ví dụ cron hằng đêm:

```bash
0 2 * * * sqlite3 /opt/baocong/data/baocong.db ".backup /backup/baocong-$(date +\%F).db"
```

## Biến môi trường

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `PORT` | `3000` | Cổng chạy |
| `HOST` | `0.0.0.0` | Địa chỉ lắng nghe (dùng `127.0.0.1` khi đứng sau Caddy) |
| `DATA_DIR` | `./data` | Nơi lưu database và ảnh |
| `TZ` | `Asia/Ho_Chi_Minh` | Múi giờ |
| `BACKDATE_DAYS` | `3` | Số ngày nhân viên được báo bù |
| `COOKIE_SECURE` | – | Đặt `1` khi chạy HTTPS |
| `REMIND_AT` | `17:00` | Giờ nhắc báo công mặc định (có thể đổi trong app) |
| `VAPID_SUBJECT` | `mailto:admin@tbt.local` | Email liên hệ cho dịch vụ thông báo đẩy |

## Cấu trúc

```
server.js          API (Express) + phục vụ giao diện
src/db.js          SQLite (node:sqlite có sẵn trong Node, không cần cài thêm)
src/payroll.js     Tính công & lương
src/export.js      Xuất Excel
public/            Giao diện web (HTML/CSS/JS thuần)
deploy/            File cấu hình VPS (systemd, Caddy)
```
