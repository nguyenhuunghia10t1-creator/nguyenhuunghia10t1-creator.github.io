# Lời hát đồng bộ với MP3

Khu vực lời hát chỉ xuất hiện khi khám phá cây. Nhạc vẫn là cùng một phần tử audio từ khi mở trang; đọc lại thư không tạo hoặc khởi động lại nguồn nhạc.

Bản hiện tại: `assets/thanh-tan.lrc` cho MP3 Thanh Tân — Vương Bình, trong ấn bản ANH BỜ VAI do người quản lý cung cấp. 35 câu giữ nguyên lời được cung cấp; hai dòng tên bài/ca sĩ là metadata. MP3 dài 213,10694 giây, SHA-256 `75453e15718b55194e86c9c581625d393ea2dfb35ac4a6e2d4478b9c5418722c`.

Mốc đầu từng câu được căn từ âm thanh bằng hai lượt nhận dạng small/medium chạy cục bộ và đối chiếu thứ tự từ. Chênh giữa hai lượt có trung vị 0,26 giây, lớn nhất 0,48 giây. Lượt nhận dạng có hallucination và các mốc ép căn sai ở biên cửa sổ đã bị loại. Đây là mốc ước lượng từ âm thanh, chưa phải kết quả nghe soát thủ công để khẳng định chính xác tuyệt đối. Lời bắt đầu ở 21,61 giây, kết thúc ở 185,68 giây; đoạn dạo đầu và cuối được để trống. Timestamp bản lời gửi ban đầu vượt độ dài MP3, nên không được dùng hay co giãn tự động.

## Dữ liệu

Chỉnh `lyrics-config.js` để chọn tệp lời và hiệu chỉnh độ lệch. `expectedSourceUrl` phải khớp `sourceUrl` MP3 trong `music-config.js`; đổi bài cần đổi cả dữ liệu lời tương ứng. Không hiển thị lời của bài cũ cho một nguồn nhạc mới.

Tệp LRC là UTF-8. Mỗi dòng có thời điểm bắt đầu tính từ đầu chính tệp MP3, theo mẫu `[mm:ss.xx]` rồi đến câu được hát. Một câu lặp lại có thể có nhiều timestamp trên cùng dòng. Các tag thông tin như `[ti:...]`, `[ar:...]` không phải câu hát và không được hiển thị.

Đặt một dòng timestamp **không có chữ** tại lúc bắt đầu đoạn dạo, hết câu hoặc kết thúc phần hát để xóa câu trước. Nếu thiếu mốc này, trình phát chỉ có thể suy ra khoảng hiển thị tới câu tiếp theo, trong giới hạn thời lượng tối đa của cấu hình. Không dùng câu giả cho đoạn dạo. Có thể dùng JSON dạng `{cues:[{time,end,text}]}` nếu cần quy định rõ thời điểm hết từng câu; `time` và `end` tính bằng giây.

Không điền lời hoặc mốc ước lượng khi chưa nghe/đối chiếu được bản thu. Dữ liệu nhận dạng tự động cần kiểm tra lại theo chính MP3; timestamp của một bản thu khác có thể lệch.

## Hiệu chỉnh

`offsetMs` dùng mili giây. Giá trị dương đưa lời xuất hiện **sớm hơn**, giá trị âm đưa lời xuất hiện **muộn hơn**. Độ lệch trong tag LRC `[offset:...]` được cộng với `offsetMs`. Chỉ dùng một nơi khi có thể để tránh cộng hai lần.

Phát thử đúng MP3 và tìm một câu có điểm vào giọng rõ. Nếu chữ hiện chậm 200 ms, tăng `offsetMs` thêm 200. Nếu chỉ một câu lệch, sửa timestamp của câu đó. Kiểm tra cả đầu, giữa và cuối bài: một offset chung không sửa được mốc sai riêng từng câu.

Mọi pha tụ, đọc và tan lấy từ `audio.currentTime`. Khi tạm dừng, tiến trình hạt đứng tại cùng vị trí; tắt tiếng không dừng lời. Tua, phát lặp và quay lại tab sẽ chọn lại câu theo thời gian audio hiện tại. Không chạy đồng hồ lời riêng. Chế độ giảm chuyển động giữ chữ rõ và đồng bộ, bỏ hiệu ứng tụ/tan.

## Đưa thay đổi lên website

Chạy local bằng `node scripts/gift-serve.mjs` từ repository rồi mở `/mot-goc-nho/`. Sau khi sửa LRC/cấu hình, kiểm tra lời theo bản thu, commit những tệp công khai cần thiết, push vào nhánh Pages đang dùng, đợi deployment thành công rồi tải lại URL thật. Lưu LRC trên máy chưa cập nhật website.

LRC là tài nguyên công khai của website, giống MP3; không đặt lời nhắn riêng hoặc thông tin mở thư trong đó. Bản nhận dạng, báo cáo kiểm thử và ảnh chứa thư nằm ở `../private`, ngoài repository và ngoài thư mục xuất bản.
