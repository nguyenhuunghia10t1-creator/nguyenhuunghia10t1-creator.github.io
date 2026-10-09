/**
 * Lời hát đồng bộ với MP3 — chỉ chỉnh tệp này và tệp LRC, không sửa logic.
 * Chỉ điền lời/timestamp được phép sử dụng, đã kiểm tra với đúng bản thu.
 * Tệp LRC UTF-8: [mm:ss.xx]câu được hát; [mm:ss.xx] rỗng để dừng ở nhạc dạo.
 * expectedSourceUrl phải khớp music-config.js. Đổi bài thì thay cả LRC và giá trị này.
 * offsetMs dương: chữ sớm hơn âm thanh; âm: chữ muộn hơn. Cộng với [offset:] LRC.
 * maxDisplayMs chỉ giới hạn thời gian giữ câu nếu thiếu mốc kết thúc, không sửa mốc hát.
 * LRC chưa có câu thật: tự ẩn khu vực; không tạo lời/timestamp thay thế.
 */
export default {
  enabled: true,
  format: 'lrc', // 'lrc' hoặc 'json' ({cues:[{time,text,end}]}), thời gian JSON là giây.
  sourceUrl: './assets/thanh-tan.lrc',
  expectedSourceUrl: './assets/music.mp3',
  offsetMs: 0,
  showNext: true,
  nextPreviewMs: 8000,
  formationMs: 850,
  dissolveMs: 1050,
  maxDisplayMs: 12000,
};
