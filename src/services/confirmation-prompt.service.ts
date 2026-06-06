import type { PendingConfirmation } from '../types/confirmation.types';
import { automationJobRepository } from '../repositories/automation-job.repository';
import {
  formatReminderInfo,
  formatConditionalAlertInfo,
  formatScheduledWorkflowInfo
} from '../utils/automation.util';
import { appLogger } from '../utils/logger.util';

export class ConfirmationPromptService {
  async buildPrompt(confirmation: PendingConfirmation | null | undefined): Promise<string> {
    if (!confirmation) {
      return 'Saya punya draft yang perlu dikonfirmasi. Mau saya simpan, ubah, atau batalkan?';
    }

    switch (confirmation.type) {
      case 'automation_job_create':
        return await this.buildAutomationPrompt(confirmation);
      case 'automation_job_delete':
        return this.buildAutomationDeletePrompt(confirmation);
      case 'tool_write':
        return this.buildToolWritePrompt(confirmation);
      case 'external_action':
        return this.buildExternalActionPrompt(confirmation);
      default:
        return this.buildGenericPrompt(confirmation);
    }
  }

  buildCreatedMessage(job: any): string {
    const runAt = job?.trigger?.runAt ? this.formatRunAt(job.trigger.runAt) : null;
    const schedule = runAt || this.formatCron(job?.trigger?.cron) || job?.trigger?.sourceText;
    const scheduleText = schedule ? `\nJadwal: ${schedule}` : '';
    const shouldShowNextRun = job?.trigger?.kind !== 'once' && job?.nextRunAt;
    const nextRun = shouldShowNextRun ? `\nEksekusi berikutnya: ${this.formatRunAt(job.nextRunAt)}` : '';
    const typeLabel = job?.type === 'conditional_alert'
      ? 'conditional alert'
      : job?.type === 'scheduled_workflow'
        ? 'scheduled workflow'
        : 'pengingat';

    if (job?.type === 'conditional_alert') {
      return [
        `Siap, ${typeLabel} sudah aktif.`,
        `Kondisi: ${job?.condition?.sourceText || job?.goal || 'sesuai draft'}.${scheduleText}${nextRun}`,
        'Saya akan mengirim notifikasi kalau kondisi tersebut terpenuhi.',
        '',
        'Berikutnya, Anda juga bisa membuat reminder atau conditional alert lain.'
      ].join('\n');
    }

    return [
      `Siap, ${typeLabel} sudah aktif.`,
      `Detail: ${job?.goal || 'sesuai draft'}.${scheduleText}${nextRun}`,
      '',
      'Berikutnya, Anda juga bisa membuat reminder atau conditional alert lain.'
    ].join('\n');
  }

  async buildAutomationPrompt(confirmation: PendingConfirmation): Promise<string> {
    const draft = confirmation.draft || {};

    const runAt = draft.trigger?.runAt ? this.formatRunAt(draft.trigger.runAt) : null;
    const schedule = runAt || this.formatCron(draft.trigger?.cron) || draft.trigger?.sourceText;
    const scheduleText = schedule ? ` dengan jadwal ${schedule}` : '';
    const pretestText = this.buildAutomationPretestText(draft);
    const typeLabel = draft.type === 'conditional_alert'
      ? 'conditional alert'
      : draft.type === 'scheduled_workflow'
        ? 'scheduled workflow'
        : draft.type === 'reminder'
          ? 'reminder'
          : 'automation';

    // ✅ Get active jobs info based on type
    let activeJobsInfo = '';
    try {
      if (confirmation.userId && confirmation.appName) {
        const jobs = await automationJobRepository.getActiveJobs(
          confirmation.userId, 
          confirmation.appName, 
          {
            type: draft.type,
            nextRunAtToday: draft.type === 'reminder',
            limit: 5
          }
        );
        
        if (jobs.length > 0) {
          const jobTitles = jobs.map((j, i) => {
          const timeStr = j.trigger?.runAt ? ' — pukul ' + new Date(j.trigger.runAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }) : '';
          return `${i + 1}. **${j.title}**${timeStr}`;
        }).join('\n');
          const jobLabel = draft.type === 'reminder' ? 'reminder' 
            : draft.type === 'conditional_alert' ? 'conditional alert'
            : 'scheduled workflow';
          
          activeJobsInfo = `**Saya melihat Anda juga punya ${jobs.length} ${jobLabel} aktif${draft.type === 'reminder' ? ' untuk hari ini' : ''}:**\n${jobTitles}\n\nAnda bisa melihat detailnya nanti melalui automation manager.`;

          // 🆕 Conflict detection for reminders (within 15 minutes)
          if (draft.type === 'reminder' && draft.trigger?.runAt) {
            const newTime = new Date(draft.trigger.runAt).getTime();
            const CONFLICT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
            const conflicts = jobs.filter(j => {
              if (!j.trigger?.runAt) return false;
              const existingTime = new Date(j.trigger.runAt).getTime();
              const diff = Math.abs(newTime - existingTime);
              return diff > 0 && diff <= CONFLICT_WINDOW_MS;
            });
            if (conflicts.length > 0) {
              const conflictNames = conflicts.map(c => `**${c.title}**`).join(', ');
              const timeStr = new Date(draft.trigger.runAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' });
              activeJobsInfo += `\n\n⚠️ **Potensi bentrok:** Reminder ini dijadwalkan pukul **${timeStr}**, ${conflicts.length > 1 ? `yang berdekatan dengan ${conflicts.length} reminder aktif` : `yang berdekatan dengan ${conflictNames}`} (dalam rentang 15 menit). Pastikan tidak tumpang tindih.`;
            }
          }
        }
      }
    } catch (error) {
      appLogger.warn('[ConfirmationPrompt] Failed to get active jobs info', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }

    const reminderOffsetText = this.buildReminderOffsetText(draft);
    const pretestFailed = draft.pretest?.status === 'no_data' || draft.pretest?.status === 'failed';

    return [
      `Saya tangkap ${typeLabel}: ${draft.goal || draft.title || 'pekerjaan ini'}${scheduleText}.`,
      pretestFailed ? '' : activeJobsInfo,
      pretestText,
      reminderOffsetText,
      this.buildConfirmationActions('menyimpan', !pretestFailed)
    ].filter(Boolean).join('\n\n');
  }

  private buildAutomationPretestText(draft: any): string {
    if (!['conditional_alert', 'scheduled_workflow'].includes(draft?.type) || !draft?.pretest) {
      return '';
    }

    const pretest = draft.pretest;
    const purpose = draft.type === 'conditional_alert'
      ? 'untuk memastikan query bisa dijalankan dan kondisi bisa dievaluasi'
      : 'untuk memastikan workflow terjadwal bisa dijalankan';

    if (pretest.status === 'success') {
      const summary = this.summarizePretestResult(pretest);
      return summary
        ? `Pretest (${purpose}):\n- Query: "${pretest.query}"\n- Status: berhasil\n- ${summary}`
        : `Pretest "${pretest.query}" berhasil dan menghasilkan data operasional.`;
    }

    if (pretest.status === 'no_data') {
      const reason = pretest.reason || 'Query tidak bisa dijalankan.';
      return `Pretest (${purpose}):\n- Query: "${pretest.query}"\n- Status: ❌ Tidak bisa dijalankan\n- Alasan: ${reason}`;
    }

    if (pretest.status === 'failed') {
      return `Pretest (${purpose}):\n- Query: "${pretest.query}"\n- Status: gagal\n- Alasan: ${pretest.reason || 'unknown error'}.`;
    }

    return '';
  }

  private buildReminderOffsetText(draft: any): string {
    if (draft?.type !== 'reminder') return '';

    const offset = draft.notification?.offsetMinutes;
    if (offset) {
      return `Catatan: pengingat akan dikirim ${offset} menit sebelumnya.`;
    }

    if (this.shouldOfferReminderOffset(draft)) {
      return 'Catatan: jika waktu tersebut adalah jadwal mulai meeting, saya juga bisa mengingatkan 15 menit sebelumnya.';
    }

    return '';
  }

  private buildAutomationDeletePrompt(confirmation: PendingConfirmation): string {
    const draft = confirmation.draft || {};
    return [
      'Konfirmasi penghapusan automation:',
      '',
      `Judul: ${draft.title || '-'}`,
      `Goal: ${draft.goal || '-'}`,
      `Tipe: ${draft.type || '-'}`,
      `Status: ${draft.status || '-'}`,
      draft.nextRunAt ? `Eksekusi berikutnya: ${draft.nextRunAt}` : '',
      '',
      '- Ketik "hapus" atau "ya hapus" untuk menghapus.',
      '- Ketik "batal" untuk membatalkan.',
      '- Ketik "exit" atau "kluar" untuk keluar dari mode automation manager.'
    ].filter(Boolean).join('\n');
  }

  private buildToolWritePrompt(confirmation: PendingConfirmation): string {
    const draft = confirmation.draft || {};
    return [
      `Saya akan menjalankan perubahan: ${draft.title || draft.summary || confirmation.commitAction.key}.`,
      'Mau saya lanjutkan, ubah, atau batalkan?'
    ].join(' ');
  }

  private buildExternalActionPrompt(confirmation: PendingConfirmation): string {
    const draft = confirmation.draft || {};
    return [
      `Saya akan menjalankan aksi eksternal: ${draft.title || draft.summary || confirmation.commitAction.key}.`,
      'Konfirmasi dulu sebelum saya lanjutkan.'
    ].join(' ');
  }

  private buildGenericPrompt(confirmation: PendingConfirmation): string {
    return [
      `Saya punya draft ${confirmation.type} yang perlu dikonfirmasi.`,
      this.buildConfirmationActions('melanjutkan')
    ].join('\n\n');
  }

  private buildConfirmationActions(saveLabel = 'menyimpan', allowSave = true): string {
    const actions = ['Konfirmasi:'];
    if (allowSave) {
      actions.push(`- Ketik "simpan" atau "ya" untuk ${saveLabel}.`);
    }
    actions.push('- Ketik "ubah ..." kalau ada yang perlu diganti.');
    actions.push('- Ketik "batalkan" untuk membatalkan.');
    return actions.join('\n');
  }

  private shouldOfferReminderOffset(draft: any): boolean {
    if (draft?.type !== 'reminder' || !draft?.trigger?.runAt || draft?.notification?.offsetMinutes) {
      return false;
    }

    const runAt = new Date(draft.trigger.runAt).getTime();
    if (!Number.isFinite(runAt)) return false;
    return runAt - Date.now() > 15 * 60 * 1000;
  }

  private formatRunAt(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('id-ID', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Jakarta'
    }).format(date);
  }

  private formatCron(value?: string): string | null {
    if (!value) return null;
    const parts = String(value).trim().split(/\s+/);
    if (parts.length !== 5) return value;

    const [minuteRaw, hourRaw, dayOfMonthRaw, , dayOfWeekRaw] = parts;
    const minute = Number(minuteRaw);
    const hour = Number(hourRaw);
    if (!Number.isInteger(minute) || !Number.isInteger(hour)) return value;

    const time = `${String(hour).padStart(2, '0')}.${String(minute).padStart(2, '0')} WIB`;
    if (dayOfMonthRaw !== '*') return `setiap tanggal ${dayOfMonthRaw} pukul ${time}`;
    if (dayOfWeekRaw !== '*') return `setiap ${this.formatDayOfWeek(dayOfWeekRaw)} pukul ${time}`;
    return `setiap hari pukul ${time}`;
  }

  private formatDayOfWeek(value: string): string {
    const days: Record<string, string> = {
      '0': 'Minggu',
      '1': 'Senin',
      '2': 'Selasa',
      '3': 'Rabu',
      '4': 'Kamis',
      '5': 'Jumat',
      '6': 'Sabtu'
    };
    return days[value] || value;
  }

  private summarizePretestResult(pretest: any): string {
    const numericSummary = this.findNumericSummary(pretest.apiResult);
    if (numericSummary) {
      return `Hasil saat ini: ${numericSummary}.`;
    }

    const response = String(pretest.naturalResponse || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!response) return '';

    const firstSentence = response.split(/(?<=[.!?])\s+/)[0] || response;
    return `Ringkasan saat ini: ${firstSentence.slice(0, 140)}${firstSentence.length > 140 ? '...' : ''}`;
  }

  private findNumericSummary(value: unknown): string | null {
    if (!value || typeof value !== 'object') return null;
    const queue: Array<{ path: string; value: unknown }> = [{ path: '', value }];
    const preferredKeys = ['exit', 'count', 'total', 'jumlah', 'qty', 'quantity'];

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || !current.value || typeof current.value !== 'object') continue;

      if (Array.isArray(current.value)) {
        if (current.value.length > 0) return `${current.value.length} record`;
        continue;
      }

      for (const [key, child] of Object.entries(current.value as Record<string, unknown>)) {
        if (typeof child === 'number' && preferredKeys.includes(key.toLowerCase())) {
          return `${key}: ${child}`;
        }
        if (child && typeof child === 'object') {
          queue.push({
            path: current.path ? `${current.path}.${key}` : key,
            value: child
          });
        }
      }
    }

    return null;
  }
}

export const confirmationPromptService = new ConfirmationPromptService();
