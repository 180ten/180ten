"use client";
import Image from "next/image";
import type { TabId } from "@/components/Nav";

interface HomeTabProps {
  onSwitchTab: (tab: TabId) => void;
  onOpenInfoModal: (key: "about" | "privacy" | "terms" | "contact") => void;
  hsUsers: string;
  hsExams: string;
}

export default function HomeTab({ onSwitchTab, onOpenInfoModal, hsUsers, hsExams }: HomeTabProps) {
  return (
    <div id="tab-home" className="tab-pane active" style={{ display: "flex", flexDirection: "column" }}>
      <div className="hero">
        <div className="hero-grid">
          <div className="hero-content">
            <h1>Luyện thi JLPT<br/>theo cách <em>thú vị</em>.</h1>
            <p>Đề thi mô phỏng chuẩn format, giải thích từng câu bằng tiếng Việt, theo dõi tiến độ mỗi ngày.</p>
            <div className="hero-cta">
              <button className="btn-primary" onClick={() => onSwitchTab("mocktest")}>
                <Image className="hero-btn-icon" src="/svg/exam-start.svg" alt="" aria-hidden width={18} height={18} />
                Vào thi ngay
              </button>
              <button className="btn-secondary" onClick={() => onSwitchTab("anki")}>
                <Image className="hero-btn-icon" src="/svg/vocab-review.svg" alt="" aria-hidden width={18} height={18} />
                Ôn từ vựng ngay
              </button>
            </div>
          </div>
          <div className="hero-mascot">
            <Image
              src="/images/hero-mascot-v3.svg"
              alt="180ten mascot — chim cánh cụt đọc sách JLPT"
              width={520}
              height={430}
              priority
              draggable={false}
              style={{ width: "100%", height: "auto", maxWidth: 520, display: "block" }}
            />
          </div>
        </div>
        <div className="hero-stats">
          <div className="stat-item">
            <div className="stat-icon c-students">
              <Image src="/svg/students.svg" alt="" aria-hidden width={22} height={22} />
            </div>
            <div className="stat-text">
              <div className="num" id="hs-users">{hsUsers}</div>
              <div className="label">Học viên</div>
            </div>
          </div>
          <div className="stat-item">
            <div className="stat-icon c-document">
              <Image src="/svg/document.svg" alt="" aria-hidden width={22} height={22} />
            </div>
            <div className="stat-text">
              <div className="num" id="hs-exams">{hsExams}</div>
              <div className="label">Đề thi</div>
            </div>
          </div>
          <div className="stat-item">
            <div className="stat-icon c-level">
              <Image src="/svg/practice-hours.svg" alt="" aria-hidden width={22} height={22} />
            </div>
            <div className="stat-text">
              <div className="num" style={{ whiteSpace: "nowrap" }}>10,000+</div>
              <div className="label">Giờ luyện tập</div>
            </div>
          </div>
          <div className="stat-item">
            <div className="stat-icon c-gift">
              <Image src="/svg/satisfaction.svg" alt="" aria-hidden width={22} height={22} />
            </div>
            <div className="stat-text">
              <div className="num">98%</div>
              <div className="label">Tỷ lệ hài lòng</div>
            </div>
          </div>
        </div>
      </div>
      <div className="features-section">
        <div className="features-grid">
          <div className="feature-card">
            <div className="feat-icon" style={{ background: "#e8eefc" }}>
              <Image src="/svg/exam-sim.svg" alt="" aria-hidden width={36} height={36} />
            </div>
            <h3>Đề thi mô phỏng</h3>
            <p>Format chuẩn JLPT, đầy đủ ngữ pháp, từ vựng, đọc hiểu và nghe hiểu.</p>
            <span className="feature-card-arrow" aria-hidden>›</span>
          </div>
          <div className="feature-card">
            <div className="feat-icon" style={{ background: "#fff4e0" }}>
              <Image src="/svg/progress-chart.svg" alt="" aria-hidden width={36} height={36} />
            </div>
            <h3>Theo dõi tiến độ</h3>
            <p>Biểu đồ lịch sử làm bài, điểm số từng phần, xem lại câu sai.</p>
            <span className="feature-card-arrow" aria-hidden>›</span>
          </div>
          <div className="feature-card">
            <div className="feat-icon" style={{ background: "#fde4e4" }}>
              <Image src="/svg/vi-shield.svg" alt="" aria-hidden width={36} height={36} />
            </div>
            <h3>Giải thích tiếng Việt</h3>
            <p>Mỗi câu có giải thích chi tiết, dịch nghĩa, từ vựng và ngữ pháp liên quan.</p>
            <span className="feature-card-arrow" aria-hidden>›</span>
          </div>
        </div>
      </div>
      <footer className="site-footer">
        <div className="site-footer-inner">
          <div className="footer-brand">180<span>ten</span></div>
          <div className="footer-links">
            <button className="footer-link" onClick={() => onOpenInfoModal("about")}>Về chúng tôi</button>
            <button className="footer-link" onClick={() => onOpenInfoModal("privacy")}>Chính sách bảo mật</button>
            <button className="footer-link" onClick={() => onOpenInfoModal("terms")}>Điều khoản sử dụng</button>
            <button className="footer-link" onClick={() => onOpenInfoModal("contact")}>Liên hệ</button>
          </div>
          <div className="footer-copy">© 2026 180ten. Đã đăng ký bản quyền.</div>
        </div>
      </footer>
    </div>
  );
}
