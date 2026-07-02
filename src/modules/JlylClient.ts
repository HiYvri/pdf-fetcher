import { config } from "../../package.json";
import type { ItemMetadata } from "../utils/item";

export type JlylTaskRecord = {
  taskTitle: string;
  taskCode: string;
  createTime: string;
  taskStatus: number | string;
  uuid: string;
  resourceUuid: string;
  raw: Record<string, unknown>;
};

export class JlylLoginRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JlylLoginRequiredError";
  }
}

export class JlylUnexpectedResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JlylUnexpectedResponseError";
  }
}

export class JlylClient {
  private static readonly baseURL = "https://api.jlss.vip";

  static async submit(metadata: ItemMetadata) {
    const settings = this.getSettings();

    if (!settings.token) {
      throw new JlylLoginRequiredError("尚未配置聚联医疗 token。");
    }

    if (!metadata.queryText) {
      throw new JlylUnexpectedResponseError("当前条目缺少 DOI、PMID、标题和 URL。");
    }

    const response = await Zotero.HTTP.request("POST", `${this.baseURL}/search/trans`, {
      body: JSON.stringify({ content: metadata.queryText }),
      headers: {
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json",
        token: settings.token
      },
      responseType: "text",
      successCodes: false,
      timeout: 60000
    });

    if (response.status === 401 || response.status === 403) {
      throw new JlylLoginRequiredError("聚联医疗登录状态已失效。");
    }

    const data = this.parseJSON(response.responseText || "");
    if (data?.code === 501) {
      throw new JlylLoginRequiredError("聚联医疗 token 已失效。");
    }

    if (response.status < 200 || response.status >= 300 || data?.code !== 200) {
      const message = data?.msg || data?.mess || data?.message || `HTTP ${response.status}`;
      throw new JlylUnexpectedResponseError(`提交失败：${message}`);
    }

    return data;
  }

  static async listTasks(): Promise<JlylTaskRecord[]> {
    const response = await this.requestJSON("/task/myHelpList", {
      currentPage: 1,
      pageSize: 20,
      data: {
        taskStatus: "",
        startTime: "",
        endTime: ""
      }
    });
    const payload = response?.data || {};
    const rows = payload.dataList || payload.list || payload.records || [];

    if (!Array.isArray(rows)) {
      throw new JlylUnexpectedResponseError("聚联医疗任务列表格式异常。");
    }

    return rows.map((row) => ({
      taskTitle: String(row.taskTitle || ""),
      taskCode: String(row.taskCode || ""),
      createTime: String(row.createTime || ""),
      taskStatus: row.taskStatus,
      uuid: String(row.uuid || ""),
      resourceUuid: String(row.resourceUuid || ""),
      raw: row
    }));
  }

  static async getDownloadURL(record: JlylTaskRecord): Promise<string> {
    if (!record.resourceUuid || !record.uuid) {
      throw new JlylUnexpectedResponseError("聚联医疗任务缺少下载参数。");
    }

    const response = await this.requestJSON("/task/clickDownload", {
      resourceUuid: record.resourceUuid,
      uuid: record.uuid
    });
    const payload = response?.data || {};
    const signedURL = payload.data;

    if (payload.code !== 0 || !signedURL) {
      const message = payload.msg || payload.message || "未返回 PDF 下载链接";
      throw new JlylUnexpectedResponseError(`下载链接获取失败：${message}`);
    }

    return String(signedURL);
  }

  static findMatchingRecord(records: JlylTaskRecord[], metadata: ItemMetadata): JlylTaskRecord | null {
    const queryText = normalize(metadata.queryText);
    if (!queryText) {
      return null;
    }

    return records.find((record) => normalize(record.taskTitle) === queryText) || null;
  }

  private static getSettings() {
    const prefix = config.prefsPrefix;
    const token = String(Zotero.Prefs.get(`${prefix}.token`) || "").trim();
    return { token };
  }

  private static async requestJSON(path: string, body: Record<string, unknown>) {
    const settings = this.getSettings();
    if (!settings.token) {
      throw new JlylLoginRequiredError("尚未配置聚联医疗 token。");
    }

    const response = await Zotero.HTTP.request("POST", `${this.baseURL}${path}`, {
      body: JSON.stringify(body),
      headers: {
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json",
        token: settings.token
      },
      responseType: "text",
      successCodes: false,
      timeout: 60000
    });

    if (response.status === 401 || response.status === 403) {
      throw new JlylLoginRequiredError("聚联医疗登录状态已失效。");
    }

    const data = this.parseJSON(response.responseText || "");
    if (data?.code === 501) {
      throw new JlylLoginRequiredError("聚联医疗 token 已失效。");
    }

    if (response.status < 200 || response.status >= 300 || data?.code !== 200) {
      const message = data?.msg || data?.mess || data?.message || `HTTP ${response.status}`;
      throw new JlylUnexpectedResponseError(`请求失败：${message}`);
    }

    return data;
  }

  private static parseJSON(text: string) {
    try {
      return text ? JSON.parse(text) : null;
    }
    catch (_error) {
      if (/^\s*</.test(text)) {
        throw new JlylLoginRequiredError("聚联医疗返回了 HTML 页面，登录状态可能已失效。");
      }
      throw new JlylUnexpectedResponseError("聚联医疗返回了非 JSON 响应。");
    }
  }
}

function normalize(value: string): string {
  return String(value || "").trim().toLowerCase();
}
