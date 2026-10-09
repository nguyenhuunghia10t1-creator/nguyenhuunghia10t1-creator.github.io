# Một góc nhỏ gửi em — hướng dẫn riêng cho người quản lý mã nguồn

Trang tĩnh độc lập ở `/mot-goc-nho/`. Không đưa đường dẫn vào trang chủ, menu hoặc sitemap. Không thay `CNAME`, DNS hoặc cơ chế GitHub Pages đang hoạt động.

## Chạy local

Cần Node.js 22 trở lên. Từ thư mục repository:

```powershell
node scripts/gift-serve.mjs
```

Mở `http://127.0.0.1:4173/mot-goc-nho/`. Server chỉ phục vụ repository, không phục vụ thư mục cha. Dùng localhost hoặc HTTPS để Web Crypto hoạt động. Không mở `index.html` bằng `file://`.

## Sửa thư và đổi thông tin mở

Đặt tệp riêng trong thư mục `../private`, **ngoài repository và ngoài thư mục web**:

- `letter.txt`: nội dung nguyên văn UTF-8; dòng trống ngăn các đoạn.
- `credentials.json`: thông tin mở thư do công cụ sinh. Không đưa tệp này vào Git.
- Ảnh chụp thư, trace và báo cáo có nội dung riêng cũng phải nằm ngoài repository.

Khởi tạo một lần (chỉ khi chưa có credentials.json):

```powershell
node scripts/gift-tools.mjs init --private-dir ../private
```

Sau khi sửa bản riêng `letter.txt`, mã hóa lại bằng thông tin hiện có:

```powershell
node scripts/gift-tools.mjs encrypt --private-dir ../private
node scripts/gift-tools.mjs verify --private-dir ../private
```

Đổi mật khẩu, giữ định danh thư:

```powershell
node scripts/gift-tools.mjs rekey --private-dir ../private
node scripts/gift-tools.mjs verify --private-dir ../private
```

`rekey` lưu thông tin trước đó vào `credentials.previous.json` tại thư mục riêng để khôi phục nếu cần. Không gửi mật khẩu bằng tham số dòng lệnh hoặc dán vào source. `init` và `rekey` tạo mật khẩu 20 ký tự ngẫu nhiên Crockford Base32, chia thành bốn nhóm năm ký tự. Nếu chủ trang tự chọn tài khoản/mật khẩu, sao lưu hai tệp riêng trước, sửa `account` và `password` trong `../private/credentials.json`, rồi chạy `encrypt` và `verify`; công cụ nhận mật khẩu từ 8 ký tự sau chuẩn hóa. Mật khẩu số ngắn dễ đoán hơn mật khẩu ngẫu nhiên, dù giữ nguyên thông số mã hóa. Không ghi giá trị thật vào tài liệu công khai.

Gõ có/không dấu gạch nối, khoảng trắng khi dán và chữ thường đều được chuẩn hóa giống nhau; không đổi chữ O thành số 0 hoặc chữ I thành số 1. Tài khoản bỏ khoảng trắng hai đầu và không phân biệt hoa/thường. Định danh thư không phải bí mật bảo mật; tên người nhận hiển thị công khai do chủ trang chọn. Mật khẩu và bản rõ luôn ở ngoài repository.

AES-256-GCM sử dụng PBKDF2-SHA-256 600.000 vòng, salt 16 byte và IV 12 byte mới cho mỗi lần mã hóa. Định danh thư được xác thực cùng bản mã. Bản công khai duy nhất của nội dung là `letter.enc.json`; không lưu khóa/mật khẩu/nội dung vào URL, storage hoặc analytics. Khóa không được xuất ra tệp.

## Đổi nhạc

Chỉnh `music-config.js` (có hướng dẫn tiếng Việt ngay đầu tệp). Cấu hình này công khai, không chứa bí mật.

```js
// File trong thư mục assets của trang:
sourceType: 'mp3',
sourceUrl: './assets/music.mp3',

// MP3 trực tiếp qua HTTPS:
sourceType: 'mp3',
sourceUrl: 'https://example.com/music/bai-hat.mp3',

// Video YouTube cho phép nhúng, thay VIDEO_ID bằng mã thật:
sourceType: 'youtube',
sourceUrl: 'https://www.youtube.com/watch?v=VIDEO_ID',
// Hoặc: 'https://youtu.be/VIDEO_ID'
```

Đổi `title` tùy ý hoặc để rỗng; `volume` từ 0 đến 1; `loop` là true/false. `enabled:false` tắt tính năng, `sourceUrl:''` ẩn bộ điều khiển và không tải nguồn. Link xem trước/chia sẻ của dịch vụ lưu trữ không phải MP3 trực tiếp. Điện thoại có thể chỉ hỗ trợ âm lượng hệ thống. Autoplay phụ thuộc trình duyệt; nếu bị chặn, thao tác Mở thư hoặc Bật nhạc sẽ thử phát. Người đã tạm dừng/tắt tiếng không bị tự bật lại khi chuyển màn.

YouTube dùng player chính thức, hiển thị tối thiểu 200×200, tạm dừng khi tab hoặc player không còn hiển thị phù hợp. YouTube có kết nối đến dịch vụ bên thứ ba và chính sách riêng; không thể tuyên bố không có theo dõi từ bên thứ ba. MP3 nội bộ không tải dịch vụ nhạc bên ngoài. Website không thêm analytics của ứng dụng.

## Lời hát trong chế độ khám phá

`lyrics-config.js` chọn JSON có mốc từng âm tiết và `offsetMs`; `LYRICS.md` ghi cách căn từ MP3 và các cờ cần nghe kiểm tra. Lời chỉ hiện trong chế độ khám phá; chữ HTML giữ sẵn vị trí câu và lớp bụi/cánh hoa tùy chọn trong `lyric-effects.js`. Mọi pha chữ và chuyển câu lấy từ `audio.currentTime` của cùng MP3. Tạm dừng giữ nguyên chữ; tua, lặp, đổi tốc độ chọn lại theo audio. Đọc lại thư ẩn lời hát, chạy hiệu ứng thư từ đầu và không khởi động lại MP3.

## Kiểm tra và xuất bản thay đổi

```powershell
npm.cmd run test:gift
node scripts/gift-tools.mjs verify --private-dir ../private
node scripts/audit-gift.mjs --private-dir ../private
git diff --stat
git status --short
```

Kiểm tra staged files trước commit. Chỉ đưa mã, bản mã và tài nguyên công khai lên Git; không thêm tệp riêng, screenshot/trace hoặc source map. Không cần chạy lại script build website doanh nghiệp khi chỉ sửa khu vực này.

Để người nhận thấy thư/bài nhạc mới: commit các tệp thay đổi, push tới nhánh đang được Pages sử dụng, đợi workflow Pages hoàn thành rồi kiểm tra URL thật bằng tải lại. **Lưu tệp trên máy chưa cập nhật website.** Trước mỗi lần triển khai, xác minh lại Pages Settings hoặc API: nhánh, thư mục nguồn và workflow; không suy luận chỉ từ nhánh mặc định. Lúc tạo trang này, API đã xác nhận nguồn `main` + `/`, kiểu `legacy`, workflow động `pages-build-deployment`.

Khôi phục bằng `git revert` commit cần bỏ và push bình thường. Không force-push hoặc xóa lịch sử.

## Giới hạn riêng tư

Đây là bảo vệ nội dung bằng mật khẩu ở trình duyệt, không phải tài khoản được xác thực bởi máy chủ. Mọi tài nguyên public, gồm MP3 và bản mã, vẫn tải được. Người biết mật khẩu có thể chia sẻ nội dung. `noindex` không kiểm soát quyền truy cập. Đổi mật khẩu không thu hồi bản rõ đã được chia sẻ hoặc bản mã cũ còn trong lịch sử Git. GitHub Pages có chính sách ghi nhận dữ liệu hạ tầng riêng.

## Giao diện và hiệu ứng

`scene.js` tạo cây bằng BufferGeometry và shader: tán hồng/magenta nhiều lớp, nhánh cyan, quầng sáng mềm và các cánh hoa gần/xa. Hình tham chiếu không được dùng làm nền phẳng. `style.css` giữ không gian đêm tối, bố cục mở thư và chế độ đọc toàn bộ không có khung card.

Trong cả hai chế độ đọc, desktop đặt chữ bên trái và cây bên phải; điện thoại dành vùng dưới cây cho toàn bộ câu, kể cả câu dài. Chữ trắng ngà có bóng tối mảnh sát nét chữ, không phủ tối hoặc làm mờ cả cảnh. Khi đọc hiệu ứng, có thể kéo/xoay, chụm và zoom ngay trên cảnh xuyên qua lớp chữ; các nút và bản đọc toàn bộ vẫn nhận thao tác riêng. Nút ↺ đưa về góc nhìn ban đầu. Các vệt sao băng và cánh hoa tiếp tục chuyển động. Trang tôn trọng `prefers-reduced-motion` của hệ điều hành; không còn nút giảm chuyển động trên giao diện.

Trong chế độ khám phá, camera đi liên tục theo chiều kim đồng hồ quanh điểm neo lệch thân cây, không quay nhóm cây để giả chuyển động camera. Chu kỳ mặc định 180 giây/vòng trong `scene.js` (`orbitPeriodSeconds`); không giới hạn góc phương vị và không phụ thuộc lyric tải thành công. Phép chiếu lệch trục giữ bố cục thoáng qua cả vòng quay. Kéo/chụm/zoom hủy chuyển cảnh và dừng auto ngay; sau 2 giây không thao tác, tốc độ tăng mềm trong 1,4 giây từ vị trí hiện tại, không reset góc. Tab ẩn hoặc giảm chuyển động sẽ dừng auto. Camera là chuyển động nền của chế độ khám phá; tạm dừng MP3 vẫn giữ đúng chữ/hạt lyric theo thời gian âm thanh. Người xem có thể tự xoay/zoom đến bố cục khác; nút ↺ luôn phục hồi góc nhìn ban đầu.

Trên điện thoại, ẩn lời hướng dẫn kéo/chụm để không phủ lên thân cây. Cảnh dành riêng vùng trời cho lyric và phần dưới cho điều khiển, tính theo kích thước thực tế của các vùng này. Khi Chrome co giãn thanh địa chỉ hoặc chiều cao vùng nhạc thay đổi, giữ góc quay hiện tại và cập nhật vùng an toàn; sự kiện resize không đổi kích thước sẽ không đưa camera về đầu. Chuyển sang câu hát đầu tiên sau nhạc dạo cũng giữ cùng vùng dành cho lyric.

`particle-letter.js` chỉ nhận nội dung sau khi giải mã trong bộ nhớ. Font Noto Serif có bộ ký tự tiếng Việt được lưu ở `assets/fonts/` và khai báo trong `fonts.css`; không tải Google Fonts khi khách mở trang. Hiệu ứng chờ font sẵn sàng trước khi đo chữ. Các cụm grapheme giữ chữ cái và dấu đi cùng nhau; chuỗi dùng để vẽ được chuẩn hóa NFC, bản gốc và nội dung mã hóa giữ nguyên. Pha đọc dùng chữ HTML thật và hạt đã tắt hoàn toàn để không làm vỡ nét.

Mỗi câu tụ thành từ hạt, giữ rõ khoảng 3 giây rồi tan xuống thành cánh hoa. Cảnh cây tiếp tục sáng và chuyển động; không phủ lớp tối hoặc blur khi đọc. Kết thúc sequence chuyển sang khám phá. “Đọc lại thư” luôn chạy từ câu đầu, không tự mở bản chữ tĩnh. “Hiện toàn bộ” chỉ là chế độ đọc phụ được người xem chọn: cây chuyển sang bên phải trên desktop hoặc phía trên trên điện thoại, để chữ không chồng lên tán sáng. Không lưu bản rõ vào tệp, storage hoặc log; mọi thay đổi màn giữ cùng một nguồn nhạc.

Chữ dùng sprite hạt/cánh hoa đã tạo sẵn, giới hạn mật độ và DPR; điện thoại vẽ tối đa 30 khung/giây, thiết bị chậm tự giảm lượng hạt. Khi tab ẩn, chuyển động được tạm dừng. Chế độ giảm chuyển động vẫn lần lượt đọc từng câu trong 3 giây, nhưng bỏ chuyển động tụ/tan hạt; đọc lại vẫn bắt đầu từ câu đầu. Nếu không tạo được canvas chữ hoặc không tải được font, thư chuyển sang bản đọc toàn bộ. Cảnh 3D vẫn có fallback tĩnh độc lập.

Mặt nạ chữ được lấy mẫu ở độ phân giải gấp đôi, với các hạt bụi nhỏ chuyển động riêng quanh cùng cụm chữ–dấu. Lõi hạt khoảng 0,65–1,15 px; các cánh hoa nhỏ xuất hiện thưa khi tan. Mỗi vùng chữ giới hạn 5.000 hạt ở chiều rộng điện thoại hoặc 9.000 hạt ở vùng rộng; pha tan kéo dài 2,6 giây, pha đọc rõ vẫn giữ 3 giây.

Hiệu ứng nền dùng buffer tái sử dụng: hoa được thả liên tục theo ba lớp xa, trong tán và gần máy quay, với gió ngang và tốc độ xoay khác nhau. Nhịp cơ bản khoảng 0,30 giây/cánh khi đọc và 0,19 giây/cánh khi khám phá; thiết bị hạn chế giảm mật độ. Chỉ cánh hoa đi vào vùng chữ được làm dịu bằng shader, không có lớp phủ lên cảnh. Sao băng có đầu–đuôi mờ mềm, nhiều độ sâu và lịch xuất hiện ngắn hơn; đường bay tránh vùng chữ, nút và tán cây. Cả hai hiệu ứng dừng khi bật giảm chuyển động và khi tab ẩn.

## Thư viện và quyền riêng tư khi kiểm tra

Three.js 0.186.1 và OrbitControls được lưu cùng trang dưới `vendor`; giấy phép MIT đi kèm. Noto Serif dùng SIL Open Font License; nguồn và giấy phép có trong `assets/fonts/`. Không dùng CDN lúc chạy, framework UI, bộ theo dõi hoặc backend. Kiểm thử trình duyệt và ảnh riêng không nằm trong repository.
