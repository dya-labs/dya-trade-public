import { fireEvent, render, screen, act } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import * as React from 'react';
const mounts=vi.hoisted(()=>({count:0}));
vi.mock('@/components/near/terminal',()=>({NearTerminal:({view}:{view:string})=>{const [id]=React.useState(()=>++mounts.count);return <div data-testid="terminal" data-mount={id}><span>{view}</span><a href="/">Trade page</a><a href="/portfolio">Portfolio page</a><a href="/portfolio" target="_blank">New tab</a></div>;}}));
import { TerminalRoute } from '@/components/terminal-route';
it('keeps the Terminal mounted during navigation and popstate',()=>{
  window.history.replaceState(null,'','/');vi.spyOn(window,'scrollTo').mockImplementation(()=>{});
  render(<TerminalRoute/>);const initial=screen.getByTestId('terminal').getAttribute('data-mount');
  fireEvent.click(screen.getByText('Portfolio page'));expect(window.location.pathname).toBe('/portfolio');expect(screen.getByText('portfolio')).toBeVisible();
  expect(screen.getByTestId('terminal')).toHaveAttribute('data-mount',initial);
  act(()=>{window.history.replaceState(null,'','/');window.dispatchEvent(new PopStateEvent('popstate'));});
  expect(screen.getByText('trade')).toBeVisible();expect(screen.getByTestId('terminal')).toHaveAttribute('data-mount',initial);
  vi.restoreAllMocks();
});
