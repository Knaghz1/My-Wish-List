# My Wish List

Wishlist cho hai người. Gồm trang tĩnh (`index.html` + `fonts/`) và một Vercel Function (`api/state.js`). Dữ liệu lưu trên Upstash Redis.

## Đưa lên Vercel

1. Đẩy thư mục này lên một repo GitHub.
2. Vào vercel.com, chọn **Add New → Project**, import repo vừa tạo. Framework Preset để **Other**, không cần lệnh build. Bấm **Deploy**.
3. Trong project, mở tab **Storage**, chọn **Create Database → Upstash for Redis** (gói Free), rồi bấm **Connect** vào project. Vercel sẽ tự thêm `KV_REST_API_URL` và `KV_REST_API_TOKEN`.
4. Vào **Settings → Environment Variables**, thêm biến `WISHLIST_PASSCODE` với giá trị là mã do bạn tự đặt. Hai người dùng chung mã này để mở trang.
5. Vào **Deployments**, bấm **Redeploy** để các biến mới có hiệu lực.

Gửi link `….vercel.app` và mã cho người kia là xong.

## Ghi chú

- Mở trực tiếp file `index.html` trên máy thì trang chỉ lưu dữ liệu trên trình duyệt đó.
- Hai máy tự đồng bộ với nhau khoảng mỗi 4 giây.
- Font Livvic dùng giấy phép SIL Open Font License (xem `fonts/OFL.txt`).
