import type { AutomationJob } from '../../types/automation.types';

class AutomationExplainService {
  explain(job: AutomationJob): string {
    return [
      `Aturan: ${job.title}`,
      '',
      `Goal: ${job.goal}`,
      `Tipe: ${job.type}`,
      `Status: ${job.status}`,
      job.trigger?.sourceText ? `Jadwal asal: ${job.trigger.sourceText}` : null,
      job.trigger?.runAt ? `Waktu eksekusi: ${this.formatDate(job.trigger.runAt)}` : null,
      job.trigger?.cron ? `Pola cron: ${job.trigger.cron}` : null,
      job.nextRunAt ? `Eksekusi berikutnya: ${this.formatDate(job.nextRunAt)}` : null,
      '',
      job.condition
        ? [
            'Kondisi:',
            `- Sumber: ${job.condition.sourceText || '-'}`,
            `- Jenis: ${job.condition.kind || 'threshold'}`,
            `- Metric: ${job.condition.metric || '-'}`,
            `- Operator: ${job.condition.operator || '-'}`,
            `- Nilai: ${job.condition.value ?? '-'}`
          ].join('\n')
        : 'Kondisi: tidak ada. Job berjalan sesuai jadwal.',
      '',
      job.lastRunAt ? `Terakhir jalan: ${this.formatDate(job.lastRunAt)}` : 'Terakhir jalan: belum pernah.',
      job.lastError ? `Error terakhir: ${job.lastError}` : null,
      '',
      'Perintah lanjutan: "pause <nomor>", "resume <nomor>", "hapus <nomor>", atau "exit".'
    ].filter(Boolean).join('\n');
  }

  private formatDate(value: Date | string | null | undefined): string {
    if (!value) return '-';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat('id-ID', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Jakarta'
    }).format(date);
  }
}

export const automationExplainService = new AutomationExplainService();
