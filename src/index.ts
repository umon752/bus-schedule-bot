import './config.js'   // 啟動時驗證環境變數（必須最先 import）
import cron from 'node-cron'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone.js'
import utc from 'dayjs/plugin/utc.js'
import http from 'http'
import { fetchBusSchedule } from './tdx.js'
import { sendScheduleToLine } from './line.js'

dayjs.extend(utc)
dayjs.extend(timezone)

const TZ = process.env.TIMEZONE || 'Asia/Taipei'
const FROM_STOP = process.env.BUS_FROM_STOP || '新坡'
const TO_STOP = process.env.BUS_TO_STOP || '天祥醫院'
const CITY = process.env.BUS_CITY || ''
const OPERATOR = process.env.BUS_OPERATOR || ''

/** 執行一次查詢並推播 */
async function runJob(): Promise<void> {
  const now = dayjs().tz(TZ)
  const targetDate = now.add(1, 'day')  // 取隔天時刻表

  console.log(`\n[${now.format('YYYY-MM-DD HH:mm:ss')}] 開始查詢公車時刻表...`)
  console.log(`路線：${FROM_STOP} → ${TO_STOP}，查詢日期：${targetDate.format('YYYY-MM-DD')}`)

  try {
    const schedules = await fetchBusSchedule(FROM_STOP, TO_STOP, targetDate, {
      city: CITY || undefined,
      operator: OPERATOR || undefined,
    })

    await sendScheduleToLine(FROM_STOP, TO_STOP, targetDate, schedules)
  } catch (err) {
    // 只記錄訊息，不輸出 stack（避免洩漏 token 或內部路徑）
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`❌ 執行失敗：${msg}`)
  }
}

// ── 排程：每天 19:00（Asia/Taipei）觸發 ──
console.log(`🤖 公車時刻 LINE Bot 啟動中...（時區：${TZ}）`)
console.log(`📋 每天 19:00 自動推播 ${FROM_STOP} → ${TO_STOP} 時刻表`)

cron.schedule('0 19 * * *', () => {
  runJob().catch(console.error)
}, { timezone: TZ })

// ── HTTP 健康檢查（防止 Railway 讓服務進入睡眠）──
const PORT = process.env.PORT || 3000
http.createServer((_, res) => {
  res.writeHead(200)
  res.end('ok')
}).listen(PORT, () => {
  console.log(`🌐 Health check server running on port ${PORT}`)
})

// 啟動時立即執行一次（方便測試，正式部署可移除或加環境變數控制）
if (process.env.RUN_ON_START === 'true') {
  console.log('🔄 RUN_ON_START=true，立即執行一次...')
  runJob().then(() => process.exit(0)).catch(err => {
    console.error(err)
    process.exit(1)
  })
}
