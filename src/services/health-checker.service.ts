import axios from 'axios'
import { ToolModel } from '../database/models'

export class HealthCheckerService {
  /**
   * Pings all active tools to check their health status.
   * Note: This is a basic implementation that expects a 200-299 status code.
   * Since some APIs require specific parameters or auth, this might return 400/401
   * which could still mean the service is "reachable" but requires auth.
   */
  async checkAllTools() {
    const tools: any = await ToolModel.findAll({ where: { isActive: true } })
    const results = []

    for (const tool of tools) {
      // Clean up the URL by stripping {employee_id} and other variables for the ping test
      const baseUrl = tool.url.split('?')[0].replace(/{.*?}/g, '')

      try {
        const start = Date.now()
        // Use a HEAD request to be lightweight, or GET if HEAD is unsupported
        const response = await axios.head(baseUrl, { timeout: 5000 })
        const latency = Date.now() - start

        results.push({
          toolId: tool.id,
          name: tool.name,
          slug: tool.slug,
          status: 'ok',
          statusCode: response.status,
          latencyMs: latency,
        })
      } catch (error: any) {
        // If it's a 4xx error (like 401 Unauthorized or 400 Bad Request), 
        // the server is actually responding, so it's not strictly "down".
        const statusCode = error.response?.status
        const isReachable = statusCode ? true : false

        results.push({
          toolId: tool.id,
          name: tool.name,
          slug: tool.slug,
          status: isReachable ? 'warning' : 'down',
          statusCode: statusCode || 'NETWORK_ERROR',
          message: error.message,
        })
      }
    }

    return results
  }
}

export const healthCheckerService = new HealthCheckerService()
