# Quy tắc cho app nhà hàng

- Mọi chỗ tải ảnh hoặc file lên đều phải kéo thả được (máy tính). Dùng `dropProps` trong `src/lib/drop.ts` trên `<label>` bọc `<input type="file" hidden>`, thêm class `drop` và `<span className="drop-hint">` khi là nút. Nếu chỉ nhận ảnh thì lọc `type.startsWith('image/')` và báo khi thả sai loại file.
