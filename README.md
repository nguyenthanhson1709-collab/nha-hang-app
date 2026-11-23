# Sổ sách nhà hàng (Restaurant-Buchhaltung)

Web app chạy trên điện thoại để quản lý chứng từ của nhiều nhà hàng ở Đức: scan hoá đơn mua vào và Z-Bon, đọc MwSt 7 % / 19 %, tự viết Kassenbuch, lưu trữ theo 3 thư mục (Bargeld / Rechnungseingang / Rechnungsausgang), báo cáo, khoá sổ tháng và xuất PDF / ZIP / DATEV cho Steuerberater.

- Giao diện: React + Vite, tiếng Việt hoặc tiếng Đức. Giấy tờ xuất ra luôn bằng tiếng Đức.
- Dữ liệu: Supabase (project `hoadon-app`, các bảng có tiền tố `nh_`, bucket `nh-belege`). Phân quyền Chủ / Người phụ trách / Nhân viên nằm trong cơ sở dữ liệu (RLS), khoá sổ do trigger bảo vệ.
- Đọc chứng từ chạy ngay trên thiết bị (Tesseract, pdf.js), đọc thẳng E-Rechnung (XRechnung / ZUGFeRD).
- Hàm `supabase/functions/nh-admin`: tạo tài khoản người phụ trách / nhân viên.

## Chạy thử
```
npm install
npm run dev
```

## Kiểm tra
```
npx tsx tests/db.mts        # phân quyền, khoá sổ, Kassenbuch (PostgreSQL cục bộ)
npx tsx tests/ocr-zbon.mts  # đọc 2 Z-Bon mẫu
```

## Lưu ý
Định khoản SKR03 và file DATEV (EXTF Buchungsstapel) nên được Steuerberater thử nhập và xác nhận số tài khoản trước khi dùng thật.
