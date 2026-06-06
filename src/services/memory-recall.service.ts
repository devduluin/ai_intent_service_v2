import { episodicMemoryRepository } from '../repositories/episodic-memory.repository';
import type {
  MemoryRecallInput,
  MemoryRecallItem,
  MemoryRecallMode,
  MemoryRecallResolvedQuery,
  MemoryRecallResult
} from '../types/memory-recall.types';
import type { EpisodicMemory } from '../types/episodic-memory.types';
import { appLogger } from '../utils/logger.util';

const DEFAULT_LIMIT = 3;
const MAX_LIMIT = 6;

class MemoryRecallService {
  async recall(input: MemoryRecallInput): Promise<MemoryRecallResult> {
    const resolved = this.resolveQuery(input);
    const memories = await this.fetchMemories(input, resolved);
    const items = this.filterSelfReferentialItems(
      memories.map(memory => this.toItem(memory)),
      input.query
    );

    const result: MemoryRecallResult = {
      kind: 'memory_recall',
      query: input.query,
      source: 'episodic_memory',
      range: resolved.range
        ? {
          label: resolved.range.label,
          start: resolved.range.start,
          end: resolved.range.end
        }
        : undefined,
      items,
      summary: this.buildSummary(items, resolved),
      isEmpty: items.length === 0,
      metadata: {
        itemCount: items.length,
        mode: resolved.mode,
        topic: resolved.topic
      }
    };

    appLogger.info('[MemoryRecall] Recall completed', {
      userId: input.userId,
      appName: input.appName,
      mode: resolved.mode,
      itemCount: items.length,
      hasRange: !!resolved.range
    });

    return result;
  }

  resolveQuery(input: MemoryRecallInput): MemoryRecallResolvedQuery {
    const params = input.params || {};
    const mode = this.normalizeMode(params.recall_mode);
    const limit = this.normalizeLimit(params.limit);
    const query = input.query.toLowerCase();
    const date = this.normalizeDateParam(params.date);
    const startDate = this.normalizeDateParam(params.start_date);
    const endDate = this.normalizeDateParam(params.end_date);
    const topic = this.normalizeTextParam(params.topic);

    if (startDate && endDate) {
      return {
        mode: 'range',
        limit,
        topic,
        range: this.buildRange('rentang tanggal', startDate, endDate)
      };
    }

    if (date) {
      return {
        mode: 'date',
        limit,
        topic,
        range: this.buildRange(String(params.date), date, date)
      };
    }

    const inferredDate = this.inferDateFromQuery(query);
    if (inferredDate) {
      return {
        mode: 'date',
        limit,
        topic,
        range: this.buildRange(inferredDate.label, inferredDate.date, inferredDate.date)
      };
    }

    if (mode === 'intent' || topic) {
      return {
        mode: 'intent',
        limit,
        topic
      };
    }

    if (mode === 'auto') {
      const today = this.formatDate(new Date());
      return {
        mode: 'date',
        limit,
        topic,
        range: this.buildRange('hari ini', today, today)
      };
    }

    return {
      mode: 'recent',
      limit,
      topic
    };
  }

  private async fetchMemories(
    input: MemoryRecallInput,
    resolved: MemoryRecallResolvedQuery
  ): Promise<EpisodicMemory[]> {
    if (resolved.range?.startDate && resolved.range.endDate) {
      appLogger.debug('[MemoryRecall] Fetching by date range', {
        userId: input.userId,
        appName: input.appName,
        startDate: resolved.range.startDate.toISOString(),
        endDate: resolved.range.endDate.toISOString(),
        limit: resolved.limit
      });

      const results = await episodicMemoryRepository.findByDateRange(
        input.userId,
        input.appName,
        resolved.range.startDate,
        resolved.range.endDate,
        resolved.limit
      );

      appLogger.debug('[MemoryRecall] Date range results', {
        count: results.length,
        userId: input.userId,
        appName: input.appName
      });

      // Fallback: if date range returns empty, try recent (no date filter)
      if (results.length === 0) {
        appLogger.info('[MemoryRecall] Date range empty, falling back to recent', {
          userId: input.userId,
          appName: input.appName
        });
        return episodicMemoryRepository.findByUserAndApp(
          input.userId,
          input.appName,
          resolved.limit
        );
      }

      return results;
    }

    if (resolved.mode === 'intent' && resolved.topic) {
      return episodicMemoryRepository.findRecentByTopic(
        input.userId,
        input.appName,
        resolved.topic,
        resolved.limit
      );
    }

    return episodicMemoryRepository.findByUserAndApp(
      input.userId,
      input.appName,
      resolved.limit
    );
  }

  private buildSummary(
    items: MemoryRecallItem[],
    resolved: MemoryRecallResolvedQuery
  ): string {
    if (items.length === 0) {
      if (resolved.range?.label) {
        return `Tidak ditemukan ringkasan percakapan untuk ${resolved.range.label}.`;
      }

      return 'Tidak ditemukan ringkasan percakapan sebelumnya.';
    }

    const label = resolved.range?.label || 'percakapan terakhir';
    const joined = items
      .slice(0, resolved.limit)
      .map((item, index) => `${index + 1}. ${item.summary}`)
      .join('\n');

    return `Ringkasan ${label}:\n${joined}`;
  }

  private toItem(memory: EpisodicMemory): MemoryRecallItem {
    return {
      intent: memory.intent,
      topicKey: memory.topicKey || memory.intent,
      topicLabel: memory.topicLabel || memory.topicKey || memory.intent,
      flowStage: memory.flowStage || null,
      summary: memory.summary,
      taskPlan: memory.taskPlan || memory.toolsUsed || null,
      flowTrace: memory.flowTrace || null,
      created_at: memory.created_at instanceof Date
        ? memory.created_at.toISOString()
        : new Date(memory.created_at).toISOString()
    };
  }

  private filterSelfReferentialItems(items: MemoryRecallItem[], query: string): MemoryRecallItem[] {
    const normalizedQuery = String(query || '').toLowerCase();
    const isGenericMemoryRecall = /\b(memory\s*recall|recall|riwayat|history|ingat)\b/i.test(normalizedQuery) &&
      !/\b(kemarin|hari ini|today|yesterday|\d+\s*hari|minggu|bulan|topik|bahas|tanya)\b/i.test(normalizedQuery);

    if (!isGenericMemoryRecall) {
      return items;
    }

    const filtered = items.filter(item => {
      const text = `${item.intent || ''} ${item.topicKey || ''} ${item.topicLabel || ''} ${item.summary || ''}`.toLowerCase();
      return !/\b(memory_recall|memory recall|fitur memory recall|meminta fitur memory recall)\b/i.test(text);
    });

    return filtered.length > 0 ? filtered : items;
  }

  private normalizeMode(value: unknown): MemoryRecallMode {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : 'auto';
    if (['auto', 'recent', 'date', 'range', 'intent'].includes(normalized)) {
      return normalized as MemoryRecallMode;
    }

    return 'auto';
  }

  private normalizeLimit(value: unknown): number {
    const numberValue = typeof value === 'number' ? value : Number(value || DEFAULT_LIMIT);
    if (!Number.isFinite(numberValue) || numberValue <= 0) {
      return DEFAULT_LIMIT;
    }

    return Math.min(Math.floor(numberValue), MAX_LIMIT);
  }

  private normalizeDateParam(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const normalized = value.trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
  }

  private normalizeTextParam(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }

    const normalized = value.trim();
    return normalized || undefined;
  }

  private inferDateFromQuery(query: string): { label: string; date: string } | null {
    // "X hari yang lalu" / "X days ago"
    const relativeDayMatch = query.match(/(\d+)\s*(hari|day)\s*(yang lalu|ago|lalu)/i);
    if (relativeDayMatch) {
      const days = parseInt(relativeDayMatch[1], 10);
      return {
        label: `${days} hari yang lalu`,
        date: this.formatDate(this.addDays(new Date(), -days))
      };
    }

    // "X minggu yang lalu" / "X weeks ago"
    const relativeWeekMatch = query.match(/(\d+)\s*(minggu|week|pekan)\s*(yang lalu|ago|lalu)/i);
    if (relativeWeekMatch) {
      const weeks = parseInt(relativeWeekMatch[1], 10);
      return {
        label: `${weeks} minggu yang lalu`,
        date: this.formatDate(this.addDays(new Date(), -weeks * 7))
      };
    }

    // "X bulan yang lalu" / "X months ago"
    const relativeMonthMatch = query.match(/(\d+)\s*(bulan|month)\s*(yang lalu|ago|lalu)/i);
    if (relativeMonthMatch) {
      const months = parseInt(relativeMonthMatch[1], 10);
      return {
        label: `${months} bulan yang lalu`,
        date: this.formatDate(this.addDays(new Date(), -months * 30))
      };
    }

    // "kemarin" / "yesterday"
    if (/\b(kemarin|yesterday)\b/.test(query)) {
      return {
        label: 'kemarin',
        date: this.formatDate(this.addDays(new Date(), -1))
      };
    }

    // "minggu lalu" / "last week" (without number)
    if (/\b(minggu lalu|last week|pekan lalu)\b/i.test(query)) {
      return {
        label: 'minggu lalu',
        date: this.formatDate(this.addDays(new Date(), -7))
      };
    }

    // "bulan lalu" / "last month" (without number)
    if (/\b(bulan lalu|last month)\b/i.test(query)) {
      return {
        label: 'bulan lalu',
        date: this.formatDate(this.addDays(new Date(), -30))
      };
    }

    // "hari ini" / "today"
    if (/\b(hari ini|today)\b/.test(query)) {
      return {
        label: 'hari ini',
        date: this.formatDate(new Date())
      };
    }

    return null;
  }

  private buildRange(label: string, startDate: string, endDate: string): MemoryRecallResolvedQuery['range'] {
    return {
      label,
      start: `${startDate}T00:00:00+07:00`,
      end: `${endDate}T23:59:59+07:00`,
      startDate: new Date(`${startDate}T00:00:00+07:00`),
      endDate: new Date(`${endDate}T23:59:59+07:00`)
    };
  }

  private addDays(date: Date, days: number): Date {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  }

  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}

export const memoryRecallService = new MemoryRecallService();
export { MemoryRecallService };
