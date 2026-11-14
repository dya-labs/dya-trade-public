import { useEffect, useState } from "react";
import { NearTerminal } from "./near/terminal";

/** Keep the Terminal and its providers mounted across the two Terminal pages. */
export function TerminalRoute() {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const update = () => setPath(window.location.pathname);
    const navigate = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(link instanceof HTMLAnchorElement) || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
      const url = new URL(link.href);
      if (url.origin !== window.location.origin || !['/', '/portfolio'].includes(url.pathname) || url.hash) return;
      event.preventDefault();
      if (url.href !== window.location.href) window.history.pushState(null, '', url);
      update();
      window.scrollTo(0, 0);
    };
    window.addEventListener('popstate', update);
    document.addEventListener('click', navigate);
    return () => { window.removeEventListener('popstate', update); document.removeEventListener('click', navigate); };
  }, []);
  return <NearTerminal view={path.replace(/\/$/, '') === '/portfolio' ? 'portfolio' : 'trade'}/>;
}
