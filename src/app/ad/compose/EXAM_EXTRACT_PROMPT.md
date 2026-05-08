# Prompt trích xuất câu hỏi đề thi JLPT / BJT

Dán prompt dưới đây vào Claude / GPT-4o kèm file ảnh hoặc PDF đề thi.

---

```
You are an expert JLPT/BJT exam digitizer. I will provide images or PDF pages of a Japanese language exam. Your task is to extract every question and output a single valid JSON array.

## STEP 1 — Identify exam metadata

Detect from the cover page or header:
- `level`: "N1" | "N2" | "N3" | "N4" | "N5" | "BJT"
- `section`: "言語知識（文字・語彙）" | "言語知識（文法）・読解" | "聴解" | "BJT第１部" | "BJT第２部" | "BJT第３部" (if shown)

## STEP 2 — Map 問題 number → typeId

Use the table below for the detected level.

### JLPT N1 / N2
| 問題 | Section        | typeId          |
|------|----------------|-----------------|
| 問題1 | 語彙            | kanji           |
| 問題2 | 語彙            | bunmyaku        |
| 問題3 | 語彙            | iikae           |
| 問題4 | 語彙            | yoho            |
| 問題5 | 文法            | bunpo1          |
| 問題6 | 文法            | bunpo2          |
| 問題7 | 文法            | bunsho          |
| 問題8 | 読解            | tan             |
| 問題9 | 読解            | chu             |
| 問題10| 読解            | cho             |
| 問題11| 読解            | togo            |
| 問題12| 読解            | shudai          |
| 問題13| 読解            | joho            |
| 問題1 | 聴解            | listen_kadai    |
| 問題2 | 聴解            | listen_point    |
| 問題3 | 聴解            | listen_gaiyou   |
| 問題4 | 聴解            | listen_sokuji   |
| 問題5 | 聴解            | listen_togo     |

### JLPT N3
| 問題 | Section        | typeId          |
|------|----------------|-----------------|
| 問題1 | 語彙            | kanji           |
| 問題2 | 語彙            | hyouki          |
| 問題3 | 語彙            | bunmyaku        |
| 問題4 | 語彙            | iikae           |
| 問題5 | 語彙            | yoho            |
| 問題1 | 文法            | bunpo1          |
| 問題2 | 文法            | bunpo2          |
| 問題3 | 文法            | bunsho          |
| 問題4 | 読解            | tan             |
| 問題5 | 読解            | chu             |
| 問題6 | 読解            | cho             |
| 問題7 | 読解            | joho            |
| 問題1 | 聴解            | listen_kadai    |
| 問題2 | 聴解            | listen_point    |
| 問題3 | 聴解            | listen_gaiyou   |
| 問題4 | 聴解            | listen_hatsuwa  |
| 問題5 | 聴解            | listen_sokuji   |

### JLPT N4 / N5
| 問題 | Section        | typeId          |
|------|----------------|-----------------|
| 問題1 | 語彙            | kanji           |
| 問題2 | 語彙            | hyouki          |
| 問題3 | 語彙            | bunmyaku        |
| 問題4 | 語彙            | yoho            |
| 問題1 | 文法・読解      | bunpo1          |
| 問題2 | 文法・読解      | bunpo2          |
| 問題3 | 文法・読解      | bunsho          |
| 問題4 | 文法・読解      | tan             |
| 問題5 | 文法・読解      | chu             |
| 問題6 | 文法・読解      | joho            |
| 問題1 | 聴解            | listen_kadai    |
| 問題2 | 聴解            | listen_point    |
| 問題3 | 聴解            | listen_hatsuwa  |
| 問題4 | 聴解            | listen_sokuji   |

### BJT
| Section              | typeId    |
|----------------------|-----------|
| 第１部 セクション１   | bjt_1_1   |
| 第１部 セクション２   | bjt_1_2   |
| 第１部 セクション３   | bjt_1_3   |
| 第２部 セクション１   | bjt_2_1   |
| 第２部 セクション２   | bjt_2_2   |
| 第２部 セクション３   | bjt_2_3   |
| 第３部 セクション１   | bjt_3_1   |
| 第３部 セクション２   | bjt_3_2   |
| 第３部 セクション３   | bjt_3_3   |

## STEP 3 — Extract each question

Output a JSON array where each element is:

```json
{
  "type": "<typeId>",
  "level": "<N1|N2|N3|N4|N5|BJT>",
  "order_index": <integer, 1-based within this typeId>,
  "data": { ... }
}
```

The `data` object schema depends on `type` — see STEP 4.

## STEP 4 — Data schemas per type

### A. Simple choice (kanji / hyouki / bunmyaku / iikae / yoho / bunpo1)

```json
{
  "question": "____の言葉の読み方として… 学生（　　）の",
  "correct": "１",
  "wrongs": ["２", "３", "４"],
  "explanation": ""
}
```

Rules:
- `question`: full question sentence. For kanji/hyouki, include the underlined word in the sentence. For bunmyaku/bunpo1, blank is written as `（　　　）`.
- `correct`: the text of the correct choice (NOT the number "１２３４", but the actual option text, e.g. "がくせい"). If answer key is not provided, use `""`.
- `wrongs`: array of 3 wrong option texts, in original １→２→３→４ order excluding the correct one.
- If correct answer is unknown, set `"correct": ""` and put all 4 options as `"wrongs": ["opt1","opt2","opt3","opt4"]`.

### B. 文の組み立て bunpo2

```json
{
  "question": "先生に　＿＿　★　＿＿　＿＿　もらいました。",
  "correct": "てつだって",
  "wrongs": ["を", "ことを", "頼んで"],
  "explanation": ""
}
```

Rules:
- `question`: full sentence including `★` marker and blank slots `＿＿`.
- `correct`: the word/phrase that goes into the `★` position.
- `wrongs`: the other 3 options.

### C. 文章の文法 bunsho

```json
{
  "x": "46",
  "y": "50",
  "passage": "本文テキスト。[46]（　　）[47]（　　）…",
  "questions": [
    {
      "question": "[46]に入れるのに最もよいものを選びなさい。",
      "correct": "しかし",
      "wrongs": ["また", "それで", "ところが"],
      "explanation": ""
    }
  ]
}
```

Rules:
- `passage`: the full reading passage. Blank slots inside the passage are written as `[46]（　　）` using the question number shown in brackets.
- `x` / `y`: first and last blank number in the passage (as string).
- Each blank becomes one entry in `questions`.

### D. 読解 — tan / chu / cho / shudai / joho

```json
{
  "x": "48",
  "y": "51",
  "passages": [
    {
      "text": "パッセージ全文…",
      "questions": [
        {
          "question": "筆者が最も言いたいことは何か。",
          "correct": "選択肢のテキスト",
          "wrongs": ["選択肢２", "選択肢３", "選択肢４"],
          "explanation": ""
        }
      ]
    }
  ]
}
```

Rules:
- `x` / `y`: page/line range numbers shown in the exam header (omit for cho/shudai/joho where not shown).
- Multiple passages (e.g., tan has several short texts) → multiple objects in `passages`.
- For `joho` (情報検索): the information panel/table counts as one passage text.

### E. 統合理解 togo (two texts A & B)

```json
{
  "passages": ["Aのテキスト全文", "Bのテキスト全文"],
  "questions": [
    {
      "question": "AとBが共通して述べていることは何か。",
      "correct": "...",
      "wrongs": ["...", "...", "..."],
      "explanation": ""
    }
  ]
}
```

### F. 聴解 — listen_kadai / listen_point / listen_gaiyou / listen_hatsuwa

```json
{
  "audioUrl": "",
  "questions": [
    {
      "orderNum": "1",
      "correct": "",
      "wrongs": ["", "", ""],
      "imageUrl": "",
      "explanation": ""
    }
  ]
}
```

Rules:
- `audioUrl`: leave `""` (audio files must be uploaded separately).
- `orderNum`: the number of this sub-question as printed in the exam (e.g., "1", "2" … "6").
- For questions with picture options (N4/N5 課題理解, 発話表現): set `"imageUrl": "PLACEHOLDER_Q{orderNum}"` to mark that an image is needed.
- If answer choices are printed as text, fill `correct` and `wrongs`. Otherwise leave `""`.
- `listen_hatsuwa` (発話表現): choices are short spoken phrases — include as text if visible.

### G. 即時応答 listen_sokuji

```json
{
  "audioUrl": "",
  "questions": [
    {
      "orderNum": "1",
      "correct": "",
      "wrongs": ["", ""],
      "explanation": ""
    }
  ]
}
```

Note: only **2** wrong options (3 choices total, not 4).

### H. 統合的聴解 listen_togo (N1/N2 only)

```json
{
  "audioUrl": "",
  "type1": {
    "mainQuestion": "この会話で、男の人はこれからどこへ行きますか。",
    "orderNum": "21",
    "correct": "",
    "wrongs": ["", "", ""],
    "explanation": ""
  },
  "type2": {
    "mainQuestion": "この話し合いを聞いてください。",
    "questions": [
      { "orderNum": "22", "correct": "", "wrongs": ["", "", ""], "explanation": "" },
      { "orderNum": "23", "correct": "", "wrongs": ["", "", ""], "explanation": "" }
    ]
  }
}
```

### I. BJT 聴解 — bjt_1_1 / bjt_1_2 / bjt_2_1

```json
{
  "imageUrl": "",
  "correct": "",
  "wrongs": ["", "", ""],
  "explanation": ""
}
```

Rules:
- Each item is one question (one `order_index`).
- `imageUrl`: if there is a photo/diagram shown, set `"PLACEHOLDER_IMG_{order_index}"`.

### J. BJT 総合聴解 — bjt_1_3 / bjt_2_3

```json
{
  "imageUrl": "",
  "correct": "1",
  "wrongs": ["2", "3", "4"],
  "explanation": ""
}
```

Note: answer here is the **number** "1"|"2"|"3"|"4" (refers to audio track selection), not option text.

### K. BJT 資料読解 — bjt_2_2

```json
{
  "question": "この表を見て、適切な内容を選びなさい。",
  "imageUrl": "PLACEHOLDER_CHART",
  "correct": "グラフの説明テキスト",
  "wrongs": ["...", "...", "..."],
  "explanation": ""
}
```

### L. BJT 語彙・文法 — bjt_3_1

```json
{
  "question": "（　　）に入れるのに最もよいものを選びなさい。 田中さんは会議に（　　）予定です。",
  "correct": "出席する",
  "wrongs": ["出席した", "出席して", "出席しない"],
  "explanation": ""
}
```

### M. BJT 表現読解 — bjt_3_2

```json
{
  "question": "次の文の意味に最も近いものを選びなさい。",
  "correct": "...",
  "wrongs": ["...", "...", "..."],
  "explanation": ""
}
```

### N. BJT 総合読解 — bjt_3_3

```json
{
  "passage": "長文テキスト",
  "question": "この文章の主な内容は何ですか。",
  "correct": "...",
  "wrongs": ["...", "...", "..."],
  "explanation": ""
}
```

## STEP 5 — Furigana encoding

Whenever furigana (reading) is printed above a kanji in the original exam, encode it as:
`{(漢字)(かな)}`

Example: 学校 with reading がっこう → `{(学校)(がっこう)}`

Apply this inside `question`, `passage`, and option texts.

## STEP 6 — Unknown answers

If no answer key is provided:
- Set `"correct": ""`
- Put ALL printed options into `"wrongs": ["opt1","opt2","opt3","opt4"]`
- The app will allow the user to mark the correct answer manually.

If an answer key IS provided alongside the exam, fill `correct` with the text of the correct option and `wrongs` with the other 3 (or 2 for 即時応答).

## STEP 7 — Output format

Return ONLY a JSON array. No markdown fences, no explanation text before or after. Example structure:

[
  {
    "type": "kanji",
    "level": "N3",
    "order_index": 1,
    "data": {
      "question": "（　）の言葉の読み方として最もよいものを選びなさい。 彼は{(毎朝)(まいあさ)}_{(新聞)(しんぶん)}_を読む。",
      "correct": "しんぶん",
      "wrongs": ["ざっし", "てがみ", "ほん"],
      "explanation": ""
    }
  },
  {
    "type": "bunmyaku",
    "level": "N3",
    "order_index": 1,
    "data": {
      "question": "この仕事は難しいが、やり（　　　）がある。",
      "correct": "がい",
      "wrongs": ["かた", "もの", "ほう"],
      "explanation": ""
    }
  }
]

## IMPORTANT RULES

1. Preserve ALL original Japanese text exactly — do not translate, summarize, or rephrase anything.
2. Keep question numbering (`order_index`) sequential within each `type`, starting at 1.
3. For listening sections: extract every sub-question even if audio content is unknown.
4. For passage types: one `order_index` = one passage block (which may contain multiple sub-questions inside `questions` array).
5. If a page is blurry or cut off, include the question with `"question": "[UNCLEAR]"` and a note in `explanation`.
6. Output ONLY the JSON array — no preamble, no explanation.
```

---

## Cách dùng

1. Mở Claude.ai hoặc ChatGPT (GPT-4o)
2. Tạo conversation mới, dán toàn bộ prompt trên
3. Upload ảnh / PDF các trang đề thi
4. AI trả về JSON array
5. Copy JSON → dán vào trường **Import JSON** trong admin Compose tab (nếu có) hoặc dùng API `bulk_upsert` trực tiếp

## Gợi ý bổ sung khi gửi

- Gửi kèm **đáp án** (answer key page) nếu có để AI điền `correct` ngay
- Nếu đề nhiều phần: upload từng phần riêng, ghi rõ "Đây là phần 聴解 N3" để AI không nhầm mapping
- Với phần 聴解: chỉ cần trích xuất cấu trúc câu hỏi và số thứ tự — audio upload riêng
