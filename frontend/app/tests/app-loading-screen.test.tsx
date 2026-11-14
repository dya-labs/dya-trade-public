import {act,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {AppLoadingScreen} from '@dya/ui/components/app-loading-screen';
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();});
it('stays absent when initially ready',()=>{render(<AppLoadingScreen active={false}/>);expect(screen.queryByRole('status')).toBeNull();});
it('starts exiting immediately on readiness and reveals after exactly 200ms',()=>{vi.useFakeTimers();const done=vi.fn();const view=render(<AppLoadingScreen active label="Loading access" onExitComplete={done}/>);view.rerender(<AppLoadingScreen active={false} label="Loading access" onExitComplete={done}/>);expect(view.container.firstChild).toHaveAttribute('data-phase','exit');act(()=>vi.advanceTimersByTime(199));expect(view.container).not.toBeEmptyDOMElement();expect(done).not.toHaveBeenCalled();act(()=>vi.advanceTimersByTime(1));expect(view.container).toBeEmptyDOMElement();expect(done).toHaveBeenCalledOnce();});
it('holds after the entrance when loading is slow and exits as soon as ready',()=>{vi.useFakeTimers();const view=render(<AppLoadingScreen active/>);act(()=>vi.advanceTimersByTime(5000));expect(view.container.firstChild).toHaveAttribute('data-phase','hold');expect(screen.getByRole('status')).toBeVisible();view.rerender(<AppLoadingScreen active={false}/>);expect(view.container.firstChild).toHaveAttribute('data-phase','exit');act(()=>vi.advanceTimersByTime(200));expect(view.container).toBeEmptyDOMElement();});
it('cancels an exit if access becomes pending again',()=>{vi.useFakeTimers();const view=render(<AppLoadingScreen active/>);act(()=>vi.advanceTimersByTime(900));view.rerender(<AppLoadingScreen active={false}/>);act(()=>vi.advanceTimersByTime(100));view.rerender(<AppLoadingScreen active/>);act(()=>vi.advanceTimersByTime(400));expect(screen.getByRole('status',{name:'Loading app'})).toBeVisible();});
it('skips entrance and exit waits for reduced motion',()=>{vi.useFakeTimers();vi.stubGlobal('matchMedia',vi.fn().mockReturnValue({matches:true,addEventListener:vi.fn(),removeEventListener:vi.fn()} as unknown as MediaQueryList));const done=vi.fn();const view=render(<AppLoadingScreen active onExitComplete={done}/>);view.rerender(<AppLoadingScreen active={false} onExitComplete={done}/>);expect(view.container).toBeEmptyDOMElement();expect(done).toHaveBeenCalledOnce();});
it('keeps the grid static without circle artwork',()=>{
  const view=render(<AppLoadingScreen active/>);
  expect(view.container.querySelector('.app-loading-grid')).toBeInTheDocument();
  expect(view.container.querySelector('.app-loading-arc-left')).toBeNull();
  expect(view.container.querySelector('.app-loading-arc-right')).toBeNull();
});
