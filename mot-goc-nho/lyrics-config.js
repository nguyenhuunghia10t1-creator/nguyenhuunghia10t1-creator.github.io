/**
 * Lời hát đồng bộ từng âm tiết với MP3 — chỉnh cấu hình và JSON, không sửa logic.
 * lyrics.txt là lời gốc; JSON giữ các mốc tự động và cờ needsReview để nghe kiểm tra.
 * start/end null: tiếng hát đệm chưa có mốc, không tự chia đều hoặc đoán giờ.
 * expectedSourceUrl phải khớp music-config.js. Đổi bài thì thay JSON và giá trị này.
 * offsetMs dương: chữ sớm hơn âm thanh; âm: chữ muộn hơn. Cộng với offsetSeconds trong JSON.
 * maxDisplayMs chỉ dùng nếu chuyển lại bộ đọc LRC cũ, không sửa mốc âm tiết.
 * Dữ liệu hỏng hoặc không khớp nguồn: tự ẩn khu vực, không tạo mốc thay thế.
 */
export default {
  enabled: true,
  format: 'words', // JSON với mốc riêng cho từng âm tiết, tính bằng giây.
  sourceUrl: './assets/thanh-tan.words.json',
  expectedSourceUrl: './assets/music.mp3',
  offsetMs: 0,
  showNext: false,
  wordRevealMs: 110,
  crossfadeMs: 180,
  lineHoldMs: 900,
  maxDisplayMs: 12000,
};
