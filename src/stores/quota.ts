import { defineStore } from 'pinia'
import { backend } from '../api/backend'

/**
 * CHG-012/REQ-047（iter-18 T3）：deep-research 开关可用性数据源（design-iter-18 §6）。
 *
 * research_available 为 GET /api/quota 加法字段（= 三与门判定，与 search 下发门同源
 * 一处读两用）；前端 `!== true` 保守禁用（字段缺失/异常一律不开放——不确定即禁用，铁律 5
 * 精神）。判定源为拉取时点快照非订阅（§6.3）：远端改动下一刷新点前不被感知，兜底 =
 * 发送时后端受理即拒（422 research_unavailable）。刷新时机（§6.2）：应用启动 + 设置
 * 弹窗关闭后 + 发送遇 422 后；回合正常结束不重取（可用性非回合产物）。
 */
export const useQuotaStore = defineStore('quota', {
  state: () => ({
    researchAvailable: false as boolean,
  }),
  actions: {
    async refresh() {
      try {
        const q = await backend.getQuota()
        this.researchAvailable = q.research_available === true
      } catch {
        this.researchAvailable = false // 后端不可达/字段缺失：不确定即禁用
      }
    },
  },
})
