import type { PipelineInput, PipelineResult } from '../types';
import type { AutomationJob } from '../types/automation.types';
import { automationJobRepository } from '../repositories/automation-job.repository';
import { confirmationStateService } from './confirmation-state.service';
import { globalCache } from '../utils/cache-helper.util';
import { PipelineFormatter } from '../utils/pipeline-formatter.util';
import { isExitModeText } from '../utils/text-intent-cleanup.util';
import { calculateNextRunFromCron } from '../utils/cron.util';
import { automationExplainService } from './automation/automation-explain.service';
import { getDisplayNameFromInput } from '../utils/user-display-name.util';

const TTL_MS = 5 * 60 * 1000;

export interface AutomationModeState {
  active: true;
  enteredAt: number;
  lastAction?: string;
  deleteCandidates?: Array<{
    id: string;
    title: string;
    goal: string;
  }>;
}

class AutomationModeService {
  async get(userId: string, appName: string): Promise<AutomationModeState | null> {
    return globalCache.get<AutomationModeState>(this.key(userId, appName), {
      redisKey: this.key(userId, appName)
    });
  }

  async enter(userId: string, appName: string): Promise<void> {
    const existing = await this.get(userId, appName);
    await globalCache.set(this.key(userId, appName), {
      active: true,
      enteredAt: existing?.enteredAt || Date.now(),
      lastAction: existing?.lastAction,
      deleteCandidates: existing?.deleteCandidates
    }, {
      ttl: TTL_MS,
      redisKey: this.key(userId, appName)
    });
  }

  async exit(userId: string, appName: string): Promise<void> {
    await globalCache.del(this.key(userId, appName), {
      redisKey: this.key(userId, appName)
    });
  }

  isEnterIntent(text: string): boolean {
    const normalized = this.normalize(text);
    return normalized === '/automation manager' ||
      normalized === '/automation' ||
      normalized === '/automasi';
  }

  isExitIntent(text: string): boolean {
    return isExitModeText(text, ['automation', 'automation manager']);
  }

  isDeleteIntent(text: string): boolean {
    return /^(hapus|delete|remove|batalkan)\b/i.test(this.normalize(text));
  }

  isPauseIntent(text: string): boolean {
    return /^(pause|jeda|nonaktifkan|matikan|stop)\b/i.test(this.normalize(text));
  }

  isResumeIntent(text: string): boolean {
    return /^(resume|lanjutkan|aktifkan|nyalakan)\b/i.test(this.normalize(text));
  }

  isExplainIntent(text: string): boolean {
    return /^(jelaskan|explain|kenapa|aturan|detail)\b/i.test(this.normalize(text));
  }

  async handle(input: PipelineInput, startTotal: number): Promise<PipelineResult> {
    const text = input.text || '';
    const userName = getDisplayNameFromInput(input);

    if (this.isExitIntent(text)) {
      await this.exit(input.user_id, input.app_name);
      return PipelineFormatter.buildEarly({
        intent: 'automation_mode_exit',
        score: 1,
        message: `${userName ? `Terimakasih ${userName}` : ''}, Mode automation manager sudah ditutup, sekarang anda bisa melanjutkan aktifitas lain. 😊`
      }, startTotal);
    }

    await this.enter(input.user_id, input.app_name);

    if (this.isDeleteCandidateSelection(text)) {
      return this.handleDeleteCandidateSelection(input, startTotal);
    }

    if (this.isDeleteIntent(text)) {
      return this.handleDelete(input, startTotal);
    }

    if (this.isPauseIntent(text)) {
      return this.handlePause(input, startTotal);
    }

    if (this.isResumeIntent(text)) {
      return this.handleResume(input, startTotal);
    }

    if (this.isExplainIntent(text)) {
      return this.handleExplain(input, startTotal);
    }

    return this.handleList(input, startTotal);
  }

  async handleList(input: PipelineInput, startTotal: number): Promise<PipelineResult> {
    const allJobs = await automationJobRepository.findByUserAndApp(input.user_id, input.app_name, {
      limit: 20
    });
    const jobs = this.getVisibleJobs(allJobs);
    await this.setDeleteCandidates(input.user_id, input.app_name, jobs);

    return PipelineFormatter.buildEarly({
      intent: 'automation_manager_list',
      score: 1,
      message: this.formatList(jobs)
    }, startTotal);
  }

  private async handleDelete(input: PipelineInput, startTotal: number): Promise<PipelineResult> {
    const query = this.extractDeleteQuery(input.text);
    const allJobs = await automationJobRepository.findByUserAndApp(input.user_id, input.app_name, {
      limit: 30
    });
    const jobs = this.getVisibleJobs(allJobs);
    const candidates = this.findDeleteCandidates(jobs, query);

    if (candidates.length === 0) {
      return PipelineFormatter.buildEarly({
        intent: 'automation_delete_not_found',
        score: 0.7,
        message: [
          `Saya belum menemukan automation yang cocok untuk "${query || input.text}".`,
          '',
          'Daftar automation saat ini:',
          this.formatJobs(jobs.slice(0, 10)),
          '',
          'Ketik "exit" atau "kluar" untuk keluar dari mode automation manager.'
        ].join('\n')
      }, startTotal);
    }

    if (candidates.length > 1) {
      await this.setDeleteCandidates(input.user_id, input.app_name, candidates);
      return PipelineFormatter.buildEarly({
        intent: 'automation_delete_ambiguous',
        score: 0.8,
        message: [
          'Saya menemukan beberapa automation yang mirip. Pilih nomor yang ingin dihapus:',
          '',
          this.formatJobs(candidates.slice(0, 10)),
          '',
          'Contoh: "hapus 1" atau cukup ketik "1".',
          'Ketik "exit" atau "kluar" untuk keluar dari mode automation manager.'
        ].join('\n')
      }, startTotal);
    }

    const job = candidates[0];
    return this.confirmDelete(input, startTotal, job);
  }

  private async handlePause(input: PipelineInput, startTotal: number): Promise<PipelineResult> {
    const job = await this.resolveJobFromCommand(input, this.extractActionQuery(input.text, ['pause', 'jeda', 'nonaktifkan', 'matikan', 'stop']));
    if (!job) {
      return PipelineFormatter.buildEarly({
        intent: 'automation_pause_not_found',
        score: 0.6,
        message: [
          'Saya belum menemukan automation yang akan di-pause.',
          '',
          'Gunakan format: "pause <nomor/judul>". Contoh: "pause 1".'
        ].join('\n')
      }, startTotal);
    }

    const updated = await automationJobRepository.pauseById(job.id);
    return PipelineFormatter.buildEarly({
      intent: updated ? 'automation_job_paused' : 'automation_pause_failed',
      score: updated ? 1 : 0.3,
      message: updated
        ? [
            'Automation sudah saya pause.',
            '',
            `Judul: ${updated.title}`,
            `Goal: ${updated.goal}`,
            '',
            'Gunakan "resume <nomor/judul>" untuk mengaktifkan lagi.'
          ].join('\n')
        : 'Automation gagal di-pause.'
    }, startTotal);
  }

  private async handleResume(input: PipelineInput, startTotal: number): Promise<PipelineResult> {
    const job = await this.resolveJobFromCommand(input, this.extractActionQuery(input.text, ['resume', 'lanjutkan', 'aktifkan', 'nyalakan']));
    if (!job) {
      return PipelineFormatter.buildEarly({
        intent: 'automation_resume_not_found',
        score: 0.6,
        message: [
          'Saya belum menemukan automation yang akan diaktifkan lagi.',
          '',
          'Gunakan format: "resume <nomor/judul>". Contoh: "resume 1".'
        ].join('\n')
      }, startTotal);
    }

    const nextRunAt = this.resolveNextRunAt(job);
    const updated = await automationJobRepository.resumeById(job.id, nextRunAt);
    return PipelineFormatter.buildEarly({
      intent: updated ? 'automation_job_resumed' : 'automation_resume_failed',
      score: updated ? 1 : 0.3,
      message: updated
        ? [
            'Automation sudah aktif lagi.',
            '',
            `Judul: ${updated.title}`,
            `Goal: ${updated.goal}`,
            `Eksekusi berikutnya: ${updated.nextRunAt ? this.formatDate(updated.nextRunAt) : '-'}`
          ].join('\n')
        : 'Automation gagal diaktifkan lagi.'
    }, startTotal);
  }

  private async handleExplain(input: PipelineInput, startTotal: number): Promise<PipelineResult> {
    const job = await this.resolveJobFromCommand(input, this.extractActionQuery(input.text, ['jelaskan', 'explain', 'kenapa', 'aturan', 'detail']));
    if (!job) {
      return PipelineFormatter.buildEarly({
        intent: 'automation_explain_not_found',
        score: 0.6,
        message: [
          'Saya belum menemukan automation yang ingin dijelaskan.',
          '',
          'Gunakan format: "jelaskan <nomor/judul>". Contoh: "jelaskan 1".'
        ].join('\n')
      }, startTotal);
    }

    return PipelineFormatter.buildEarly({
      intent: 'automation_rule_explained',
      score: 1,
      message: automationExplainService.explain(job)
    }, startTotal);
  }

  private async handleDeleteCandidateSelection(input: PipelineInput, startTotal: number): Promise<PipelineResult> {
    const state = await this.get(input.user_id, input.app_name);
    const selectedNumber = this.extractSelectionNumber(input.text);
    let candidate = selectedNumber && state?.deleteCandidates?.[selectedNumber - 1];

    if (!candidate && selectedNumber) {
      const allJobs = await automationJobRepository.findByUserAndApp(input.user_id, input.app_name, {
        limit: 20
      });
      const jobs = this.getVisibleJobs(allJobs);
      await this.setDeleteCandidates(input.user_id, input.app_name, jobs);
      candidate = jobs[selectedNumber - 1];
    }

    if (!candidate) {
      return PipelineFormatter.buildEarly({
        intent: 'automation_delete_selection_invalid',
        score: 0.6,
        message: [
          'Nomor pilihan tidak valid atau daftar kandidat sudah kedaluwarsa.',
          'Ketik ulang "hapus <judul/goal>" atau "exit" untuk keluar dari mode automation manager.'
        ].join('\n')
      }, startTotal);
    }

    const job = await automationJobRepository.findById(candidate.id);
    if (!job) {
      return PipelineFormatter.buildEarly({
        intent: 'automation_delete_not_found',
        score: 0.5,
        message: 'Automation yang dipilih tidak ditemukan lagi.'
      }, startTotal);
    }

    return this.confirmDelete(input, startTotal, job);
  }

  private async confirmDelete(input: PipelineInput, startTotal: number, job: AutomationJob): Promise<PipelineResult> {
    await confirmationStateService.set(input.user_id, input.app_name, {
      type: 'automation_job_delete',
      draft: {
        jobId: job.id,
        title: job.title,
        goal: job.goal,
        type: job.type,
        status: job.status,
        nextRunAt: job.nextRunAt,
        trigger: job.trigger,
        condition: job.condition
      },
      editableFields: [],
      commitAction: {
        resource: 'skill',
        key: 'automation_manager',
        params: {
          _delete: true,
          jobId: job.id
        }
      },
      ttlMs: 60 * 1000
    });

    return PipelineFormatter.buildEarly({
      intent: 'automation_delete_confirmation',
      score: 1,
      message: [
        'Saya temukan automation berikut:',
        '',
        `Judul: ${job.title}`,
        `Goal: ${job.goal}`,
        `Tipe: ${job.type}`,
        `Status: ${job.status}`,
        `Dibuat: ${this.formatDate(job.createdAt)}`,
        job.nextRunAt ? `Eksekusi berikutnya: ${this.formatDate(job.nextRunAt)}` : '',
        '',
        'Ketik "hapus" atau "ya hapus" untuk menghapus.',
        'Ketik "batal" untuk membatalkan.',
      ].filter(Boolean).join('\n')
    }, startTotal);
  }

  formatList(jobs: AutomationJob[]): string {
    if (jobs.length === 0) {
      return [
        'Belum ada automation yang tersimpan.',
        '',
        'Anda bisa membuat reminder, scheduled workflow, atau conditional alert.',
        'Ketik "exit" atau "kluar" untuk keluar dari mode automation manager.'
      ].join('\n');
    }

    return [
      'Daftar automation manager:',
      '',
      this.formatJobs(jobs),
      '',
      'Perintah:',
      '- "hapus <nomor>" untuk menghapus automation.',
      '- "pause <nomor>" untuk menjeda automation.',
      '- "resume <nomor>" untuk mengaktifkan lagi.',
      '- "jelaskan <nomor>" untuk melihat detail rule.',
      '- Ketik "exit" atau "kluar" untuk keluar dari mode automation manager.'
    ].join('\n');
  }

  private formatJobs(jobs: AutomationJob[]): string {
    if (jobs.length === 0) return '- Tidak ada data.';
    const rows = jobs.map((job, index) => [
      String(index + 1),
      this.tableCell(job.title, 46),
      this.tableCell(job.goal, 52),
      this.tableCell(job.type, 24),
      this.tableCell(job.status, 14),
      this.tableCell(this.formatDate(job.createdAt), 24),
      this.tableCell(job.nextRunAt ? this.formatDate(job.nextRunAt) : '-', 24)
    ]);

    return [
      '| No | Judul | Goal | Tipe | Status | Dibuat | Eksekusi berikutnya |',
      '|---:|---|---|---|---|---|---|',
      ...rows.map(row => `| ${row.join(' | ')} |`)
    ].join('\n');
  }

  private findDeleteCandidates(jobs: AutomationJob[], query: string): AutomationJob[] {
    const normalizedQuery = this.normalize(query);
    const activeJobs = this.getDeletableJobs(jobs);
    if (!normalizedQuery) return [];

    return activeJobs.filter(job => {
      const haystack = this.normalize(`${job.title} ${job.goal} ${job.type} ${job.condition?.sourceText || ''}`);
      return haystack.includes(normalizedQuery) ||
        normalizedQuery.split(/\s+/).filter(token => token.length >= 3).every(token => haystack.includes(token));
    });
  }

  private extractDeleteQuery(text: string): string {
    return this.normalize(text)
      .replace(/^(hapus|delete|remove|batalkan)\s+/i, '')
      .replace(/\b(automation|automasi|reminder|jadwal|schedule|pengecekan)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private extractActionQuery(text: string, verbs: string[]): string {
    const escaped = verbs.map(verb => verb.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    return this.normalize(text)
      .replace(new RegExp(`^(?:${escaped})\\s+`, 'i'), '')
      .replace(/\b(automation|automasi|reminder|jadwal|schedule|rule|aturan)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private async resolveJobFromCommand(input: PipelineInput, query: string): Promise<AutomationJob | null> {
    const allJobs = await automationJobRepository.findByUserAndApp(input.user_id, input.app_name, {
      limit: 30
    });
    const jobs = this.getVisibleJobs(allJobs);
    await this.setDeleteCandidates(input.user_id, input.app_name, jobs);

    const number = this.extractSelectionNumber(query || input.text);
    if (number) return jobs[number - 1] || null;

    const normalizedQuery = this.normalize(query);
    if (!normalizedQuery) return null;

    const matches = jobs.filter(job => {
      const haystack = this.normalize(`${job.title} ${job.goal} ${job.type} ${job.condition?.sourceText || ''}`);
      return haystack.includes(normalizedQuery) ||
        normalizedQuery.split(/\s+/).filter(token => token.length >= 3).every(token => haystack.includes(token));
    });

    return matches.length === 1 ? matches[0] : null;
  }

  private resolveNextRunAt(job: AutomationJob): Date | string | null {
    if (job.trigger.kind === 'once') {
      if (!job.trigger.runAt) return null;
      const runAt = new Date(job.trigger.runAt);
      return runAt > new Date() ? job.trigger.runAt : null;
    }

    if (job.trigger.cron) {
      return calculateNextRunFromCron(job.trigger.cron);
    }

    return job.nextRunAt || null;
  }

  private getDeletableJobs(jobs: AutomationJob[]): AutomationJob[] {
    return jobs.filter(job => job.status !== 'cancelled' && job.status !== 'completed');
  }

  private getVisibleJobs(jobs: AutomationJob[]): AutomationJob[] {
    return jobs.filter(job => job.status !== 'cancelled' && job.status !== 'completed');
  }

  private isDeleteCandidateSelection(text: string): boolean {
    return this.extractSelectionNumber(text) !== null;
  }

  private extractSelectionNumber(text: string): number | null {
    const normalized = this.normalize(text);
    const match = normalized.match(/^(?:hapus\s+)?(\d{1,2})$/);
    if (!match) return null;
    const number = Number(match[1]);
    return Number.isInteger(number) && number > 0 ? number : null;
  }

  private async setDeleteCandidates(userId: string, appName: string, jobs: AutomationJob[]): Promise<void> {
    const current = await this.get(userId, appName);
    await globalCache.set(this.key(userId, appName), {
      active: true,
      enteredAt: current?.enteredAt || Date.now(),
      lastAction: 'delete_ambiguous',
      deleteCandidates: jobs.slice(0, 10).map(job => ({
        id: job.id,
        title: job.title,
        goal: job.goal
      }))
    }, {
      ttl: TTL_MS,
      redisKey: this.key(userId, appName)
    });
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

  private tableCell(value: unknown, maxLength: number): string {
    const text = String(value ?? '-')
      .replace(/\s+/g, ' ')
      .replace(/\|/g, '/')
      .trim() || '-';

    if (text.length <= maxLength) return text;
    return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}...`;
  }

  private normalize(text: string): string {
    return String(text || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}/\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private key(userId: string, appName: string): string {
    return `automation-mode:${appName}:${userId}`;
  }
}

export const automationModeService = new AutomationModeService();
