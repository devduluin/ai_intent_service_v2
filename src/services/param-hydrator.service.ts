class ParamHydratorService {

  hydrate(
    extracted: Record<string, unknown> | undefined,
    attributes?: any
  ): Record<string, unknown> {

    const fromExtractor = extracted ?? {}
    const fromAttributes = attributes?.params ?? {}

    // priority: attributes > extractor
    const merged = {
      ...fromExtractor,
      ...fromAttributes,
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