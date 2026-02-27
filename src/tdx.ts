import axios, { AxiosError } from 'axios'
import dayjs from 'dayjs'
import { env } from './config.js'

const TDX_AUTH_URL = 'https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token'
const TDX_BASE_URL = 'https://tdx.transportdata.tw/api/basic'

let cachedToken: { value: string; expiresAt: number } | null = null

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

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

/** Haversine 距離（km） */
function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/** 將 HH:mm 加上分鐘數，回傳 HH:mm */
function addMinutes(time: string, mins: number): string {
  const [h, m] = time.split(':').map(Number)
  const total = h * 60 + m + mins
  const hh = String(Math.floor(total / 60) % 24).padStart(2, '0')
  const mm = String(total % 60).padStart(2, '0')
  return `${hh}:${mm}`
}

/** TDX 公車時刻表（單一班次） */
export interface BusScheduleItem {
  routeName: string
  departureTime: string     // HH:mm（第一站發車時間）
  arrivalAtFromStop?: string // HH:mm（預計抵達起始站時間）
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

    // 過濾：同一路線也要包含 toStop，並去重（去回程各一條，只需查一次時刻表）
    const seen = new Set<string>()
    const matchedRoutes: Array<{ RouteUID: string; RouteName: { Zh_tw: string }; Stops: any[] }> =
      routeRes.data.filter((r: any) => {
        if (!r.Stops?.some((s: any) => s.StopName?.Zh_tw === toStop)) return false
        if (seen.has(r.RouteName.Zh_tw)) return false
        seen.add(r.RouteName.Zh_tw)
        return true
      })

    if (matchedRoutes.length === 0) {
      console.warn(`⚠️  找不到同時包含「${fromStop}」和「${toStop}」的市區公車路線`)
      return []
    }

    // 計算每條路線從第一站到 fromStop 的估計行駛分鐘（依站點座標距離，平均 25 km/h）
    const routeTravelMins: Record<string, number> = {}
    for (const r of matchedRoutes) {
      const stops: any[] = r.Stops || []
      const newpoIdx = stops.findIndex((s: any) => s.StopName?.Zh_tw === fromStop)
      if (newpoIdx <= 0) { routeTravelMins[r.RouteName.Zh_tw] = 0; continue }
      let dist = 0
      for (let i = 0; i < newpoIdx; i++) {
        const a = stops[i].StopPosition
        const b = stops[i + 1].StopPosition
        if (a && b) dist += haversine(a.PositionLat, a.PositionLon, b.PositionLat, b.PositionLon)
      }
      routeTravelMins[r.RouteName.Zh_tw] = Math.round(dist / 25 * 60)
    }

    // 取得每條路線的時刻表
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    const targetDayKey = dayNames[targetDate.day()]

    for (const route of matchedRoutes) {
      const routeName = route.RouteName.Zh_tw
      const travelMins = routeTravelMins[routeName] ?? 0
      await sleep(600)
      try {
        const schedRes = await axios.get(
          `${TDX_BASE_URL}/v2/Bus/Schedule/City/${city}/${encodeURIComponent(routeName)}`,
          {
            headers,
            params: { $format: 'JSON' },
          }
        )

        for (const entry of schedRes.data) {
          if (!entry.Timetables) continue
          for (const timetable of entry.Timetables) {
            if (!timetable.ServiceDay?.[targetDayKey]) continue
            const firstStop = timetable.StopTimes?.[0]
            if (firstStop?.DepartureTime) {
              results.push({
                routeName,
                departureTime: firstStop.DepartureTime,
                arrivalAtFromStop: travelMins > 0 ? addMinutes(firstStop.DepartureTime, travelMins) : undefined,
              })
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

    const dayNames2 = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    const targetDayKey2 = dayNames2[targetDate.day()]

    for (const route of matchedRoutes) {
      const routeName = route.RouteName.Zh_tw
      await sleep(600)
      try {
        const schedRes = await axios.get(
          `${TDX_BASE_URL}/v2/Bus/Schedule/Intercity/${encodeURIComponent(routeName)}`,
          {
            headers,
            params: { $format: 'JSON' },
          }
        )

        for (const entry of schedRes.data) {
          if (!entry.Timetables) continue
          for (const timetable of entry.Timetables) {
            if (!timetable.ServiceDay?.[targetDayKey2]) continue
            const firstStop = timetable.StopTimes?.[0]
            if (firstStop?.DepartureTime) {
              results.push({
                routeName,
                departureTime: firstStop.DepartureTime,
              })
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

  // 只保留 06:00 ~ 08:00 的班次
  return results.filter(r => r.departureTime >= '06:00' && r.departureTime <= '08:00')
}
