// ── constants.ts ─────────────────────────────────────────────
// All shared constants migrated verbatim from htdocs/index.html
// ─────────────────────────────────────────────────────────────

export const LEVEL_TIMES: Record<string, { read: number; listen: number }> = {
  N1:  { read: 110, listen: 55 },
  N2:  { read: 105, listen: 50 },
  N3:  { read: 100, listen: 40 },
  N4:  { read: 80,  listen: 35 },
  N5:  { read: 60,  listen: 30 },
  BJT: { read: 105, listen: 0  },
};

export interface BjtPhase {
  key: string;
  label: string;
  minutes: number;
  types: string[];
}

export const BJT_PHASES: BjtPhase[] = [
  { key: 'listen',    label: '聴解',   minutes: 45, types: ['bjt_1_1','bjt_1_2','bjt_1_3'] },
  { key: 'chodokkai', label: '聴読解', minutes: 30, types: ['bjt_2_1','bjt_2_2','bjt_2_3'] },
  { key: 'reading',   label: '読解',   minutes: 30, types: ['bjt_3_1','bjt_3_2','bjt_3_3'] },
];

/** Số đề miễn phí cho mỗi cấp (N1…BJT); từ đề thứ 6 trở đi cần Premium. */
export const FREE_EXAMS_PER_LEVEL = 5;

export const BANNED_PW = [
  '123456','123456789','12345678','admin','Demo@123','kenboy00','123123',
  '12345','1234567890','1234567','111111','123456aA@','12345678910','123456a@',
  '12341234','123123123','Abc@123','123456789a','abcd1234','012345','24446666',
];

export const VIET_NAMES = [
  'trang','linh','hoa','mai','lan','thu','huong','nga','yen','thuy',
  'van','anh','hang','hien','nhung','phuong','thao','loan','chi','ly',
  'minh','tuan','hung','duc','nam','hai','long','cuong','dat','khanh',
  'quang','binh','son','huy','bao','trung','phuc','thinh','khoa','viet',
];

export const CAP_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';

// ── SRS ─────────────────────────────────────────────────────
export const SRS_INTERVALS = [5, 30, 720, 1440, 2880, 5760, 10080, 21600, 43200, 129600, 259200];
export const SRS_LABELS    = ['5ph','30ph','12h','1ng','2ng','4ng','7ng','15ng','1th','3th','6th'];

// ── Exam scoring constants ───────────────────────────────────

export interface MondaiInfo { group: string; mondai: number; name: string; }

export const TYPE_MONDAI_MAP: Record<string, MondaiInfo> = {
  kanji:           { group: 'vocab',          mondai: 1,  name: '問題1: Kanji đọc' },
  hyouki:          { group: 'vocab',          mondai: 2,  name: '問題2: 表記' },
  iikae:           { group: 'vocab',          mondai: 4,  name: '問題4: 言い換え類義' },
  bunmyaku:        { group: 'vocab',          mondai: 3,  name: '問題3: Ngữ cảnh từ vựng' },
  yoho:            { group: 'vocab',          mondai: 5,  name: '問題5: 用法 / 言い換え類義 (N5)' },
  bunpo1:          { group: 'grammar',        mondai: 5,  name: '問題5: Cách dùng từ' },
  bunpo2:          { group: 'grammar',        mondai: 6,  name: '問題6: Chọn ngữ pháp' },
  bunsho:          { group: 'grammar',        mondai: 7,  name: '問題7: Sắp xếp câu' },
  togo:            { group: 'grammar',        mondai: 8,  name: '問題8: Điền đoạn văn' },
  tan:             { group: 'reading',        mondai: 9,  name: '問題9: Đoạn ngắn' },
  chu:             { group: 'reading',        mondai: 10, name: '問題10: Đoạn trung bình' },
  cho:             { group: 'reading',        mondai: 11, name: '問題11: Đoạn dài' },
  joho:            { group: 'reading',        mondai: 12, name: '問題12: Tìm thông tin' },
  shudai:          { group: 'reading',        mondai: 13, name: '問題13: So sánh đoạn' },
  listen_kadai:    { group: 'listen',         mondai: 1,  name: '問題1: 課題理解' },
  listen_point:    { group: 'listen',         mondai: 2,  name: '問題2: ポイント理解' },
  listen_gaiyou:   { group: 'listen',         mondai: 3,  name: '問題3: 概要理解' },
  listen_hatsuwa:  { group: 'listen',         mondai: 4,  name: '問題4: 発話表現' },
  listen_sokuji:   { group: 'listen',         mondai: 5,  name: '問題5: 即時応答' },
  listen_togo:     { group: 'listen',         mondai: 6,  name: '問題6: 統合理解' },
  bjt_1_1:         { group: 'bjt_listen',     mondai: 1,  name: '場面把握' },
  bjt_1_2:         { group: 'bjt_listen',     mondai: 2,  name: '発言聴解' },
  bjt_1_3:         { group: 'bjt_listen',     mondai: 3,  name: '総合聴解' },
  bjt_2_1:         { group: 'bjt_chodokkai',  mondai: 4,  name: '状況把握' },
  bjt_2_2:         { group: 'bjt_chodokkai',  mondai: 5,  name: '資料読解' },
  bjt_2_3:         { group: 'bjt_chodokkai',  mondai: 6,  name: '総合聴解' },
  bjt_3_1:         { group: 'bjt_reading',    mondai: 7,  name: '語彙・文法' },
  bjt_3_2:         { group: 'bjt_reading',    mondai: 8,  name: '表現読解' },
  bjt_3_3:         { group: 'bjt_reading',    mondai: 9,  name: '総合読解' },
};

export const REPORT_GROUPS: Record<string, { label: string; sub: string; color: string }> = {
  vocab:          { label: '文字・語彙', sub: 'Từ vựng & Kanji', color: '#6C6FF7' },
  grammar:        { label: '文法',       sub: 'Ngữ pháp',        color: '#f97316' },
  reading:        { label: '読解',       sub: 'Đọc hiểu',        color: '#22c55e' },
  listen:         { label: '聴解',       sub: 'Nghe hiểu',       color: '#0ea5e9' },
  bjt_listen:     { label: '聴解',       sub: 'BJT 第１部',      color: '#0ea5e9' },
  bjt_chodokkai:  { label: '聴読解',     sub: 'BJT 第２部',      color: '#f59e0b' },
  bjt_reading:    { label: '読解',       sub: 'BJT 第３部',      color: '#22c55e' },
};

export interface SectionDef {
  label: string; sub: string; vi: string;
  groups: string[]; max: number; color: string;
}
export interface LevelCfg {
  order: string[];
  total: number;
  [key: string]: SectionDef | string[] | number;
}

const N1_CFG: LevelCfg = {
  order:     ['language','reading','listening'],
  language:  { label: '言語知識', sub: '文字・語彙・文法', vi: 'Ngôn ngữ',        groups: ['vocab','grammar'], max: 60, color: '#6C6FF7' },
  reading:   { label: '読解',     sub: '読解',             vi: 'Đọc hiểu',        groups: ['reading'],         max: 60, color: '#22c55e' },
  listening: { label: '聴解',     sub: '聴解',             vi: 'Nghe hiểu',       groups: ['listen'],          max: 60, color: '#0ea5e9' },
  total:     180,
} as unknown as LevelCfg;

const N4_CFG: LevelCfg = {
  order:     ['language','listening'],
  language:  { label: '言語知識', sub: '文字・語彙・文法・読解', vi: 'Ngôn ngữ & Đọc', groups: ['vocab','grammar','reading'], max: 120, color: '#6C6FF7' },
  listening: { label: '聴解',     sub: '聴解',                   vi: 'Nghe hiểu',       groups: ['listen'],                   max: 60,  color: '#0ea5e9' },
  total:     180,
} as unknown as LevelCfg;

const N3_CFG: LevelCfg = {
  order:     ['language','reading','listening'],
  language:  { label: '言語知識', sub: '文字・語彙・文法', vi: 'Ngôn ngữ',  groups: ['vocab','grammar'], max: 60, color: '#6C6FF7' },
  reading:   { label: '読解',     sub: '読解',             vi: 'Đọc hiểu',  groups: ['reading'],         max: 60, color: '#22c55e' },
  listening: { label: '聴解',     sub: '聴解',             vi: 'Nghe hiểu', groups: ['listen'],          max: 60, color: '#0ea5e9' },
  total:     180,
} as unknown as LevelCfg;

export const JLPT_SECTION_CFG: Record<string, LevelCfg> = {
  N1: N1_CFG,
  N2: N1_CFG,
  N3: N3_CFG,
  N4: N4_CFG,
  N5: N4_CFG,
};

export const JLPT_PASSING: Record<string, Record<string, number>> = {
  N1: { total: 100, language: 19, reading: 19, listening: 19 },
  N2: { total: 90,  language: 19, reading: 19, listening: 19 },
  N3: { total: 95,  language: 19, reading: 19, listening: 19 },
  N4: { total: 90,  language: 38, listening: 19 },
  N5: { total: 80,  language: 38, listening: 19 },
};

// ── Exam instructions ────────────────────────────────────────

export const TYPE_INSTRUCTIONS: Record<string, string> = {
  kanji:           '＿＿＿の言葉の読み方として最もよいものを、１・２・３・４から一つ選びなさい。',
  bunmyaku:        '（　　　）に入れるのに最もよいものを、１・２・３・４から一つ選びなさい。',
  hyouki:          '＿＿＿に漢字を書き取るとき、最もよいものを、１・２・３・４から一つ選びなさい。',
  iikae:           '＿＿＿の言葉に意味が最も近いものを、１・２・３・４から一つ選びなさい。',
  yoho:            '次の言葉の使い方として最もよいものを、１・２・３・４から一つ選びなさい。',
  bunpo1:          '次の文の（　　　）に入れるのに最もよいものを、１・２・３・４から一つ選びなさい。',
  bunpo2:          '次の文の (★) に入る最もよいものを、１・２・３・４から一つ選びなさい。',
  bunsho:          '次の文章を読んで、文章全体の趣旨を踏まえて、中に入る最もよいものを、１・２・３・４から一つ選びなさい。',
  tan:             '次の文章を読んで、後の問いに対する答えとして最もよいものを、１・２・３・４から一つ選びなさい。',
  chu:             '次の文章を読んで、後の問いに対する答えとして最もよいものを、１・２・３・４から一つ選びなさい。',
  cho:             '次の文章を読んで、後の問いに対する答えとして最もよいものを、１・２・３・４から一つ選びなさい。',
  togo:            '次のＡとＢの文章を読んで、後の問いに対する答えとして最もよいものを、１・２・３・４から一つ選びなさい。',
  shudai:          '次の文章を読んで、後の問いに対する答えとして最もよいものを、１・２・３・４から一つ選びなさい。',
  joho:            '右のページを見て、後の問いに対する答えとして最もよいものを、１・２・３・４から一つ選びなさい。',
  listen_kadai:    '課題理解',
  listen_point:    'ポイント理解',
  listen_gaiyou:   '概要理解',
  listen_hatsuwa:  '発話表現',
  listen_sokuji:   '即時応答',
  listen_togo:     '統合的聴解',
  // BJT (added below)
  bjt_1_1: 'セクション１では、写真を見て、答えてください。４つの選択肢を読み上げます。写真の内容を表している文はどれですか。１・２・３・４のなかから最も良いものを一つ選んでください。',
  bjt_1_2: 'セクション２では、音声を聞きながら写真を見て答えてください。質問の後、４つの選択肢を読み上げます。１・２・３・４のなかから最も良いものを一つ選んでください。',
  bjt_1_3: 'セクション３では、イラストを見ながら、音声を聞いて答えてください。イラストは場面を表しています。質問の後、４つの選択肢を読み上げます。１・２・３・４のなかから最も良いものを一つ選んでください。',
  bjt_2_1: 'セクション１では、音声を聴きながら、写真を見て答えてください。質問をよく聴いて、１、２、３、４の中から最もよいものを１つ選んでください。',
  bjt_2_2: 'セクション２では、音声を聴きながら、資料を見て答えてください。質問をよく聴いて、１、２、３、４の中から最もよいものを１つ選んでください。',
  bjt_2_3: 'セクション３では、音声を聴きながら、資料を見て答えてください。質問をよく聴いて、１、２、３、４の中から最もよいものを１つ選んでください。',
  bjt_3_1: '次の文の　　　に入る最もよいものを１、２、３、４の中から１つ選んでください。',
  bjt_3_2: '次の文の　　　に入る最もよいものを１、２、３、４の中から１つ選んでください。',
  bjt_3_3: '次の文章を読んで、質問に答えてください。１、２、３、４の中から最もよいものを１つ選んでください。',
};

export const N1N2_LISTEN_INSTRUCTIONS: Record<string, string> = {
  listen_kadai:  '問題1では、まず質問を聞いてください。それから話を聞いて、問題用紙の1から4の中から、最もよいものを一つ選んでください。',
  listen_point:  '問題2では、まず質問を聞いてください。そのあと、問題用紙を見てください。読む時間があります。それから話を聞いて、問題用紙の1から4の中から、最もよいものを一つ選んでください。',
  listen_gaiyou: '問題3では、問題用紙に何も印刷されていません。この問題は、ぜんたいとしてどんな内容かを聞く問題です。話の前に質問はありません。まず話を聞いてください。それから、質問と選択肢を聞いて、1から4の中から、最もよいものを一つ選んでください。',
  listen_sokuji: '問題4では、問題用紙に何も印刷されていません。まず文を聞いてください。それから、その返事を聞いて、1から3の中から、最もよいものを一つ選んでください。',
  listen_togo:   '問題５では、長めのはなしを聞きます。この問題には練習はありません。問題用紙にメモをとってもかまいません。',
};

export const BJT_TYPE_ORDER: Record<string, number> = {
  bjt_1_1: 1, bjt_1_2: 2, bjt_1_3: 3,
  bjt_2_1: 4, bjt_2_2: 5, bjt_2_3: 6,
  bjt_3_1: 7, bjt_3_2: 8, bjt_3_3: 9,
};

export const TYPE_MAP_BJT_LABEL: Record<string, string> = {
  bjt_1_1: 'セクション１　場面把握問題　',
  bjt_1_2: 'セクション２　発言聴解問題　',
  bjt_1_3: 'セクション３　総合聴解問題　',
  bjt_2_1: 'セクション１　状況把握問題　',
  bjt_2_2: 'セクション２　資料読解問題　',
  bjt_2_3: 'セクション３　総合聴解問題　',
  bjt_3_1: 'セクション１　語彙・文法問題　',
  bjt_3_2: 'セクション２　表現読解問題　',
  bjt_3_3: 'セクション３　総合読解問題　',
};

// ── Dashboard skill spider ───────────────────────────────────

export const SKILL_AXES = [
  { key: 'vocab',   jp: '文字', color: '#6C6FF7' },
  { key: 'grammar', jp: '文法', color: '#f97316' },
  { key: 'reading', jp: '読解', color: '#22c55e' },
  { key: 'listen',  jp: '聴解', color: '#0ea5e9' },
];

// ── LocalStorage keys ────────────────────────────────────────
export const LOCAL_RESULTS_KEY = 'jlptbro-local-results';
export const LOCAL_DICT_KEY    = 'jlptbro-dict-history';
export const EXAM_CACHE_KEY    = 'jlptbro-exams-cache';
export const EXAM_CACHE_TTL    = 5 * 60 * 1000;
export const CARD_SETTINGS_KEY = 'jlptbro-card-settings';
// Re-export from supabase client (derived from NEXT_PUBLIC_SUPABASE_URL)
export { SB_STORAGE_KEY } from './supabase';

export const ADMIN_EMAILS: string[] = [
  'admin@180ten.com',
];

export function isAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.toLowerCase());
}
