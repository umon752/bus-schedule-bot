import { messagingApi } from '@line/bot-sdk'
import type { BusScheduleItem } from './tdx.js'
import dayjs from 'dayjs'
import { env } from './config.js'

let client: messagingApi.MessagingApiClient | null = null

function getLineClient(): messagingApi.MessagingApiClient {
  if (!client) {
    client = new messagingApi.MessagingApiClient({
      channelAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN,
    })
  }
  return client
}

/**
 * 將公車時刻表格式化為 LINE 文字訊息
 */
function formatScheduleMessage(
  fromStop: string,
  toStop: string,
  targetDate: dayjs.Dayjs,
  schedules: BusScheduleItem[]
): string {
  const dateStr = targetDate.format('YYYY/MM/DD (ddd)')
  const header = `🚌 明日公車時刻表\n📅 ${dateStr}\n📍 ${fromStop} → ${toStop}\n${'─'.repeat(22)}`

  if (schedules.length === 0) {
    return `${header}\n\n⚠️ 查無班次資料\n請確認站名或 .env 設定是否正確`
  }

  // 依路線分組
  const grouped: Record<string, string[]> = {}
  for (const s of schedules) {
    if (!grouped[s.routeName]) grouped[s.routeName] = []
    const label = s.arrivalAtFromStop
      ? `${s.departureTime} (${s.arrivalAtFromStop})`
      : s.departureTime
    grouped[s.routeName].push(label)
  }

  const lines: string[] = [header]
  for (const [routeName, times] of Object.entries(grouped)) {
    lines.push(`\n🔹 路線：${routeName}`)
    for (const t of times) {
      lines.push(`   ${t}`)
    }
  }

  lines.push(`\n─${'─'.repeat(22)}`)
  lines.push(`共 ${schedules.length} 班次　祝上班順利 🎉`)

  return lines.join('\n')
}

/**
 * 推播時刻表到 LINE
 */
export async function sendScheduleToLine(
  fromStop: string,
  toStop: string,
  targetDate: dayjs.Dayjs,
  schedules: BusScheduleItem[]
): Promise<void> {
  const userId = env.LINE_USER_ID
  const message = formatScheduleMessage(fromStop, toStop, targetDate, schedules)

  await getLineClient().pushMessage({
    to: userId,
    messages: [{ type: 'text', text: message }],
  })

  console.log(`✅ LINE 推播成功（${schedules.length} 班次）`)
}
