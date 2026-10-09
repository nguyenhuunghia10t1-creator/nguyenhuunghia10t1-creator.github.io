// CHỖ ĐỔI NHẠC — chỉ sửa các giá trị bên dưới, không cần sửa music.js.
// Tệp này là cấu hình CÔNG KHAI: không đặt mật khẩu hoặc thông tin riêng ở đây.
//
// MP3 trong dự án:
//   sourceType: 'mp3', sourceUrl: './assets/music.mp3'
//   Chép bài mới vào thư mục assets, rồi đổi đường dẫn nếu tên tệp khác.
// MP3 từ một máy chủ khác:
//   sourceType: 'mp3', sourceUrl: 'https://example.com/music/bai-hat.mp3'
//   Phải là đường dẫn HTTPS phát/tải trực tiếp tệp âm thanh; link chia sẻ,
//   trang xem trước Google Drive/Dropbox/OneDrive không phải link MP3 trực tiếp.
// YouTube:
//   sourceType: 'youtube', sourceUrl: 'https://www.youtube.com/watch?v=VIDEO_ID'
//   Hoặc sourceUrl: 'https://youtu.be/VIDEO_ID' (thay VIDEO_ID bằng mã video thật).
//   Video phải cho phép nhúng. Player luôn có vùng hiển thị riêng; khi trang
//   hoặc player không còn hiển thị phù hợp, nhạc YouTube sẽ tạm dừng.
//   YouTube kết nối dịch vụ bên thứ ba và áp dụng chính sách riêng của họ.
//
// Chưa chọn bài: để sourceUrl: ''. Trang vẫn hoạt động và ẩn cụm nhạc.
// Tắt hoàn toàn: enabled: false. Không có ô thay link dành cho khách xem.
// volume: từ 0 đến 1; 0.25 = 25%. Một số điện thoại dùng âm lượng hệ thống.
// loop: true để lặp. Khoảng nghỉ giữa hai vòng còn phụ thuộc tệp/nguồn phát.
//
// ĐỂ NGƯỜI NHẬN NGHE BÀI MỚI: sửa tệp này, thêm tệp MP3 nếu có, commit và
// push lên repository; đợi GitHub Pages triển khai xong rồi kiểm tra URL thật.
// Chỉ sửa hoặc lưu tệp trên máy chưa làm thay đổi website đã triển khai.
export const musicConfig = Object.freeze({
  enabled: true,
  sourceType: 'mp3',
  sourceUrl: './assets/music.mp3',
  title: 'Thanh Tân',
  volume: 0.25,
  loop: true,
});

export default musicConfig;
