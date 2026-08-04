/**
 * The species the visitor is currently holding, shared across chapters.
 *
 * Three chapters draw the same animals from different angles — the camera-trap
 * ring in V, the eighty nights in VI, the abundance tail in VII — and a visitor
 * who picks out the red fox in one of them should not have to find it again in
 * the next. Chapters write here when something is selected and read here when
 * they are entered; if the name is not in a chapter's data, that chapter simply
 * opens unselected.
 *
 * Module state is the right scope: the piece is one panel showing one thing to
 * one person standing in front of it. There is no second installation to keep
 * separate, and threading a selection object through every constructor would buy
 * nothing but ceremony.
 *
 * Names are the French vernacular, which is what the overlay shows and what the
 * three datasets have in common — they share no numeric species id.
 */
class SpeciesSelection {
  private current: string | null = null;

  get name(): string | null {
    return this.current;
  }

  set(name: string | null): void {
    this.current = name;
  }

  clear(): void {
    this.current = null;
  }

  /** True when `name` is what is being held. Case- and accent-sensitive by design. */
  is(name: string): boolean {
    return this.current === name;
  }
}

export const speciesSelection = new SpeciesSelection();
