"use client";

import DOMPurify from "dompurify";

type InfoKey = "about" | "privacy" | "terms" | "contact";

const INFO_CONTENT: Record<InfoKey, { title: string; html: string }> = {
  about: {
    title: "About Us",
    html: `
      <h3>Chúng tôi là ai?</h3>
      <p><strong>180ten</strong> là nền tảng luyện thi JLPT miễn phí dành cho người Việt học tiếng Nhật. Chúng tôi được xây dựng bởi những người đã trải qua hành trình tự học JLPT và hiểu rõ những khó khăn mà học viên Việt Nam gặp phải.</p>
      <h3>Sứ mệnh</h3>
      <p>Mang đến trải nghiệm luyện thi JLPT chất lượng cao, với đề thi chuẩn format, giải thích chi tiết bằng tiếng Việt và hệ thống theo dõi tiến độ thông minh — hoàn toàn miễn phí cho mọi học viên.</p>
      <h3>Tính năng nổi bật</h3>
      <p>📝 Đề thi mô phỏng JLPT N1–N5 và BJT chuẩn format chính thức.</p>
      <p>📊 Dashboard theo dõi tiến độ, biểu đồ lịch sử, phân tích điểm mạnh – yếu.</p>
      <p>🇻🇳 Giải thích từng câu bằng tiếng Việt, từ vựng và ngữ pháp liên quan.</p>
      <p>🃏 Flashcard SRS (Spaced Repetition System) giúp ghi nhớ từ vựng hiệu quả lâu dài.</p>
      <h3>Liên hệ</h3>
      <p>Bạn có câu hỏi hoặc góp ý? Hãy gửi email cho chúng tôi tại <a href="mailto:hello@180ten.com">hello@180ten.com</a>.</p>
    `,
  },
  privacy: {
    title: "Privacy Policy",
    html: `
      <p><em>Cập nhật lần cuối: tháng 4 năm 2025</em></p>
      <h3>1. Thông tin chúng tôi thu thập</h3>
      <p>Khi bạn tạo tài khoản, chúng tôi thu thập địa chỉ email và tên hiển thị của bạn. Trong quá trình sử dụng, chúng tôi lưu lịch sử làm bài, điểm số và tiến độ học tập của bạn trên hệ thống của chúng tôi (Supabase).</p>
      <h3>2. Cách chúng tôi sử dụng thông tin</h3>
      <p>Thông tin của bạn được sử dụng để cung cấp và cải thiện dịch vụ, cá nhân hoá trải nghiệm học tập và gửi thông báo liên quan đến tài khoản khi cần thiết. Chúng tôi không bán dữ liệu của bạn cho bên thứ ba.</p>
      <h3>3. Cookie và dữ liệu cục bộ</h3>
      <p>Chúng tôi sử dụng localStorage để lưu trữ lịch sử làm bài trên thiết bị của bạn khi không đăng nhập. Dữ liệu này chỉ tồn tại trên máy bạn và không được gửi lên máy chủ.</p>
      <h3>4. Bảo mật</h3>
      <p>Chúng tôi áp dụng các biện pháp bảo mật tiêu chuẩn ngành để bảo vệ thông tin của bạn. Mật khẩu được mã hoá và không được lưu ở dạng văn bản thô.</p>
      <h3>5. Quyền của bạn</h3>
      <p>Bạn có quyền truy cập, chỉnh sửa hoặc xoá dữ liệu cá nhân của mình bất kỳ lúc nào bằng cách liên hệ với chúng tôi qua email <a href="mailto:hello@180ten.com">hello@180ten.com</a>.</p>
      <h3>6. Liên hệ</h3>
      <p>Nếu bạn có câu hỏi về chính sách bảo mật này, vui lòng liên hệ: <a href="mailto:hello@180ten.com">hello@180ten.com</a></p>
    `,
  },
  terms: {
    title: "Terms & Conditions",
    html: `
      <p><em>Cập nhật lần cuối: tháng 4 năm 2025</em></p>
      <h3>1. Chấp nhận điều khoản</h3>
      <p>Bằng cách sử dụng 180ten, bạn đồng ý với các điều khoản và điều kiện này. Nếu bạn không đồng ý, vui lòng không sử dụng dịch vụ.</p>
      <h3>2. Tài khoản người dùng</h3>
      <p>Bạn chịu trách nhiệm bảo mật thông tin đăng nhập của mình. Bạn không được chia sẻ tài khoản với người khác hoặc sử dụng tài khoản của người khác.</p>
      <h3>3. Sử dụng dịch vụ</h3>
      <p>Bạn đồng ý sử dụng dịch vụ chỉ cho mục đích học tập cá nhân, hợp pháp. Nghiêm cấm sao chép, phân phối hoặc bán nội dung từ 180ten mà không có sự đồng ý bằng văn bản của chúng tôi.</p>
      <h3>4. Nội dung và sở hữu trí tuệ</h3>
      <p>Tất cả nội dung trên 180ten — bao gồm đề thi, từ vựng, giải thích — là tài sản của 180ten hoặc được cấp phép hợp lệ. Bạn không được tái sử dụng nội dung này cho mục đích thương mại.</p>
      <h3>5. Gói Premium</h3>
      <p>Các tính năng Premium yêu cầu thanh toán. Chúng tôi không hoàn tiền sau khi gói đã được kích hoạt trừ khi có lỗi kỹ thuật từ phía chúng tôi.</p>
      <h3>6. Thay đổi điều khoản</h3>
      <p>Chúng tôi có thể cập nhật điều khoản này bất kỳ lúc nào. Thay đổi sẽ có hiệu lực ngay khi được đăng tải. Việc tiếp tục sử dụng dịch vụ đồng nghĩa với việc bạn chấp nhận điều khoản mới.</p>
    `,
  },
  contact: {
    title: "Contact",
    html: `
      <h3>Liên hệ với chúng tôi</h3>
      <p>Chúng tôi luôn sẵn sàng lắng nghe phản hồi, câu hỏi và góp ý từ cộng đồng học viên. Hãy liên hệ qua các kênh dưới đây:</p>
      <div class="contact-grid">
        <div class="contact-item"><div class="ci-label">Email hỗ trợ</div><div class="ci-val"><a href="mailto:hello@180ten.com">hello@180ten.com</a></div></div>
        <div class="contact-item"><div class="ci-label">Phản hồi &amp; Bug</div><div class="ci-val"><a href="mailto:bugs@180ten.com">bugs@180ten.com</a></div></div>
        <div class="contact-item"><div class="ci-label">Facebook</div><div class="ci-val"><a href="https://facebook.com/180ten" target="_blank" rel="noopener noreferrer">facebook.com/180ten</a></div></div>
        <div class="contact-item"><div class="ci-label">Thời gian phản hồi</div><div class="ci-val">Trong vòng 24–48 giờ</div></div>
      </div>
      <h3>Góp ý tính năng</h3>
      <p>Bạn có ý tưởng cho tính năng mới? Chúng tôi rất muốn nghe! Gửi email mô tả ý tưởng của bạn đến <a href="mailto:hello@180ten.com">hello@180ten.com</a> với tiêu đề <strong>[Góp ý tính năng]</strong>.</p>
      <h3>Báo lỗi đề thi</h3>
      <p>Nếu bạn phát hiện câu hỏi sai hoặc giải thích chưa chính xác, hãy gửi phản hồi về <a href="mailto:bugs@180ten.com">bugs@180ten.com</a> kèm tên đề thi và số câu hỏi.</p>
    `,
  },
};

interface InfoModalProps {
  open: boolean;
  infoKey: InfoKey | null;
  onClose: () => void;
}

export default function InfoModal({ open, infoKey, onClose }: InfoModalProps) {
  if (!open || !infoKey) return null;
  const content = INFO_CONTENT[infoKey];
  const safeHtml = typeof window !== "undefined" ? DOMPurify.sanitize(content.html) : "";
  return (
    <div
      id="info-modal-overlay"
      className="modal-overlay show"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: "var(--white)", borderRadius: "var(--r2)", width: "92%",
        maxWidth: "680px", maxHeight: "85vh", overflowY: "auto",
        padding: "28px", boxShadow: "var(--shadow2)"
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "18px" }}>
          <div id="info-modal-title" style={{ fontSize: "18px", fontWeight: 800 }}>{content.title}</div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", fontSize: "20px", cursor: "pointer", color: "var(--muted)" }}>×</button>
        </div>
        <div
          id="info-modal-body"
          className="info-modal-body"
          dangerouslySetInnerHTML={{ __html: safeHtml }}
        />
      </div>
    </div>
  );
}
