// ── 業界別ベースレンジ ──
const INDUSTRY_BASE_RANGE = {
  "製造DX / AI": [0.012, 0.04],
  "エネルギー / 材料": [0.01, 0.035],
  "医療機器 / 画像解析": [0.015, 0.05],
  "通信 / IoT": [0.012, 0.04],
  "ソフトウェア": [0.015, 0.055],
  "車載 / パワートレイン": [0.005, 0.015],
  default: [0.01, 0.04]
};

// ── 業界別市場規模データ (日本市場, 円) ──
const INDUSTRY_MARKET_DATA = {
  "ソフトウェア": {
    marketSizeJpy: 13_000_000_000_000,
    addressableRatio: 0.0008,
    adoptionProbability: 0.15
  },
  "製造DX / AI": {
    marketSizeJpy: 3_500_000_000_000,
    addressableRatio: 0.001,
    adoptionProbability: 0.12
  },
  "エネルギー / 材料": {
    marketSizeJpy: 18_000_000_000_000,
    addressableRatio: 0.0003,
    adoptionProbability: 0.10
  },
  "医療機器 / 画像解析": {
    marketSizeJpy: 3_200_000_000_000,
    addressableRatio: 0.001,
    adoptionProbability: 0.12
  },
  "通信 / IoT": {
    marketSizeJpy: 15_000_000_000_000,
    addressableRatio: 0.0005,
    adoptionProbability: 0.12
  },
  "車載 / パワートレイン": {
    marketSizeJpy: 22_000_000_000_000,
    addressableRatio: 0.0004,
    adoptionProbability: 0.08
  }
};

// ── カテゴリ別ライセンス可能分野 ──
const CATEGORY_FIELDS = {
  "ソフトウェア": [
    { field: "情報処理・IT", baseScore: 0.80, keywords: /プログラム|情報処理|データ|アルゴリズム/i },
    { field: "SaaS・クラウドサービス", baseScore: 0.55, keywords: /クラウド|サーバ|ネットワーク|配信/i },
    { field: "組込みシステム", baseScore: 0.40, keywords: /組込|制御|ファームウェア|マイコン/i },
    { field: "金融・フィンテック", baseScore: 0.30, keywords: /金融|決済|取引|ブロックチェーン/i }
  ],
  "製造DX / AI": [
    { field: "製造業", baseScore: 0.80, keywords: /製造|加工|組立|生産/i },
    { field: "ロボティクス・FA", baseScore: 0.65, keywords: /ロボット|自動化|ＦＡ|アーム/i },
    { field: "品質検査・計測", baseScore: 0.55, keywords: /検査|計測|品質|測定/i },
    { field: "物流・サプライチェーン", baseScore: 0.35, keywords: /物流|搬送|倉庫|配送/i }
  ],
  "エネルギー / 材料": [
    { field: "エネルギー・電力", baseScore: 0.80, keywords: /電池|太陽|発電|蓄電|エネルギー/i },
    { field: "化学・素材", baseScore: 0.65, keywords: /材料|化合物|触媒|樹脂|合金/i },
    { field: "環境・リサイクル", baseScore: 0.45, keywords: /環境|リサイクル|廃棄|浄化/i },
    { field: "建設・インフラ", baseScore: 0.35, keywords: /建築|構造|コンクリート|土木/i }
  ],
  "医療機器 / 画像解析": [
    { field: "医療機器メーカー", baseScore: 0.80, keywords: /医療|診断|治療|手術|内視鏡/i },
    { field: "画像処理・AI診断", baseScore: 0.65, keywords: /画像|解析|検出|認識|ＡＩ/i },
    { field: "ヘルスケアIT", baseScore: 0.50, keywords: /電子カルテ|遠隔|モニタリング|健康/i },
    { field: "製薬・バイオ", baseScore: 0.35, keywords: /薬|バイオ|抗体|遺伝子/i }
  ],
  "通信 / IoT": [
    { field: "通信機器・インフラ", baseScore: 0.80, keywords: /通信|基地局|アンテナ|無線/i },
    { field: "IoT・センサ", baseScore: 0.65, keywords: /センサ|IoT|モニタリング|計測/i },
    { field: "自動車・モビリティ", baseScore: 0.45, keywords: /車両|自動運転|ナビ|車載/i },
    { field: "スマートホーム", baseScore: 0.30, keywords: /家電|住宅|照明|空調/i }
  ],
  "車載 / パワートレイン": [
    { field: "車載ECU・制御システム", baseScore: 0.85, keywords: /ECU|制御装置|車載|エンジン制御|電子制御/i },
    { field: "HEV・PHEV・EV駆動系", baseScore: 0.75, keywords: /ハイブリッド|HEV|PHEV|EV|電動|モータ|インバータ/i },
    { field: "建機・農機・産業車両", baseScore: 0.55, keywords: /建機|農機|フォークリフト|産業車両|油圧/i },
    { field: "産業用ソレノイド・アクチュエータ", baseScore: 0.45, keywords: /ソレノイド|アクチュエータ|バルブ|電磁弁|駆動/i }
  ]
};

// ── 強みの評価軸 ──
const STRENGTH_AXES = [
  { key: "cost", label: "コスト削減", keywords: /コスト|低減|安価|削減|節約/i },
  { key: "speed", label: "速度・効率", keywords: /高速|効率|迅速|短縮|リアルタイム/i },
  { key: "accuracy", label: "精度向上", keywords: /精度|正確|高精度|誤差|分解能/i },
  { key: "durability", label: "耐久性", keywords: /耐久|長寿命|劣化|信頼性|堅牢/i },
  { key: "safety", label: "安全性", keywords: /安全|保護|防止|リスク|事故/i },
  { key: "scalability", label: "量産性・拡張性", keywords: /量産|拡張|スケール|大規模|汎用/i },
  { key: "compatibility", label: "互換性", keywords: /互換|標準|接続|インターフェース|対応/i },
  { key: "energy", label: "省エネルギー", keywords: /省エネ|低消費|電力|エコ|環境負荷/i }
];

// ── IPC→カテゴリ マッピング (prefix → カテゴリ, 優先度付き) ──
// より具体的なプレフィックス (4文字) を先にチェックすることで精度を上げる
const IPC_CATEGORY_MAP_ORDERED = [
  // 車載 / パワートレイン (具体的なサブクラスを先に)
  { prefix: "F02D", category: "車載 / パワートレイン" },  // 内燃機関の燃焼制御
  { prefix: "F02M", category: "車載 / パワートレイン" },  // 燃料供給
  { prefix: "F02N", category: "車載 / パワートレイン" },  // 始動装置
  { prefix: "F02P", category: "車載 / パワートレイン" },  // 点火装置
  { prefix: "F02B", category: "車載 / パワートレイン" },  // 内燃機関
  { prefix: "F01N", category: "車載 / パワートレイン" },  // 排気処理
  { prefix: "F01L", category: "車載 / パワートレイン" },  // バルブ機構
  { prefix: "F16H", category: "車載 / パワートレイン" },  // トランスミッション
  { prefix: "B60L", category: "車載 / パワートレイン" },  // 電動車両
  { prefix: "B60K", category: "車載 / パワートレイン" },  // 車両駆動系
  { prefix: "B60W", category: "車載 / パワートレイン" },  // 車両制御
  { prefix: "B60R", category: "車載 / パワートレイン" },  // 車両付属品
  { prefix: "B60T", category: "車載 / パワートレイン" },  // ブレーキ
  { prefix: "B60H", category: "車載 / パワートレイン" },  // 車両空調
  { prefix: "H02M", category: "車載 / パワートレイン" },  // 電力変換 (DC-DC, インバータ) — 車載文脈で多用
  { prefix: "H02P", category: "車載 / パワートレイン" },  // モータ制御

  // エネルギー / 材料 (H02の残り)
  { prefix: "H02J", category: "エネルギー / 材料" },  // 電力供給・配電
  { prefix: "H02K", category: "エネルギー / 材料" },  // 電気機械
  { prefix: "H02N", category: "エネルギー / 材料" },  // 発電
  { prefix: "H01M", category: "エネルギー / 材料" },  // 電池
  { prefix: "H01L", category: "エネルギー / 材料" },  // 半導体

  // ソフトウェア
  { prefix: "G06", category: "ソフトウェア" },
  // 通信 / IoT
  { prefix: "G10", category: "通信 / IoT" },
  { prefix: "H04", category: "通信 / IoT" },
  // 製造DX / AI
  { prefix: "B25", category: "製造DX / AI" },
  { prefix: "B23", category: "製造DX / AI" },
  // 医療機器 / 画像解析
  { prefix: "A61", category: "医療機器 / 画像解析" },
  { prefix: "G16", category: "医療機器 / 画像解析" },
  // エネルギー / 材料 (一般)
  { prefix: "C01", category: "エネルギー / 材料" },
  { prefix: "C08", category: "エネルギー / 材料" },
  { prefix: "H01", category: "エネルギー / 材料" },
  { prefix: "H02", category: "エネルギー / 材料" },
];

module.exports = {
  INDUSTRY_BASE_RANGE,
  INDUSTRY_MARKET_DATA,
  CATEGORY_FIELDS,
  STRENGTH_AXES,
  IPC_CATEGORY_MAP_ORDERED
};
