/**
 * EntityInjector - Injects entity context into parameter objects
 * 
 * Handles injection of entity hints like locations, person names,
 * and other contextual entities extracted from user queries.
 */
export class EntityInjector {
  /**
   * Inject entity hints into a target parameter object
   * 
   * @param target - The target parameter object to inject into
   * @param entityHints - Array of entity hint strings (locations, names, etc.)
   * @returns The modified target object with injected entity context
   */
  inject(
    target: Record<string, unknown>,
    entityHints: string[]
  ): Record<string, unknown> {
    if (!entityHints || entityHints.length === 0) {
      return target;
    }

    // Store entity hints in a dedicated context property
    target.entityContext = entityHints;

    return target;
  }

  /**
   * Inject entity hints into a new object (immutable version)
   * 
   * @param entityHints - Array of entity hints
   * @returns A new object with injected entity context
   */
  injectToNew(entityHints: string[]): Record<string, unknown> {
    return this.inject({}, entityHints);
  }
}
