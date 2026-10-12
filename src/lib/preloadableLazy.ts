import { createElement, lazy, useState, type ComponentType } from "react";

export type PreloadableLazyComponent<P extends object> = ComponentType<P> & {
  preload: () => Promise<{ default: ComponentType<P> }>;
};

/**
 * React.lazy with a `preload()` that can fetch the chunk ahead of first use.
 * After a successful load new mounts render the module synchronously, without
 * a Suspense fallback. A mounted instance keeps the component type it started
 * with, so finishing a load never remounts an open panel. A failed load stays
 * failed for the shared lazy wrapper (so it reaches the error boundary instead
 * of retrying in a render loop), while a later preload() may try again.
 */
export function preloadableLazy<P extends object>(
  loader: () => Promise<{ default: ComponentType<P> }>,
): PreloadableLazyComponent<P> {
  let loaded: ComponentType<P> | null = null;
  let pending: Promise<{ default: ComponentType<P> }> | null = null;

  const preload = () => {
    if (!pending) {
      pending = loader().then(
        (module) => {
          loaded = module.default;
          return module;
        },
        (error: unknown) => {
          pending = null;
          throw error;
        },
      );
    }
    return pending;
  };

  const LazyComponent = lazy(preload);

  function PreloadableComponent(props: P) {
    const [Component] = useState<ComponentType<P>>(
      () => loaded ?? (LazyComponent as unknown as ComponentType<P>),
    );
    return createElement(Component, props);
  }

  return Object.assign(PreloadableComponent, { preload });
}
