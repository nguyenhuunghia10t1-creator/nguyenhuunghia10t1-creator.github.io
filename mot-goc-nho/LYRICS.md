# Lời hát theo từng âm tiết

`assets/lyrics.txt` giữ nguyên lời được cung cấp. `assets/thanh-tan.words.json` là dữ liệu đang dùng: 38 câu, 397 âm tiết lời chính có `start`/`end` tính bằng giây từ đầu MP3. Không chia đều thời gian của câu để tạo mốc từ.

MP3 Thanh Tân — Vương Bình, ấn bản ANH BỜ VAI, dài 213,106939 giây; SHA-256 `75453e15718b55194e86c9c581625d393ea2dfb35ac4a6e2d4478b9c5418722c`. Bản trên website và bản được gửi có cùng byte. MP3, cấu hình nhạc, bản mã thư và các hiệu ứng cây/thư giữ nguyên.

## Cách tạo mốc

1. Tách giọng bằng Demucs 4.0.1, mô hình `htdemucs`, chỉ dùng làm đầu vào phân tích.
2. Dùng `stable-ts 2.19.1` / OpenAI Whisper `small` căn chỉnh lời đã biết bằng attention/DTW. Cửa sổ câu lấy từ LRC đã căn theo cùng MP3.
3. Điều chỉnh khoảng im lặng trên giọng đã tách (`q_levels=100`, `k_size=3`, `min_word_dur=0.08`).
4. Đối chiếu với căn chỉnh CTC Viterbi bằng `nguyenvulebinh/wav2vec2-base-vietnamese-250h`, revision `69e9000591623e5a4fc2f502407860bcdc0de0b2`, ở cả bản gốc và giọng đã tách.

Chênh mốc bắt đầu giữa DTW và CTC có trung vị 93 ms, phân vị 95 là 363 ms. Đây là độ thống nhất giữa hai thuật toán, **không phải sai số đã đo so với người nghe**. Dữ liệu tự động chưa được nghe soát từng từ; `humanListeningVerified` và `reviewIsComplete` là `false`.

220 âm tiết lời chính được gắn `needsReview: true` do điểm âm học/nhận dạng thấp, hai cách căn lệch hơn 180 ms hoặc âm tiết ngân dài. `score` là điểm CTC, `whisperScore` là điểm Whisper; không phải xác suất chính xác đã hiệu chuẩn. `ctcStart`, `ctcEnd`, `alignmentDifference` và `reviewReasons` giữ bằng chứng để hiệu chỉnh.

19 âm tiết thuộc bốn cụm `(Hah-ah...)` giữ nguyên trong nguồn nhưng có `start: null`, `end: null` và cờ kiểm tra. Tiếng hát đệm có thể chồng lên lời chính; chưa có mốc đáng tin cậy nên bộ hiển thị bỏ qua, không tự đoán hoặc chia đều. Sau khi nghe và gán mốc, có thể thiết kế dữ liệu lớp hát đệm riêng nếu chúng chồng thời gian lên lời chính.

## Chữ và bụi sáng

`lyrics.js` giữ chữ HTML Noto Serif để nét chữ và dấu tiếng Việt luôn rõ. Mỗi âm tiết vẫn bắt đầu đúng mốc trong JSON, hiện trong 110 ms; không đưa âm tiết tiếp theo lên trước hoặc kéo giãn timestamp để chờ hiệu ứng. Vị trí toàn câu được giữ sẵn để tránh xô chữ. Âm tiết đang hát có ánh sáng trắng ngà pha hồng rất nhẹ; chữ đã hát giữ màu ngà dịu.

`lyric-effects.js` là lớp Canvas2D tùy chọn, tải độc lập. Bụi sáng nhỏ tụ quanh từng âm tiết từ chính mốc bắt đầu; khi chuyển câu, các hạt từ nét chữ tách ra, trôi xuống cùng vài cánh hoa xoay nhẹ. Canvas trong suốt nằm trong vùng trời dành cho lời hát, không có card, lớp phủ tối hoặc blur cây. Các mặt nạ lấy mẫu từ toàn âm tiết đã được font định hình và chuẩn hóa NFC, giữ dấu tiếng Việt cùng chữ. Mặt nạ được cache và giới hạn số lượng; mật độ thấp hơn trên điện thoại và thiết bị hạn chế.

Mọi vị trí hạt, ánh sáng, tiến trình chữ và chuyển câu đều được tính từ `audio.currentTime` của cùng phần tử nhạc. RAF chỉ lên lịch đọc vị trí audio, không có đồng hồ hoặc nội suy media time độc lập. Tạm dừng giữ nguyên cả chữ lẫn hạt; tua, lặp, đổi tốc độ và trở lại tab dựng lại đúng trạng thái theo audio. Giảm chuyển động giữ từng âm tiết đồng bộ, bỏ bụi sáng và dịch chuyển. Nếu hiệu ứng, canvas hoặc font không sẵn sàng, lời HTML vẫn hoạt động.

Lời chỉ hiện ở chế độ khám phá sau phần thư. Đọc lại thư ẩn lyric nhưng không thay hoặc khởi động lại MP3. Âm tiết chưa đến mốc giữ opacity 0; không hiện câu tiếp theo trước khi hát. Đuôi bụi của câu trước có thể tiếp tục trôi ngắn sau khi chữ đã mất; đoạn nhạc dạo không có câu giả. Nguồn MP3 phải khớp `expectedSourceUrl` trong `lyrics-config.js`.

## Hiệu chỉnh

`offsetMs` dương đưa lời xuất hiện sớm hơn, âm đưa lời muộn hơn. Chỉ dùng offset chung khi toàn bài lệch đều. Một âm tiết sai riêng cần sửa `start`/`end` trong JSON; không sửa lời hoặc tự co giãn toàn bài.

Mốc lời chính phải theo thứ tự tăng, `end > start`, không vượt thời lượng MP3. Bộ đọc từ chối timestamp hỏng. Sau khi nghe sửa, cập nhật cờ/lý do tương ứng. Không đổi `humanListeningVerified` thành `true` chỉ vì kiểm thử JavaScript đạt.

Chạy `npm run test:gift` để kiểm tra parser, timeline, nhạc và mã hóa. Kiểm thử trình duyệt cần phát đúng MP3, kiểm tra trước/sau mốc từ, pause, seek, tốc độ, lặp, giảm chuyển động, chuyển câu và câu dài trên điện thoại. Ảnh/trace và dữ liệu phân tích không nằm trong thư mục xuất bản.

Xuất bản qua nhánh/thư mục Pages hiện được xác minh từ workflow. LRC cũ vẫn được giữ làm tài liệu căn câu, không còn là dữ liệu hiển thị mặc định.

Nguồn công cụ: [stable-ts](https://github.com/jianfch/stable-ts), [Demucs](https://github.com/facebookresearch/demucs), [mô hình CTC tiếng Việt](https://huggingface.co/nguyenvulebinh/wav2vec2-base-vietnamese-250h).
