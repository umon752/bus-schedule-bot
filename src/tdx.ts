import axios, { AxiosError } from 'axios'
import dayjs from 'dayjs'
import { env } from './config.js'

const TDX_AUTH_URL = 'https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token'
const TDX_BASE_URL = 'https://tdx.transportdata.tw/api/basic'

let cachedToken: { value: string; expiresAt: number } | null = null

/**
 * 將字串中的單引號跳脫，防止 OData $filter 注入。
 * OData 規範：單引號以兩個單引號表示。
 */
function escapeOData(value: string): string {
  return value.replace(/'/g, "''")
}

/**
 * 從 Axios 錯誤中擷取安全的日誌訊息，避免洩漏 Authorization header。
 */
function safeErrorMessage(err: unknown): string {
  if (err instanceof AxiosError) {
    return `HTTP ${err.response?.status ?? 'unknown'} — ${err.response?.data?.message ?? err.message}`
  }
  return err instanceof Error ? err.message : String(err)
}

/** 取得 TDX OAuth2 Access Token（自動快取，到期前重取） */
export async function getTdxToken(): Promise<string> {
  const now = Date.now()
  if (cachedToken && cachedToken.expiresAt > now + 60_000) {
    return cachedToken.value
  }

  const res = await axios.post(
    TDX_AUTH_URL,
    new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env.TDX_CLIENT_ID,
      client_secret: env.TDX_CLIENT_SECRET,
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  )

  const { access_token, expires_in } = res.data
  cachedToken = { value: access_token, expiresAt: now + expires_in * 1000 }
  return access_token
}

/** TDX 公車時刻表（單一班次） */
export interface BusScheduleItem {
  routeName: string
  departureTime: string  // HH:mm
  arrivalTime?: string
}

/**
 * 查詢指定日期，從 fromStop 到 toStop 的公車時刻表
 * 支援兩種模式：
 *  - 市區公車：需要 city 參數（桃園=Taoyuan, 新北=NewTaipei, ...）
 *  - 公路客運：city 留空，需要 operator 參數
 */
export async function fetchBusSchedule(
  fromStop: string,
  toStop: string,
  targetDate: dayjs.Dayjs,
  options: { city?: string; operator?: string }
): Promise<BusScheduleItem[]> {
  const token = await getTdxToken()
  const headers = { Authorization: `Bearer ${token}` }

  const { city, operator } = options
  const results: BusScheduleItem[] = []

  if (city) {
    // ── 市區公車：查詢經過 fromStop 與 toStop 的路線 ──
    const routeRes = await axios.get(
      `${TDX_BASE_URL}/v2/Bus/StopOfRoute/City/${city}`,
      {
        headers,
        params: {
          $filter: `Stops/any(s: s/StopName/Zh_tw eq '${escapeOData(fromStop)}')`,
          $select: 'RouteUID,RouteName,Stops',
          $format: 'JSON',
        },
      }
    )

    // 過濾：同一路線也要包含 toStop
    const matchedRoutes: Array<{ RouteUID: string; RouteName: { Zh_tw: string } }> =
      routeRes.data.filter((r: any) =>
        r.Stops?.some((s: any) => s.StopName?.Zh_tw === toStop)
      )

    if (matchedRoutes.length === 0) {
      console.warn(`⚠️  找不到同時包含「${fromStop}」和「${toStop}」的市區公車路線`)
      return []
    }

    // 取得每條路線的時刻表
    for (const route of matchedRoutes) {
      const routeName = route.RouteName.Zh_tw
      try {
        const schedRes = await axios.get(
          `${TDX_BASE_URL}/v2/Bus/Schedule/City/${city}/${encodeURIComponent(routeName)}`,
          {
            headers,
            params: { $format: 'JSON' },
          }
        )

        // 解析班次時間
        for (const entry of schedRes.data) {
          if (entry.StopTimes) {
            for (const stop of entry.StopTimes) {
              if (stop.StopName?.Zh_tw === fromStop && stop.DepartureTime) {
                results.push({
                  routeName,
                  departureTime: stop.DepartureTime,
                })
              }
            }
          }
        }
      } catch (err) {
        console.warn(`⚠️  路線 ${routeName} 時刻表查詢失敗：${safeErrorMessage(err)}`)
      }
    }
  } else if (operator) {
    // ── 公路客運：查詢指定業者，經過 fromStop 與 toStop 的路線 ──
    const routeRes = await axios.get(
      `${TDX_BASE_URL}/v2/Bus/StopOfRoute/Intercity`,
      {
        headers,
        params: {
          $filter: `OperatorCode eq '${escapeOData(operator)}' and Stops/any(s: s/StopName/Zh_tw eq '${escapeOData(fromStop)}')`,
          $select: 'RouteUID,RouteName,Stops',
          $format: 'JSON',
        },
      }
    )

    const matchedRoutes: Array<{ RouteUID: string; RouteName: { Zh_tw: string } }> =
      routeRes.data.filter((r: any) =>
        r.Stops?.some((s: any) => s.StopName?.Zh_tw === toStop)
      )

    if (matchedRoutes.length === 0) {
      console.warn(`⚠️  找不到同時包含「${fromStop}」和「${toStop}」的公路客運路線`)
      return []
    }

    for (const route of matchedRoutes) {
      const routeName = route.RouteName.Zh_tw
      try {
        const schedRes = await axios.get(
          `${TDX_BASE_URL}/v2/Bus/Schedule/Intercity/${encodeURIComponent(routeName)}`,
          {
            headers,
            params: { $format: 'JSON' },
          }
        )

        for (const entry of schedRes.data) {
          if (entry.StopTimes) {
            for (const stop of entry.StopTimes) {
              if (stop.StopName?.Zh_tw === fromStop && stop.DepartureTime) {
                results.push({
                  routeName,
                  departureTime: stop.DepartureTime,
                })
              }
            }
          }
        }
      } catch (err) {
        console.warn(`⚠️  路線 ${routeName} 時刻表查詢失敗：${safeErrorMessage(err)}`)
      }
    }
  } else {
    throw new Error('必須提供 city（市區公車）或 operator（公路客運）其中一項')
  }

  // 排序：依出發時間升冪
  results.sort((a, b) => a.departureTime.localeCompare(b.departureTime))
  return results
}
