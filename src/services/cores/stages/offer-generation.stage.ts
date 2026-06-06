import { offerGenerationService, type OfferGenerationContext, type OfferGenerationResult } from '../../offer-generation.service';
import { appLogger } from '../../../utils/logger.util';

export class OfferGenerationStage {
  async execute(context: OfferGenerationContext): Promise<OfferGenerationResult> {
    const result = await offerGenerationService.generate(context);

    appLogger.debug('[OfferGenerationStage] Offer generation completed', {
      userId: context.input.user_id,
      appName: context.input.app_name,
      offersCount: result.offers.length,
      selectedOffer: result.selectedOffer
        ? {
            id: result.selectedOffer.id,
            type: result.selectedOffer.type,
            label: result.selectedOffer.label,
            target: result.selectedOffer.target,
            confidence: result.selectedOffer.confidence
          }
        : null
    });

    return result;
  }
}
