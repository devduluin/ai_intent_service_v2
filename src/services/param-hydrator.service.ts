class ParamHydratorService {

  hydrate(
    extracted: Record<string, unknown> | undefined,
    attributes?: any
  ): Record<string, unknown> {

    const fromExtractor = extracted ?? {}
    const fromAttributes = attributes?.params ?? {}
    const fromRootAttributes: Record<string, unknown> = {}

    if (attributes?.company_id) {
      fromRootAttributes.company_id = attributes.company_id
    }

    // priority: attributes > extractor
    const merged = {
      ...fromExtractor,
      ...fromAttributes,
      ...fromRootAttributes,
    }

    // remove undefined/null/"null"
    const cleaned: Record<string, unknown> = {}

    for (const [k, v] of Object.entries(merged)) {
      if (v !== undefined && v !== null && v !== 'null') {
        cleaned[k] = v
      }
    }

    // console.log('[ParamHydrator] Final params:', cleaned)

    return cleaned
  }

}

export const paramHydratorService = new ParamHydratorService()