import 'dotenv/config'

/**
 * 啟動時驗證所有必要的環境變數。
 * 若有缺漏，立即拋出清楚的錯誤，避免以 undefined 呼叫外部 API。
 */

const REQUIRED_VARS = [
  'TDX_CLIENT_ID',
  'TDX_CLIENT_SECRET',
  'LINE_CHANNEL_ACCESS_TOKEN',
  'LINE_USER_ID',
] as const

type RequiredVar = (typeof REQUIRED_VARS)[number]

function validateEnv(): Record<RequiredVar, string> {
  const missing = REQUIRED_VARS.filter((key) => !process.env[key]?.trim())

  if (missing.length > 0) {
    throw new Error(
      `[Config] 缺少必要的環境變數：${missing.join(', ')}\n` +
        `請複製 .env.example 為 .env 並填入對應的金鑰。`
    )
  }

  // 也驗證「city 或 operator 至少要有一個」
  if (!process.env.BUS_CITY?.trim() && !process.env.BUS_OPERATOR?.trim()) {
    throw new Error(
      '[Config] BUS_CITY（市區公車）或 BUS_OPERATOR（公路客運）至少需要設定一項。'
    )
  }

  return Object.fromEntries(
    REQUIRED_VARS.map((key) => [key, process.env[key]!.trim()])
  ) as Record<RequiredVar, string>
}

export const env = validateEnv()
