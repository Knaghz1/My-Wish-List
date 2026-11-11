# My Wish List

Wishlist cho hai người. Gồm trang tĩnh (`index.html` + `fonts/`) và một Vercel Function (`api/state.js`). Dữ liệu lưu trên Upstash Redis.

## Đưa lên Vercel

1. Đẩy thư mục này lên một repo GitHub.
2. Vào vercel.com, chọn **Add New → Project**, import repo vừa tạo. Framework Preset để **Other**, không cần lệnh build. Bấm **Deploy**.
3. Trong project, mở tab **Storage**, chọn **Create Database → Upstash for Redis** (gói Free), rồi bấm **Connect** vào project. Vercel sẽ tự thêm `KV_REST_API_URL` và `KV_REST_API_TOKEN`.
4. Vào **Deployments**, bấm **Redeploy** để các biến mới có hiệu lực.

## Mã phòng

Mỗi cặp đôi dùng một **mã phòng** riêng, dài ít nhất 6 ký tự, không phân biệt hoa thường.

- Người đầu tiên mở link, nhập một mã mới, rồi bấm **Tạo phòng mới**.
- Người còn lại mở cùng link và nhập đúng mã đó.
- Mỗi máy nhập mã một lần và trình duyệt sẽ nhớ luôn. Muốn đổi sang phòng khác thì vào **Đổi tên → Rời phòng**.
- Các phòng hoàn toàn tách biệt. Mã phòng cũng chính là mật khẩu, nên hãy đặt mã khó đoán và chỉ gửi riêng cho người kia.

## Ghi chú

- Mở trực tiếp file `index.html` trên máy thì trang chỉ lưu dữ liệu trên trình duyệt đó.
- Hai máy tự đồng bộ với nhau khoảng mỗi 4 giây.
- Font Livvic dùng giấy phép SIL Open Font License (xem `fonts/OFL.txt`).
