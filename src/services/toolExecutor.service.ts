import axiosInstance from "../utils/axiosInstance";
import { Tool } from "../types";

class ToolExecutorService {

  // ======================================================
  // EXECUTE TOOL
  // ======================================================
  async execute(tool: Tool, params: Record<string, any> = {}, _data?: unknown) {

    // console.log(`Found tool for slug "${toolSlug}":`, tool);
    if (!tool) throw new Error(`Tool not found`);

    // 2️⃣ BUILD REQUEST
    const url = this.injectPathParams(tool.url, params);
    const headers = this.buildHeaders(tool);
    const body = this.buildBody(tool, params);
    const query = this.buildQueryParams(tool, params);

    const config = {
      method: tool.method,
      url,
      headers,
      params: query,
      data: body,
      timeout: 15000, // default tool timeout 15s
    };

    try {
      const response = await this.retryRequest(config);
      return {
        success: true,
        tool: tool.slug,
        status: response.status,
        data: response.data,
      };

    } catch (err: any) {
      return {
        success: false,
        tool: tool.slug,
        error: err.message,
      };
    }
  }

  // ======================================================
  // Inject {param} ke PATH URL
  // ======================================================
  private injectPathParams(url: string, params: any) {
    return url.replace(/{(.*?)}/g, (_, key) => {
      // if (!params[key]) throw new Error(`Missing param: ${key}`);
      return encodeURIComponent(params[key]);
    });
  }

  // ======================================================
  // Query params (sisa params yg tidak dipakai path/body)
  // ======================================================
  private buildQueryParams(tool: any, params: any) {
    const query: any = {};
    const schema = tool.params_schema || {};

    for (const key of Object.keys(params)) {
      if (!tool.url.includes(`{${key}}`) && !this.isBodyParam(tool, key)) {
        query[key] = params[key];
      }
    }

    return Object.keys(query).length ? query : undefined;
  }

  private isBodyParam(tool: any, key: string) {
    if (!tool.body_template) return false;
    return JSON.stringify(tool.body_template).includes(`\${${key}}`);
  }

  // ======================================================
  // HEADERS + AUTH
  // ======================================================
  private buildHeaders(tool: any) {
    let headers: any = tool.headers || {};

    if (tool.auth_type === "bearer") {
      headers.Authorization = `Bearer ${process.env.TOOL_BEARER_TOKEN}`;
    }

    if (tool.auth_type === "api_key") {
      headers["x-api-key"] = process.env.TOOL_API_KEY;
    }

    return headers;
  }

  // ======================================================
  // BODY TEMPLATE
  // ======================================================
  private buildBody(tool: any, params: any) {
    if (!tool.body_template) return undefined;

    const template = JSON.stringify(tool.body_template);

    const filled = template.replace(/\${(.*?)}/g, (_, key) => {
      return params[key] ?? "";
    });

    return JSON.parse(filled);
  }

  // ======================================================
  // RETRY (important for flaky APIs)
  // ======================================================
  private async retryRequest(config: any, retries = 2): Promise<any> {
      try {
        // Merge header accept json dengan config yang ada
        const configWithHeaders = {
          ...config,
          headers: {
            'Accept': 'application/json',
            ...(config.headers || {})
          }
        };
        
        return await axiosInstance(configWithHeaders);
      } catch (err) {
        if (retries === 0) throw err;
        return this.retryRequest(config, retries - 1);
      }
  }
}

export const toolExecutorService = new ToolExecutorService();
