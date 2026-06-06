import type { PipelineInput } from '../../../types';
import type { PlannerOutput } from '../../../types/planner.types';
import type { ActiveOffer, OfferResolutionResult } from '../../../types/active-offer.types';
import type { WorkingMemoryData } from '../../../types/working-memory.type';
import { llmOptionResolutionService } from '../../llm-option-resolution.service';
import {
  classifyDeterministicOfferResponse,
  normalizeOfferResponseText
} from '../../../utils/offer-response-classifier.util';

export class OfferResolver {
  async resolve(input: PipelineInput, workingMemory?: WorkingMemoryData | null): Promise<OfferResolutionResult> {
    const offer = workingMemory?.activeOffer;
    if (!offer) {
      return { isOfferResponse: false };
    }

    if (offer.status !== 'active') {
      return { isOfferResponse: false, offer };
    }

    if (offer.expiresAt <= Date.now()) {
      return {
        isOfferResponse: false,
        accepted: false,
        expired: true,
        offer,
        shouldExecute: false
      };
    }

    const decision = await this.detectBooleanAnswer(input.text, offer);
    if (decision === null) {
      return { isOfferResponse: false, offer };
    }

    if (!decision) {
      return {
        isOfferResponse: true,
        accepted: false,
        offer,
        shouldExecute: false,
        message: 'Baik, penawaran sebelumnya saya abaikan.'
      };
    }

    const params = {
      ...(workingMemory?.activeEntities || {})
    };

    for (const paramName of offer.target.clearParams || []) {
      delete params[paramName];
    }

    Object.assign(params, offer.target.paramsPatch || {});

    return {
      isOfferResponse: true,
      accepted: true,
      offer,
      shouldExecute: true,
      plan: this.buildPlanFromOffer(offer),
      params
    };
  }

  private buildPlanFromOffer(offer: ActiveOffer): PlannerOutput {
    return {
      mode: 'single_step',
      chat: false,
      tasks: [
        {
          id: '1',
          resource: offer.target.resource,
          key: offer.target.key,
          depends_on: [],
          confidence: offer.confidence
        }
      ]
    };
  }

  private async detectBooleanAnswer(text: string, offer: ActiveOffer): Promise<boolean | null> {
    const normalized = normalizeOfferResponseText(text);
    const deterministicDecision = classifyDeterministicOfferResponse(text, offer);
    if (deterministicDecision !== null) return deterministicDecision;

    if (!this.shouldAskLlmForBooleanAnswer(normalized)) {
      return null;
    }

    const result = await llmOptionResolutionService.resolve({
      text,
      mode: 'boolean',
      minConfidence: 0.65,
      context: {
        purpose: 'active_offer_acceptance',
        trueMeans: 'accept and execute the active offer',
        falseMeans: 'reject or ignore the active offer'
      }
    });

    if (result.matched && typeof result.value === 'boolean') {
      return result.value;
    }

    return null;
  }

  private shouldAskLlmForBooleanAnswer(normalizedText: string): boolean {
    if (!normalizedText) return false;

    const tokens = normalizedText.split(/\s+/).filter(Boolean);
    if (tokens.length > 5) return false;

    const hasOfferActionToken = tokens.some(token =>
      [
        'ya',
        'iya',
        'iy',
        'y',
        'boleh',
        'lanjut',
        'ok',
        'oke',
        'sip',
        'gas',
        'yes',
        'tampilkan',
        'lihat',
        'jalankan',
        'buka',
        'show',
        'continue',
        'tidak',
        'tdk',
        'nggak',
        'ngga',
        'gak',
        'ga',
        'batal',
        'jangan',
        'no',
        'n'
      ].includes(token)
    );

    if (!hasOfferActionToken) return false;

    const hasNewIntentSignal = tokens.some(token =>
      [
        'buat',
        'buatkan',
        'bikin',
        'ingatkan',
        'reminder',
        'automation',
        'automasi',
        'cek',
        'cari',
        'tampilkan',
        'lihat',
        'hapus',
        'meeting',
        'laporan'
      ].includes(token)
    );

    if (hasNewIntentSignal && !tokens.some(token => ['ya', 'iya', 'iy', 'ok', 'oke', 'boleh', 'yes'].includes(token))) {
      return false;
    }

    return true;
  }
}
